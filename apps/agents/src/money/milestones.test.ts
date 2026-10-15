import { type Db, schema } from "@tranche/db";
import { createTestDb, truncateAll } from "@tranche/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { advanceMilestone } from "./milestones";
import { makeMilestone, NOW } from "./test-helpers";

let db: Db;

describe.runIf(Boolean(process.env.DATABASE_URL))("advanceMilestone", () => {
  beforeAll(async () => {
    db = await createTestDb("agents");
  });
  beforeEach(async () => {
    await truncateAll(db);
  });
  afterAll(async () => {
    await db.$client.end();
  });

  it("lets exactly one concurrent writer win", async () => {
    const { milestoneId } = await makeMilestone(db, { state: "verifying", heldMinor: 100000 });
    const results = await Promise.allSettled([
      db.transaction((tx) =>
        advanceMilestone(
          tx,
          milestoneId,
          { type: "verification_passed", at: NOW.toISOString() },
          { now: NOW },
        ),
      ),
      db.transaction((tx) =>
        advanceMilestone(
          tx,
          milestoneId,
          { type: "verification_failed", missing: ["x"] },
          { now: NOW },
        ),
      ),
    ]);
    const applied = results.filter((r) => r.status === "fulfilled" && r.value.applied);
    expect(applied).toHaveLength(1);
    const [m] = await db
      .select()
      .from(schema.milestone)
      .where(eq(schema.milestone.id, milestoneId));
    expect(m?.version).toBe(1);
  });
});
