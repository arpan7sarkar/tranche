import type { DealStatus } from "@tranche/contracts";
import { createDb, type Db, migrateDb, resolveMagicLink, schema } from "@tranche/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeal, createUser, createWorkspace, one } from "@/server/test-fixtures";

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), requestHeaders: vi.fn() }));

vi.mock("@/server/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
vi.mock("next/headers", () => ({ headers: async () => mocks.requestHeaders() }));
vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new Error(`redirect:${target}`);
  },
}));

const url = process.env.DATABASE_URL;

describe.runIf(Boolean(url))("POST /api/deals/[dealId]/send", { timeout: 20_000 }, () => {
  let db: Db;
  let POST: typeof import("./[dealId]/send/route").POST;

  beforeAll(async () => {
    db = createDb(url);
    await migrateDb(db);
    ({ POST } = await import("./[dealId]/send/route"));
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

  async function draftDeal(status: DealStatus = "draft") {
    const fixture = await createDeal(db, { milestones: 2 });
    if (status !== "draft") {
      await db.update(schema.deal).set({ status }).where(eq(schema.deal.id, fixture.deal.id));
    }
    return { ...fixture, dealId: fixture.deal.id };
  }

  function send(dealId: string) {
    return POST(new Request(`http://localhost/api/deals/${dealId}/send`, { method: "POST" }), {
      params: Promise.resolve({ dealId }),
    } as Parameters<typeof POST>[1]);
  }

  const planSentEvents = (dealId: string) =>
    db
      .select()
      .from(schema.event)
      .where(and(eq(schema.event.dealId, dealId), eq(schema.event.type, "deal.plan_sent")));

  const linksOf = (dealId: string) =>
    db.select().from(schema.magicLink).where(eq(schema.magicLink.dealId, dealId));

  const statusOf = async (dealId: string) =>
    one(await db.select().from(schema.deal).where(eq(schema.deal.id, dealId))).status;

  async function expectNothingHappened(dealId: string, status: DealStatus) {
    expect(await planSentEvents(dealId)).toHaveLength(0);
    expect(await linksOf(dealId)).toHaveLength(0);
    expect(await statusOf(dealId)).toBe(status);
  }

  it("answers 401 without a session and changes nothing", async () => {
    const { dealId } = await draftDeal();
    const res = await send(dealId);
    expect(res.status).toBe(401);
    await expectNothingHappened(dealId, "draft");
  });

  it("answers 404 for another workspace's deal, leaks nothing and changes nothing", async () => {
    const { dealId, deal } = await draftDeal();
    await signInTo((await createWorkspace(db)).id);
    const res = await send(dealId);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain(deal.title);
    await expectNothingHappened(dealId, "draft");
  });

  it("answers 404 for a dealId that is not a UUID or does not exist", async () => {
    const { workspaceId } = await draftDeal();
    await signInTo(workspaceId);
    for (const bad of ["not-a-uuid", crypto.randomUUID()]) {
      expect((await send(bad)).status).toBe(404);
    }
  });

  it.each(["sent", "negotiating", "agreed", "active", "completed", "cancelled"] as const)(
    "answers 409 with an error for a %s deal and changes nothing",
    async (status) => {
      const { dealId, workspaceId } = await draftDeal(status);
      await signInTo(workspaceId);
      const res = await send(dealId);
      expect(res.status).toBe(409);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(await res.json()).toEqual({ error: expect.any(String) });
      await expectNothingHappened(dealId, status);
    },
  );

  it("answers 409 plan_has_no_milestones for a draft with no milestones and writes nothing", async () => {
    const fixture = await createDeal(db);
    expect(fixture.milestones).toHaveLength(0);
    await signInTo(fixture.workspaceId);
    const res = await send(fixture.deal.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "plan_has_no_milestones" });
    await expectNothingHappened(fixture.deal.id, "draft");
  });

  describe("on a draft deal", () => {
    it("answers 200 with exactly { portalUrl }", async () => {
      const { dealId, workspaceId } = await draftDeal();
      await signInTo(workspaceId);
      const res = await send(dealId);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Object.keys(body)).toEqual(["portalUrl"]);
      expect(new URL(body.portalUrl).pathname).toMatch(/^\/portal\/[A-Za-z0-9_-]{43}$/);
    });

    it("returns a portal URL that resolves to this deal and its client", async () => {
      const { dealId, clientId, workspaceId } = await draftDeal();
      await signInTo(workspaceId);
      const { portalUrl } = await (await send(dealId)).json();
      const token = new URL(portalUrl).pathname.split("/").at(-1) ?? "";
      expect(await resolveMagicLink(db, token)).toEqual({ clientId, dealId });
      expect(await linksOf(dealId)).toHaveLength(1);
    });

    it("writes exactly one deal.plan_sent event whose payload is exactly { clientId }", async () => {
      const { dealId, clientId, workspaceId } = await draftDeal();
      await signInTo(workspaceId);
      await send(dealId);
      const events = await planSentEvents(dealId);
      expect(events).toHaveLength(1);
      expect(events[0]?.payload).toEqual({ clientId });
      expect(events[0]?.milestoneId).toBeNull();
    });

    it("never puts the token, the URL or the client email into any event of the deal", async () => {
      const { dealId, workspaceId, clientId } = await draftDeal();
      await signInTo(workspaceId);
      const { portalUrl } = await (await send(dealId)).json();
      const token = new URL(portalUrl).pathname.split("/").at(-1) ?? "";
      const all = JSON.stringify(
        await db.select().from(schema.event).where(eq(schema.event.dealId, dealId)),
      );
      expect(all).not.toContain(token);
      expect(all).not.toContain(portalUrl);
      expect(all).not.toContain("/portal/");
      const [client] = await db.select().from(schema.client).where(eq(schema.client.id, clientId));
      expect(all).not.toContain(client?.email ?? "unreachable");
    });

    it("moves the deal out of draft", async () => {
      const { dealId, workspaceId } = await draftDeal();
      await signInTo(workspaceId);
      await send(dealId);
      expect(await statusOf(dealId)).toBe("sent");
    });

    it("answers 409 on a second send and writes no second event or link", async () => {
      const { dealId, workspaceId } = await draftDeal();
      await signInTo(workspaceId);
      expect((await send(dealId)).status).toBe(200);
      expect((await send(dealId)).status).toBe(409);
      expect(await planSentEvents(dealId)).toHaveLength(1);
      expect(await linksOf(dealId)).toHaveLength(1);
    });

    it("sends exactly once when the agency double-clicks", async () => {
      const { dealId, workspaceId } = await draftDeal();
      await signInTo(workspaceId);
      const responses = await Promise.all(Array.from({ length: 6 }, () => send(dealId)));
      expect(responses.map((r) => r.status).sort()).toEqual([200, 409, 409, 409, 409, 409]);
      expect(await planSentEvents(dealId)).toHaveLength(1);
      expect(await linksOf(dealId)).toHaveLength(1);
    });

    it("does not touch the events or status of another deal", async () => {
      const mine = await draftDeal();
      const other = await draftDeal();
      await signInTo(mine.workspaceId);
      await send(mine.dealId);
      await expectNothingHappened(other.dealId, "draft");
    });
  });
});
