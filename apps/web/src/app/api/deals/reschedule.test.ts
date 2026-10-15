import { createDb, type Db, migrateDb, schema } from "@tranche/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeal, createUser, createWorkspace, one } from "@/server/test-fixtures";

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), requestHeaders: vi.fn() }));

vi.mock("@/server/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("next/headers", () => ({ headers: async () => mocks.requestHeaders() }));
vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new Error(`redirect:${target}`);
  },
}));

const url = process.env.DATABASE_URL;

describe.runIf(Boolean(url))(
  "POST /api/deals/[dealId]/tasks/reschedule",
  { timeout: 20_000 },
  () => {
    let db: Db;
    let POST: typeof import("./[dealId]/tasks/reschedule/route").POST;

    beforeAll(async () => {
      db = createDb(url);
      await migrateDb(db);
      ({ POST } = await import("./[dealId]/tasks/reschedule/route"));
    });
    afterAll(async () => {
      await db.$client.end();
    });
    beforeEach(() => {
      mocks.getSession.mockReset();
      mocks.requestHeaders.mockReset();
      mocks.requestHeaders.mockReturnValue(new Headers({ cookie: "session=test" }));
      mocks.getSession.mockResolvedValue(null);
    });

    async function signInTo(workspaceId: string) {
      const user = await createUser(db);
      await db
        .insert(schema.workspaceMember)
        .values({ workspaceId, userId: user.id, role: "member" });
      mocks.getSession.mockResolvedValue({
        session: { id: `s-${user.id}` },
        user: { id: user.id, name: user.name },
      });
    }

    async function dealWithTasks() {
      const fixture = await createDeal(db, { milestones: 1 });
      const dealId = fixture.deal.id;
      const milestoneId = one(fixture.milestones).id;
      const rows = await db
        .insert(schema.task)
        .values([
          {
            dealId,
            milestoneId,
            key: "wireframes",
            title: "Wireframes",
            durationDays: 3,
            startDate: "2026-10-20",
            position: 0,
          },
          {
            dealId,
            milestoneId,
            key: "visual",
            title: "Visual design",
            durationDays: 2,
            startDate: "2026-10-23",
            position: 1,
          },
        ])
        .returning();
      const wireframes = one(rows.slice(0, 1));
      const visual = one(rows.slice(1, 2));
      await db
        .insert(schema.taskDependency)
        .values({ fromTaskId: wireframes.id, toTaskId: visual.id });
      return { ...fixture, dealId, visual };
    }

    function call(dealId: string, body: unknown) {
      return POST(
        new Request(`http://localhost/api/deals/${dealId}/tasks/reschedule`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ dealId }) } as Parameters<typeof POST>[1],
      );
    }

    const startOf = async (dealId: string, key: string) =>
      one(
        await db
          .select()
          .from(schema.task)
          .where(and(eq(schema.task.dealId, dealId), eq(schema.task.key, key))),
      ).startDate;

    it("moves a task and returns the new dates", async () => {
      const { dealId, workspaceId, visual } = await dealWithTasks();
      await signInTo(workspaceId);
      const res = await call(dealId, { taskId: visual.id, start: "2026-10-25" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { tasks: Array<{ id: string; startDate: string }> };
      expect(body.tasks.find((t) => t.id === visual.id)?.startDate).toBe("2026-10-25");
      expect(await startOf(dealId, "visual")).toBe("2026-10-25");
    });

    it("answers 422 naming the blocking task and writes nothing", async () => {
      const { dealId, workspaceId, visual } = await dealWithTasks();
      await signInTo(workspaceId);
      const res = await call(dealId, { taskId: visual.id, start: "2026-10-21" });
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({
        error: 'task "visual" cannot start before "wireframes" ends on 2026-10-23',
      });
      expect(await startOf(dealId, "visual")).toBe("2026-10-23");
      expect(
        await db
          .select()
          .from(schema.event)
          .where(and(eq(schema.event.dealId, dealId), eq(schema.event.type, "task.rescheduled"))),
      ).toHaveLength(0);
    });

    it("answers 404 for another workspace's deal and moves nothing", async () => {
      const { dealId, visual } = await dealWithTasks();
      await signInTo((await createWorkspace(db)).id);
      const res = await call(dealId, { taskId: visual.id, start: "2026-10-25" });
      expect(res.status).toBe(404);
      expect(await startOf(dealId, "visual")).toBe("2026-10-23");
    });

    it("rejects a malformed body", async () => {
      const { dealId, workspaceId } = await dealWithTasks();
      await signInTo(workspaceId);
      expect((await call(dealId, { taskId: "nope", start: "tomorrow" })).status).toBe(400);
    });
  },
);
