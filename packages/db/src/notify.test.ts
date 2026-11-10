import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db, migrateDb, schema } from "./index";
import { seed } from "./seed";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

type Notified = { id: number; dealId: string | null; milestoneId: string | null; type: string };

describe.runIf(Boolean(url))("event notify trigger", () => {
  let db: Db;
  let listener: ReturnType<typeof postgres> | undefined;
  let ids: Awaited<ReturnType<typeof seed>>;
  let milestoneId: string;
  const received: Notified[] = [];

  beforeAll(async () => {
    if (!url) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required");
    db = createDb(url);
    await migrateDb(db);
    ids = await seed(db);
    const [milestone] = await db
      .select()
      .from(schema.milestone)
      .where(eq(schema.milestone.dealId, ids.dealId));
    milestoneId = milestone?.id ?? "";
    listener = postgres(url, { max: 1 });
    await listener.listen("tranche_events", (payload) => {
      received.push(JSON.parse(payload) as Notified);
    });
  });

  afterAll(async () => {
    if (listener) await listener.end();
    await db.$client.end();
  });

  async function notified(id: number): Promise<Notified> {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const found = received.find((n) => n.id === id);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`no notification for event ${id}`);
  }

  it("notifies tranche_events with exactly id, dealId, milestoneId and type", async () => {
    const [row] = await db
      .insert(schema.event)
      .values({ dealId: ids.dealId, milestoneId, type: "milestone.held", payload: { secret: 1 } })
      .returning();
    expect(await notified(row?.id ?? -1)).toEqual({
      id: row?.id,
      dealId: ids.dealId,
      milestoneId,
      type: "milestone.held",
    });
  });

  it("sends the id as a JSON number", async () => {
    const [row] = await db
      .insert(schema.event)
      .values({ dealId: ids.dealId, type: "deal.agreed", payload: {} })
      .returning();
    expect(typeof (await notified(row?.id ?? -1)).id).toBe("number");
  });

  it("allows a null dealId and milestoneId", async () => {
    const [row] = await db
      .insert(schema.event)
      .values({ type: "deal.created", payload: {} })
      .returning();
    expect(await notified(row?.id ?? -1)).toEqual({
      id: row?.id,
      dealId: null,
      milestoneId: null,
      type: "deal.created",
    });
  });

  it("notifies once per row of a multi-row insert, in id order", async () => {
    const rows = await db
      .insert(schema.event)
      .values(
        [1, 2, 3].map(() => ({
          dealId: ids.dealId,
          type: "task.rescheduled" as const,
          payload: {},
        })),
      )
      .returning();
    const last = rows.at(-1)?.id ?? -1;
    await notified(last);
    const mine = received.filter((n) => rows.some((r) => r.id === n.id)).map((n) => n.id);
    expect(mine).toEqual(rows.map((r) => r.id));
  });

  it("does not notify when an insert is rolled back", async () => {
    let rolledBack = -1;
    await db
      .transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.event)
          .values({ dealId: ids.dealId, type: "alert.raised", payload: {} })
          .returning();
        rolledBack = row?.id ?? -1;
        throw new Error("rollback");
      })
      .catch(() => undefined);
    const [marker] = await db
      .insert(schema.event)
      .values({ dealId: ids.dealId, type: "deal.agreed", payload: {} })
      .returning();
    await notified(marker?.id ?? -1);
    expect(received.some((n) => n.id === rolledBack)).toBe(false);
  });
});
