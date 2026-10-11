import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, migrateDb, schema } from "./index";
import { seed } from "./seed";

const url = process.env.DATABASE_URL;
const db = url ? createDb(url) : null;

describe.runIf(Boolean(db))("seed", () => {
  beforeAll(async () => {
    await migrateDb(db!);
  });
  afterAll(async () => {
    await db!.$client.end();
  });

  it("creates a demo deal with three milestones and is idempotent", async () => {
    const first = await seed(db!);
    const second = await seed(db!);
    expect(second.dealId).toBe(first.dealId);
    const ms = await db!
      .select()
      .from(schema.milestone)
      .where(eq(schema.milestone.dealId, first.dealId));
    expect(ms).toHaveLength(3);
    const tasks = await db!.select().from(schema.task).where(eq(schema.task.dealId, first.dealId));
    expect(tasks.length).toBeGreaterThanOrEqual(6);
  });
});
