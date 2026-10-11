import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db, migrateDb, schema } from "./index";

const url = process.env.DATABASE_URL;

function one<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (row === undefined) throw new Error("expected one row");
  return row;
}

describe.runIf(Boolean(url))("schema", () => {
  let db: Db;

  beforeAll(async () => {
    db = createDb(url);
    await migrateDb(db);
  });
  afterAll(async () => {
    await db.$client.end();
  });

  it("stores a deal with a milestone", async () => {
    const ws = one(
      await db
        .insert(schema.workspace)
        .values({
          name: "Test Studio",
          rateCard: { currency: "USD", dailyRateMinor: 60000, minimumProjectMinor: 0 },
        })
        .returning(),
    );
    const cl = one(
      await db
        .insert(schema.client)
        .values({ workspaceId: ws.id, name: "Acme", email: "acme@example.com" })
        .returning(),
    );
    const dl = one(
      await db
        .insert(schema.deal)
        .values({
          workspaceId: ws.id,
          clientId: cl.id,
          title: "Rebuild",
          brief: "x",
          currency: "USD",
        })
        .returning(),
    );
    await db.insert(schema.milestone).values({
      dealId: dl.id,
      key: "m1",
      position: 0,
      title: "Design",
      priceMinor: 100000,
      criteria: { checks: [{ kind: "url_live", url: "https://example.com" }], prose: [] },
      payees: [{ kind: "agency", shareBps: 10000 }],
    });
    const rows = await db.select().from(schema.milestone).where(eq(schema.milestone.dealId, dl.id));
    expect(rows[0]?.state).toBe("draft");
  });

  it("rejects a duplicate inbox event", async () => {
    const row = {
      source: "paypal" as const,
      sourceEventId: `WH-dup-${randomUUID()}`,
      message: { type: "timer.due", scheduledActionId: randomUUID() } as const,
    };
    await db.insert(schema.inbox).values(row);
    await expect(db.insert(schema.inbox).values(row)).rejects.toThrow();
  });

  it("rejects a duplicate proposal idempotency key", async () => {
    const ws = one(
      await db
        .insert(schema.workspace)
        .values({
          name: "S2",
          rateCard: { currency: "USD", dailyRateMinor: 1, minimumProjectMinor: 0 },
        })
        .returning(),
    );
    const cl = one(
      await db
        .insert(schema.client)
        .values({ workspaceId: ws.id, name: "C", email: "c@example.com" })
        .returning(),
    );
    const dl = one(
      await db
        .insert(schema.deal)
        .values({ workspaceId: ws.id, clientId: cl.id, title: "D", brief: "b", currency: "USD" })
        .returning(),
    );
    const row = {
      dealId: dl.id,
      agent: "monitor" as const,
      side: "system" as const,
      type: "flag_risk" as const,
      payload: { type: "flag_risk", milestoneId: null, severity: "low", message: "m" } as const,
      reasoning: "r",
      idempotencyKey: `monitor:dup:${randomUUID()}`,
    };
    await db.insert(schema.proposedAction).values(row);
    await expect(db.insert(schema.proposedAction).values(row)).rejects.toThrow();
  });

  it("orders events by an increasing id", async () => {
    const a = one(
      await db.insert(schema.event).values({ type: "deal.created", payload: {} }).returning(),
    );
    const b = one(
      await db.insert(schema.event).values({ type: "deal.created", payload: {} }).returning(),
    );
    expect(b.id).toBeGreaterThan(a.id);
  });
});
