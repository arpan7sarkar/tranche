import { type Db, schema } from "@tranche/db";
import { createTestDb, truncateAll } from "@tranche/db/testing";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { must } from "./errors";
import { applyReschedule, RescheduleError } from "./reschedule";
import { makeMilestone, NOW } from "./test-helpers";

let db: Db;

async function makeTasks(dealId: string, milestoneId: string) {
  const rows = await db
    .insert(schema.task)
    .values([
      {
        dealId,
        milestoneId,
        key: "a",
        title: "Wireframes",
        durationDays: 3,
        startDate: "2026-10-20",
        position: 0,
      },
      {
        dealId,
        milestoneId,
        key: "b",
        title: "Visual design",
        durationDays: 2,
        startDate: "2026-10-23",
        position: 1,
      },
    ])
    .returning();
  const [a, b] = [must(rows[0]), must(rows[1])];
  await db.insert(schema.taskDependency).values({ fromTaskId: a.id, toTaskId: b.id });
  await db
    .update(schema.milestone)
    .set({ startDate: "2026-10-20", endDate: "2026-10-25" })
    .where(eq(schema.milestone.id, milestoneId));
  return { a, b };
}

const fundTimers = (milestoneId: string) =>
  db
    .select()
    .from(schema.scheduledAction)
    .where(
      and(
        eq(schema.scheduledAction.milestoneId, milestoneId),
        eq(schema.scheduledAction.kind, "fund"),
      ),
    )
    .orderBy(asc(schema.scheduledAction.createdAt));

const move = (dealId: string, taskId: string, start: string) =>
  db.transaction((tx) => applyReschedule(tx, dealId, [{ taskId, start }], "slip", NOW));

describe.runIf(Boolean(process.env.DATABASE_URL))("applyReschedule", () => {
  beforeAll(async () => {
    db = await createTestDb("agents");
  });
  beforeEach(async () => {
    await truncateAll(db);
  });
  afterAll(async () => {
    await db.$client.end();
  });

  it("moves a task, pushes its dependent and widens the milestone window", async () => {
    const { dealId, milestoneId } = await makeMilestone(db, { state: "agreed" });
    const { a, b } = await makeTasks(dealId, milestoneId);
    const r = await move(dealId, a.id, "2026-10-22");
    expect(r.tasks).toContainEqual({ id: b.id, startDate: "2026-10-25", endDate: "2026-10-27" });
    expect(r.milestones).toEqual([
      { id: milestoneId, startDate: "2026-10-22", endDate: "2026-10-27" },
    ]);
    const [e] = await db
      .select()
      .from(schema.event)
      .where(eq(schema.event.type, "task.rescheduled"));
    expect(e?.dealId).toBe(dealId);
    expect(e?.payload).toEqual({
      reason: "slip",
      changes: [
        { taskId: a.id, from: "2026-10-20", to: "2026-10-22" },
        { taskId: b.id, from: "2026-10-23", to: "2026-10-25" },
      ],
    });
  });

  it("moves only a pending funding timer", async () => {
    const agreed = await makeMilestone(db, { state: "agreed" });
    const t1 = await makeTasks(agreed.dealId, agreed.milestoneId);
    await db.insert(schema.scheduledAction).values({
      milestoneId: agreed.milestoneId,
      kind: "fund",
      dueAt: new Date("2026-10-17T00:00:00Z"),
    });
    await move(agreed.dealId, t1.a.id, "2026-10-25");
    expect(
      (await fundTimers(agreed.milestoneId)).map((t) => [t.status, t.dueAt.toISOString()]),
    ).toEqual([
      ["cancelled", "2026-10-17T00:00:00.000Z"],
      ["pending", "2026-10-22T00:00:00.000Z"],
    ]);

    const held = await makeMilestone(db, { state: "held", heldMinor: 100000 });
    const t2 = await makeTasks(held.dealId, held.milestoneId);
    await db
      .insert(schema.scheduledAction)
      .values({ milestoneId: held.milestoneId, kind: "fund", dueAt: NOW, status: "done" });
    await move(held.dealId, t2.a.id, "2026-10-25");
    expect(await fundTimers(held.milestoneId)).toHaveLength(1);
  });

  it("refuses a move before a dependency ends, naming it, and changes nothing", async () => {
    const { dealId, milestoneId } = await makeMilestone(db, { state: "agreed" });
    const { b } = await makeTasks(dealId, milestoneId);
    await expect(move(dealId, b.id, "2026-10-21")).rejects.toThrow(
      new RescheduleError('task "b" cannot start before "a" ends on 2026-10-23'),
    );
    const [after] = await db.select().from(schema.task).where(eq(schema.task.id, b.id));
    expect(after?.startDate).toBe("2026-10-23");
    expect(
      await db.select().from(schema.event).where(eq(schema.event.type, "task.rescheduled")),
    ).toHaveLength(0);
  });

  it("refuses tasks of a released milestone and tasks of another deal", async () => {
    const released = await makeMilestone(db, {
      state: "released",
      heldMinor: 100000,
      releasedMinor: 100000,
    });
    const t = await makeTasks(released.dealId, released.milestoneId);
    await expect(move(released.dealId, t.a.id, "2026-10-25")).rejects.toThrow(/already released/);
    const other = await makeMilestone(db, { state: "agreed" });
    await expect(move(other.dealId, t.a.id, "2026-10-25")).rejects.toThrow(/not part of this deal/);
  });
});
