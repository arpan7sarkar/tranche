import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, migrateDb, schema } from "./index";

const url = process.env.DATABASE_URL;
const db = url ? createDb(url) : null;

describe.runIf(Boolean(db))("schema", () => {
  beforeAll(async () => {
    await migrateDb(db!);
  });
  afterAll(async () => {
    await db!.$client.end();
  });

  it("stores a deal with a milestone", async () => {
    const [ws] = await db!
      .insert(schema.workspace)
      .values({
        name: "Test Studio",
        rateCard: { currency: "USD", dailyRateMinor: 60000, minimumProjectMinor: 0 },
      })
      .returning();
    const [cl] = await db!
      .insert(schema.client)
      .values({ workspaceId: ws!.id, name: "Acme", email: "acme@example.com" })
      .returning();
    const [dl] = await db!
      .insert(schema.deal)
      .values({
        workspaceId: ws!.id,
        clientId: cl!.id,
        title: "Rebuild",
        brief: "x",
        currency: "USD",
      })
      .returning();
    await db!.insert(schema.milestone).values({
      dealId: dl!.id,
      key: "m1",
      position: 0,
      title: "Design",
      priceMinor: 100000,
      criteria: { checks: [{ kind: "url_live", url: "https://example.com" }], prose: [] },
      payees: [{ kind: "agency", shareBps: 10000 }],
    });
    const rows = await db!
      .select()
      .from(schema.milestone)
      .where(eq(schema.milestone.dealId, dl!.id));
    expect(rows[0]?.state).toBe("draft");
  });

  it("rejects a duplicate inbox event", async () => {
    const row = { source: "paypal", sourceEventId: "WH-dup-1", message: { type: "timer.due" } };
    await db!.insert(schema.inbox).values(row);
    await expect(db!.insert(schema.inbox).values(row)).rejects.toThrow();
  });

  it("rejects a duplicate proposal idempotency key", async () => {
    const [ws] = await db!
      .insert(schema.workspace)
      .values({
        name: "S2",
        rateCard: { currency: "USD", dailyRateMinor: 1, minimumProjectMinor: 0 },
      })
      .returning();
    const [cl] = await db!
      .insert(schema.client)
      .values({ workspaceId: ws!.id, name: "C", email: "c@example.com" })
      .returning();
    const [dl] = await db!
      .insert(schema.deal)
      .values({ workspaceId: ws!.id, clientId: cl!.id, title: "D", brief: "b", currency: "USD" })
      .returning();
    const row = {
      dealId: dl!.id,
      agent: "monitor" as const,
      side: "system" as const,
      type: "flag_risk" as const,
      payload: { type: "flag_risk", milestoneId: null, severity: "low", message: "m" },
      reasoning: "r",
      idempotencyKey: "monitor:dup:12345",
    };
    await db!.insert(schema.proposedAction).values(row);
    await expect(db!.insert(schema.proposedAction).values(row)).rejects.toThrow();
  });

  it("orders events by an increasing id", async () => {
    const [a] = await db!
      .insert(schema.event)
      .values({ type: "deal.created", payload: {} })
      .returning();
    const [b] = await db!
      .insert(schema.event)
      .values({ type: "deal.created", payload: {} })
      .returning();
    expect(b!.id).toBeGreaterThan(a!.id);
  });
});
