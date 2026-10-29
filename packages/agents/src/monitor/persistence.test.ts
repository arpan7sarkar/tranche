import { type Db, schema } from "@tranche/db";
import { truncateAll } from "@tranche/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentTestDb } from "../testing/database";
import { makeDeal } from "../testing/fixture";
import { runMonitor } from "./index";

describe.runIf(Boolean(process.env.TEST_DATABASE_URL))("monitor proposals", () => {
  let db: Db;
  const now = new Date("2026-10-27T12:00:00Z");
  beforeAll(async () => {
    db = await createAgentTestDb("monitor");
  });
  beforeEach(async () => {
    await truncateAll(db);
    vi.stubEnv("TRANCHE_LLM", "off");
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await db?.$client.end();
  });
  async function overdue() {
    const ids = await makeDeal(db);
    await db.update(schema.deal).set({ status: "active" }).where(eq(schema.deal.id, ids.dealId));
    await db
      .update(schema.milestone)
      .set({ state: "release_pending" })
      .where(eq(schema.milestone.id, ids.milestoneId));
    await db.insert(schema.event).values({
      type: "milestone.release_pending",
      dealId: ids.dealId,
      milestoneId: ids.milestoneId,
      payload: {},
      createdAt: new Date("2026-10-24T12:00:00Z"),
    });
    return ids;
  }
  it("deduplicates concurrent daily runs and leaves decisions to policy", async () => {
    await overdue();
    const counts = await Promise.all([runMonitor(db, { now }), runMonitor(db, { now })]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(2);
    const actions = await db.select().from(schema.proposedAction);
    expect(actions.map((a) => a.type).sort()).toEqual(["flag_risk", "send_reminder"]);
    expect(actions.every((a) => a.status === "pending" && a.agent === "monitor")).toBe(true);
    expect(await runMonitor(db, { now })).toBe(0);
    expect(await runMonitor(db, { now: new Date("2026-10-28T12:00:00Z") })).toBe(2);
    expect(await db.select().from(schema.outbox)).toHaveLength(0);
  });
  it("ignores terminal deals and scopes an explicit assessment", async () => {
    const first = await overdue();
    const second = await overdue();
    await db
      .update(schema.deal)
      .set({ status: "cancelled" })
      .where(eq(schema.deal.id, first.dealId));
    expect(await runMonitor(db, { now, dealId: first.dealId })).toBe(0);
    expect(await runMonitor(db, { now, dealId: second.dealId })).toBe(2);
  });
});
