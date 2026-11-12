import { createDb, type Db, migrateDb, schema } from "@tranche/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDeal, createUser, one } from "@/server/test-fixtures";

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("@/server/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ cookie: "session=test" }) }));
vi.mock("@/server/kick", () => ({ kickMoneyTick: () => {} }));

const url = process.env.DATABASE_URL;

describe.runIf(Boolean(url))("POST /api/deals/[dealId]/milestones/[milestoneId]/deliveries", () => {
  let db: Db;
  let POST: typeof import("./[dealId]/milestones/[milestoneId]/deliveries/route").POST;

  beforeAll(async () => {
    db = createDb(url);
    await migrateDb(db);
    ({ POST } = await import("./[dealId]/milestones/[milestoneId]/deliveries/route"));
  });
  afterAll(async () => {
    await db.$client.end();
  });

  const deliver = (dealId: string, milestoneId: string) =>
    POST(
      new Request("http://localhost/api", {
        method: "POST",
        body: JSON.stringify({ url: "https://staging.example.com/" }),
      }),
      { params: Promise.resolve({ dealId, milestoneId }) } as Parameters<typeof POST>[1],
    );

  const inboxFor = (milestoneId: string) =>
    db
      .select()
      .from(schema.inbox)
      .where(sql`${schema.inbox.message}->>'milestoneId' = ${milestoneId}`);

  it("only delivers a milestone of the caller's deal, once per submission", async () => {
    const mine = await createDeal(db, { milestones: 1 });
    const theirs = await createDeal(db, { milestones: 1 });
    const myMilestone = one(mine.milestones).id;
    const theirMilestone = one(theirs.milestones).id;
    await db
      .update(schema.milestone)
      .set({ state: "in_progress" })
      .where(eq(schema.milestone.dealId, theirs.deal.id));
    await db
      .update(schema.milestone)
      .set({ state: "in_progress" })
      .where(eq(schema.milestone.id, myMilestone));
    const user = await createUser(db);
    await db
      .insert(schema.workspaceMember)
      .values({ workspaceId: mine.workspaceId, userId: user.id, role: "member" });
    mocks.getSession.mockResolvedValue({ session: { id: "s" }, user: { id: user.id } });

    expect((await deliver(mine.deal.id, theirMilestone)).status).toBe(404);
    expect(await inboxFor(theirMilestone)).toHaveLength(0);

    const first = await deliver(mine.deal.id, myMilestone);
    const second = await deliver(mine.deal.id, myMilestone);
    expect(await first.json()).toEqual({ status: "submitted" });
    expect(await second.json()).toEqual({ status: "already_submitted" });
    const rows = await inboxFor(myMilestone);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.message).toEqual({
      type: "delivery.detected",
      milestoneId: myMilestone,
      source: "manual",
      repo: null,
      sha: null,
      prNumber: null,
      urls: ["https://staging.example.com/"],
    });
  });
});
