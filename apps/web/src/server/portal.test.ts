import { createDb, type Db, migrateDb, schema } from "@tranche/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { submitClientRelease } from "./portal";
import { createDeal, one } from "./test-fixtures";

const url = process.env.DATABASE_URL;

describe.runIf(Boolean(url))("submitClientRelease", { timeout: 20_000 }, () => {
  let db: Db;

  beforeAll(async () => {
    db = createDb(url);
    await migrateDb(db);
  });
  afterAll(async () => {
    await db.$client.end();
  });

  it("refuses a milestone that is not ready or belongs to another deal", async () => {
    const { deal, milestones } = await createDeal(db, { milestones: 1 });
    const other = await createDeal(db, { milestones: 1 });
    const m = one(milestones);
    expect(await submitClientRelease(db, { dealId: deal.id, milestoneId: m.id })).toBe(
      "not_releasable",
    );
    await db
      .update(schema.milestone)
      .set({ state: "release_pending" })
      .where(eq(schema.milestone.id, m.id));
    expect(await submitClientRelease(db, { dealId: other.deal.id, milestoneId: m.id })).toBe(
      "not_releasable",
    );
  });

  it("submits exactly one release of the held amount under concurrent clicks", async () => {
    const { deal, milestones } = await createDeal(db, { milestones: 1 });
    const m = one(milestones);
    await db
      .update(schema.milestone)
      .set({ state: "release_pending", heldMinor: m.priceMinor })
      .where(eq(schema.milestone.id, m.id));
    const input = { dealId: deal.id, milestoneId: m.id };
    const results = await Promise.all([
      submitClientRelease(db, input),
      submitClientRelease(db, input),
    ]);
    expect(results.sort()).toEqual(["already_submitted", "submitted"]);
    const rows = await db
      .select()
      .from(schema.proposedAction)
      .where(eq(schema.proposedAction.dealId, deal.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ agent: "human", side: "client", type: "release" });
    expect(rows[0]?.payload).toEqual({
      type: "release",
      milestoneId: m.id,
      amount: { currency: "USD", minor: m.priceMinor },
    });
  });
});
