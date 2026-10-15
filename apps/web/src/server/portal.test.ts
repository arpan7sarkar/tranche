import { planVersion } from "@tranche/core";
import { createDb, type Db, migrateDb, schema } from "@tranche/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agreeFromPortal,
  setAutoRelease,
  submitClientRelease,
  submittedClientReleases,
} from "./portal";
import { createDeal, one } from "./test-fixtures";

const url = process.env.DATABASE_URL;

describe.runIf(Boolean(url))("portal actions", { timeout: 20_000 }, () => {
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

  it("lets the client retry after a release fails", async () => {
    const { deal, milestones } = await createDeal(db, { milestones: 1 });
    const m = one(milestones);
    await db
      .update(schema.milestone)
      .set({ state: "release_pending", heldMinor: m.priceMinor })
      .where(eq(schema.milestone.id, m.id));
    const input = { dealId: deal.id, milestoneId: m.id };
    expect(await submitClientRelease(db, input)).toBe("submitted");
    expect(await submittedClientReleases(db, deal.id)).toEqual(new Set([m.id]));

    await db
      .update(schema.proposedAction)
      .set({ status: "failed" })
      .where(eq(schema.proposedAction.dealId, deal.id));
    expect(await submittedClientReleases(db, deal.id)).toEqual(new Set());
    expect(await submitClientRelease(db, input)).toBe("submitted");
    expect(await submitClientRelease(db, input)).toBe("already_submitted");
  });

  it("refuses to agree to a plan that changed since the client loaded it", async () => {
    const { deal, milestones } = await createDeal(db, { milestones: 2 });
    await db.update(schema.deal).set({ status: "sent" }).where(eq(schema.deal.id, deal.id));
    const seen = planVersion("USD", milestones);
    await db
      .update(schema.milestone)
      .set({ priceMinor: 99_999 })
      .where(eq(schema.milestone.id, one(milestones).id));
    expect(await agreeFromPortal(db, { dealId: deal.id, planVersion: seen })).toBe("plan_changed");
    const [after] = await db.select().from(schema.deal).where(eq(schema.deal.id, deal.id));
    expect(after?.status).toBe("sent");

    const fresh = await db
      .select()
      .from(schema.milestone)
      .where(eq(schema.milestone.dealId, deal.id))
      .orderBy(schema.milestone.position);
    expect(
      await agreeFromPortal(db, { dealId: deal.id, planVersion: planVersion("USD", fresh) }),
    ).toBe("agreed");
  });

  it("gives client-side agents no release authority when auto-release is turned on", async () => {
    const { deal } = await createDeal(db, { milestones: 1 });
    const policy = await setAutoRelease(db, { dealId: deal.id, hours: 72 });
    expect(policy).toMatchObject({
      autoReleaseAfterHours: 72,
      perActionMaxMinor: 0,
      perMilestoneMaxMinor: 0,
      perDealMaxMinor: 0,
      alwaysAsk: ["release"],
    });
    const custom = { ...policy, perActionMaxMinor: 500, alwaysAsk: [] };
    await db.update(schema.deal).set({ clientPolicy: custom }).where(eq(schema.deal.id, deal.id));
    expect(await setAutoRelease(db, { dealId: deal.id, hours: null })).toEqual({
      ...custom,
      autoReleaseAfterHours: null,
    });
  });
});
