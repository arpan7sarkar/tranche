import { type Db, schema } from "@tranche/db";
import { truncateAll } from "@tranche/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAgentTestDb } from "../testing/database";
import { makeDeal } from "../testing/fixture";
import { loadDashboardData } from "./data";

describe.runIf(Boolean(process.env.TEST_DATABASE_URL))("dashboard data", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createAgentTestDb("dashboard");
  });
  beforeEach(async () => {
    await truncateAll(db);
  });
  afterAll(async () => {
    await db?.$client.end();
  });

  it("uses recorded money amounts and excludes foreign workspace data", async () => {
    const a = await makeDeal(db);
    const b = await makeDeal(db);
    await db
      .update(schema.milestone)
      .set({ state: "held", heldMinor: 5000 })
      .where(eq(schema.milestone.id, a.milestoneId));
    await db
      .update(schema.milestone)
      .set({ state: "released", heldMinor: 10000, releasedMinor: 10000 })
      .where(eq(schema.milestone.id, b.milestoneId));
    const data = await loadDashboardData(db, a.workspaceId);
    expect(data.kpis).toEqual([{ held: 50, released: 0, overdue: 0, forecast: 0 }]);
    expect(data.deals).toHaveLength(1);
    expect(data.deals[0]).toMatchObject({ total: 100, held: 50, released: 0 });
    expect(data.cashflow.reduce((sum, row) => sum + row.held, 0)).toBe(50);
  });

  it("keeps currencies separate including zero-decimal currency", async () => {
    const a = await makeDeal(db);
    const b = await makeDeal(db);
    const [deal] = await db.select().from(schema.deal).where(eq(schema.deal.id, b.dealId));
    if (!deal) throw new Error("fixture");
    await db
      .update(schema.client)
      .set({ workspaceId: a.workspaceId })
      .where(eq(schema.client.id, deal.clientId));
    await db
      .update(schema.deal)
      .set({ workspaceId: a.workspaceId, currency: "JPY" })
      .where(eq(schema.deal.id, b.dealId));
    expect((await loadDashboardData(db, a.workspaceId, "USD")).kpis[0]?.forecast).toBe(100);
    const yen = await loadDashboardData(db, a.workspaceId, "JPY");
    expect(yen.kpis[0]?.forecast).toBe(10000);
    expect(yen.currencies).toEqual(["JPY", "USD"]);
    expect(yen.deals).toHaveLength(1);
    await expect(loadDashboardData(db, a.workspaceId, "EUR")).rejects.toThrow(
      "invalid_dashboard_currency",
    );
  });

  it("moves an overdue pending release into its own bucket and hides cancelled cash flows", async () => {
    const a = await makeDeal(db);
    await db
      .update(schema.milestone)
      .set({ state: "release_pending", heldMinor: 10000 })
      .where(eq(schema.milestone.id, a.milestoneId));
    await db.insert(schema.event).values({
      type: "milestone.release_pending",
      dealId: a.dealId,
      milestoneId: a.milestoneId,
      payload: {},
      createdAt: new Date(Date.now() - 50 * 3600000),
    });
    expect((await loadDashboardData(db, a.workspaceId)).kpis).toEqual([
      { held: 0, released: 0, overdue: 100, forecast: 0 },
    ]);
    await db.update(schema.deal).set({ status: "cancelled" }).where(eq(schema.deal.id, a.dealId));
    expect((await loadDashboardData(db, a.workspaceId)).cashflow).toEqual([]);
  });
});
