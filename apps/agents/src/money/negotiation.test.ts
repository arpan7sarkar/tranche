import assert from "node:assert/strict";
import { runNegotiation, startNegotiation } from "@tranche/agents";
import { scriptedModel } from "@tranche/agents/testing";
import { planVersion } from "@tranche/core";
import { type Db, schema } from "@tranche/db";
import { createTestDb, truncateAll } from "@tranche/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { agreeToPlan, runExecutor } from "./actions";
import { makeMilestone, testDeps } from "./test-helpers";

describe.runIf(Boolean(process.env.DATABASE_URL))("negotiated agreement execution", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createTestDb("agents");
  });
  beforeEach(async () => {
    await truncateAll(db);
    vi.stubEnv("TRANCHE_LLM", "on");
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await db?.$client.end();
  });
  async function agreement() {
    const ids = await makeMilestone(db);
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
    const n = await startNegotiation(db, ids.workspaceId, {
      dealId: ids.dealId,
      client: { limitMinor: 100000, latestEndDate: "2026-11-04", maxRounds: 2 },
    });
    assert(n.ok);
    await runNegotiation(
      db,
      n.negotiationId,
      scriptedModel([
        { kind: "offer", adjustment: { milestonePrices: [], taskDurations: [] }, message: "Offer" },
        { kind: "accept", message: "Accept" },
      ]),
    );
    const [action] = await db
      .select()
      .from(schema.proposedAction)
      .where(eq(schema.proposedAction.type, "accept_plan"));
    assert(action);
    return { ...ids, action, negotiationId: n.negotiationId };
  }
  it("rejects a negotiated proposal after the reviewed plan changes", async () => {
    const a = await agreement();
    await db.update(schema.task).set({ durationDays: 3 }).where(eq(schema.task.dealId, a.dealId));
    await expect(db.transaction((tx) => runExecutor(tx, testDeps(db), a.action))).rejects.toThrow(
      "plan_changed",
    );
  });
  it("rechecks mandates at execution", async () => {
    const a = await agreement();
    await db
      .update(schema.negotiation)
      .set({ clientMandate: { side: "client", limitMinor: 1, latestEndDate: null, maxRounds: 2 } })
      .where(eq(schema.negotiation.id, a.negotiationId));
    await expect(db.transaction((tx) => runExecutor(tx, testDeps(db), a.action))).rejects.toThrow(
      "mandate",
    );
  });
  it("applies accepted terms at their negotiated start date and schedules funding", async () => {
    const a = await agreement();
    expect(a.action.side).toBe("client");
    await db.transaction((tx) => runExecutor(tx, testDeps(db), a.action));
    const [m] = await db
      .select()
      .from(schema.milestone)
      .where(eq(schema.milestone.dealId, a.dealId));
    expect(m?.startDate).toBe("2026-11-02");
    expect(m?.state).toBe("agreed");
    expect(await db.select().from(schema.outbox)).toHaveLength(0);
    expect(await db.select().from(schema.scheduledAction)).toHaveLength(1);
  });
  it("preserves all four versioned agreement outcomes", async () => {
    const a = await agreement();
    const ms = await db
      .select()
      .from(schema.milestone)
      .where(eq(schema.milestone.dealId, a.dealId))
      .orderBy(schema.milestone.position);
    const version = planVersion("USD", ms);
    expect(await agreeToPlan(db, a.dealId, "stale")).toBe("plan_changed");
    expect(await agreeToPlan(db, a.dealId, version)).toBe("agreed");
    expect(await agreeToPlan(db, a.dealId, version)).toBe("already_agreed");
    expect(await agreeToPlan(db, crypto.randomUUID(), version)).toBe("not_agreeable");
  });
});
