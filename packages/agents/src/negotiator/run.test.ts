import assert from "node:assert/strict";
import { type Db, schema } from "@tranche/db";
import { truncateAll } from "@tranche/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentTestDb, makeDeal, scriptedModel } from "../testing";
import { runNegotiation, takeTurn } from "./run";
import { startNegotiation } from "./start";
import { loadNegotiationView } from "./view";

const offer = {
  kind: "offer",
  adjustment: { milestonePrices: [], taskDurations: [] },
  message: "My floor is private",
};
const accept = { kind: "accept", message: "Private budget 1234567" };
describe.runIf(Boolean(process.env.TEST_DATABASE_URL))("negotiator persistence", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createAgentTestDb("negotiator");
  });
  beforeEach(async () => {
    await truncateAll(db);
    vi.stubEnv("TRANCHE_LLM", "on");
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await db?.$client.end();
  });
  async function fixture() {
    const ids = await makeDeal(db);
    await db.update(schema.deal).set({ status: "sent" }).where(eq(schema.deal.id, ids.dealId));
    await db
      .update(schema.milestone)
      .set({ startDate: "2026-11-02", endDate: "2026-11-04" })
      .where(eq(schema.milestone.id, ids.milestoneId));
    await db.insert(schema.task).values({
      dealId: ids.dealId,
      milestoneId: ids.milestoneId,
      key: "build",
      title: "Build",
      position: 0,
      startDate: "2026-11-02",
      durationDays: 2,
    });
    const input = {
      dealId: ids.dealId,
      client: { limitMinor: 1234567, latestEndDate: null, maxRounds: 2 },
    };
    const result = await startNegotiation(db, ids.workspaceId, input);
    assert(result.ok);
    return { ...ids, id: result.negotiationId, input };
  }
  it("deduplicates concurrent starts and rejects foreign access", async () => {
    const f = await fixture();
    const results = await Promise.all([
      startNegotiation(db, f.workspaceId, f.input),
      startNegotiation(db, f.workspaceId, f.input),
    ]);
    expect(results.every((r) => r.ok && r.negotiationId === f.id)).toBe(true);
    expect(await startNegotiation(db, crypto.randomUUID(), f.input)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await loadNegotiationView(db, crypto.randomUUID(), f.id)).toBeNull();
    expect(await db.select().from(schema.negotiation)).toHaveLength(1);
    expect(await db.select().from(schema.event)).toHaveLength(1);
  });
  it("serializes duplicate runners and atomically writes one accepted proposal without money writes", async () => {
    const f = await fixture();
    const model = scriptedModel([offer, accept]);
    expect(
      await Promise.all([runNegotiation(db, f.id, model), runNegotiation(db, f.id, model)]),
    ).toEqual(["agreed", "agreed"]);
    expect(model.doGenerateCalls).toHaveLength(2);
    const turns = await db.select().from(schema.negotiationTurn);
    expect(turns).toHaveLength(2);
    const proposals = await db.select().from(schema.proposedAction);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.side).toBe("client");
    expect(proposals[0]?.status).toBe("pending");
    expect(await db.select().from(schema.outbox)).toHaveLength(0);
    const [deal] = await db.select().from(schema.deal).where(eq(schema.deal.id, f.dealId));
    expect(deal?.status).toBe("sent");
    expect(deal?.clientPolicy).toBeNull();
    expect(await startNegotiation(db, f.workspaceId, f.input)).toEqual({
      ok: false,
      error: "agreement_pending",
    });
    const serialized = JSON.stringify(await loadNegotiationView(db, f.workspaceId, f.id));
    expect(serialized).not.toContain("1234567");
    expect(serialized).not.toContain("Mandate");
    expect(JSON.stringify(await db.select().from(schema.event))).not.toContain("1234567");
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).not.toContain("1234567");
  });
  it("resumes after a transient model failure without replaying a committed turn", async () => {
    const f = await fixture();
    await takeTurn(db, f.id, scriptedModel([offer]));
    await expect(takeTurn(db, f.id, scriptedModel([]))).rejects.toThrow();
    expect(await db.select().from(schema.negotiationTurn)).toHaveLength(1);
    expect(await runNegotiation(db, f.id, scriptedModel([accept]))).toBe("agreed");
    expect(await db.select().from(schema.negotiationTurn)).toHaveLength(2);
  });
  it("leaves disabled work open for later recovery", async () => {
    const f = await fixture();
    vi.stubEnv("TRANCHE_LLM", "off");
    await expect(runNegotiation(db, f.id, scriptedModel([]))).rejects.toThrow("model_disabled");
    expect(await db.select().from(schema.negotiationTurn)).toHaveLength(0);
    expect((await loadNegotiationView(db, f.workspaceId, f.id))?.status).toBe("open");
  });
  it("escalates changed plans without calling a model", async () => {
    const f = await fixture();
    await db.update(schema.task).set({ durationDays: 3 }).where(eq(schema.task.dealId, f.dealId));
    const model = scriptedModel([]);
    expect(await runNegotiation(db, f.id, model)).toBe("escalated");
    expect(model.doGenerateCalls).toHaveLength(0);
  });
  it("rechecks the plan after generation before storing a turn", async () => {
    const f = await fixture();
    const model = scriptedModel([offer]);
    const generate = model.doGenerate.bind(model);
    vi.spyOn(model, "doGenerate").mockImplementation(async (input) => {
      await db.update(schema.task).set({ durationDays: 3 }).where(eq(schema.task.dealId, f.dealId));
      return generate(input);
    });
    expect(await takeTurn(db, f.id, model)).toBe("escalated");
    expect(await db.select().from(schema.negotiationTurn)).toHaveLength(0);
  });
  it("forces escalation at the smaller round limit", async () => {
    const f = await fixture();
    await db
      .update(schema.negotiation)
      .set({ clientMandate: { ...f.input.client, side: "client", maxRounds: 1 } })
      .where(eq(schema.negotiation.id, f.id));
    expect(await runNegotiation(db, f.id, scriptedModel([offer, offer]))).toBe("escalated");
    expect(await db.select().from(schema.negotiationTurn)).toHaveLength(2);
    expect((await db.select().from(schema.proposedAction))[0]?.type).toBe("escalate");
  });
});
