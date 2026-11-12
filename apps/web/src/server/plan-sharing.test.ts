import { type Db, resolveMagicLink, schema } from "@tranche/db";
import { createTestDb } from "@tranche/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createPlanShareLink, getPlanSharing, recordPortalOpened } from "./plan-sharing";
import { createDeal } from "./test-fixtures";

const mocks = vi.hoisted(() => ({ access: vi.fn(), db: vi.fn(), resolve: vi.fn() }));
vi.mock("@/server/session", () => ({ requireDealAccess: mocks.access }));
vi.mock("@/server/db", () => ({ getDb: mocks.db }));
vi.mock("@/server/portal", () => ({ resolvePortalToken: mocks.resolve }));

describe.runIf(Boolean(process.env.DATABASE_URL))("plan sharing", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createTestDb("plan_sharing");
    mocks.db.mockImplementation(() => db);
  });
  afterAll(async () => {
    await db?.$client.end();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function fixture() {
    const result = await createDeal(db, { milestones: 1 });
    await db.update(schema.deal).set({ status: "sent" }).where(eq(schema.deal.id, result.deal.id));
    const [event] = await db
      .insert(schema.event)
      .values({
        dealId: result.deal.id,
        type: "deal.plan_sent",
        payload: { clientId: result.clientId },
      })
      .returning();
    if (!event) throw new Error("Missing plan event");
    return { ...result, event };
  }

  it("reports manual sharing when email is unconfigured, even if a worker queued a job", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    vi.stubEnv("APP_URL", "http://localhost:3000");
    const { deal, event, clientId } = await fixture();
    await db.insert(schema.notificationJob).values({
      key: `event:${event.id}:${clientId}`,
      dealId: deal.id,
      side: "client",
      recipientId: clientId,
      to: "fictional@example.com",
      subject: "Plan",
      body: "Review",
      linkExpiresAt: new Date(Date.now() + 86400000),
    });
    expect(await getPlanSharing(db, deal.id)).toMatchObject({
      emailStatus: "unconfigured",
      sentAt: null,
      openedAt: null,
      localOnly: true,
    });
  });

  it("reports provider acceptance without claiming inbox delivery", async () => {
    const { deal, event, clientId } = await fixture();
    await db.insert(schema.notificationJob).values({
      key: `event:${event.id}:${clientId}`,
      dealId: deal.id,
      side: "client",
      recipientId: clientId,
      to: "fictional@example.com",
      subject: "Plan",
      body: "Review",
      status: "sent",
      sentAt: new Date(),
      linkExpiresAt: new Date(Date.now() + 86400000),
    });
    expect(await getPlanSharing(db, deal.id)).toMatchObject({
      emailStatus: "sent",
      sentAt: expect.any(String),
      openedAt: null,
    });
  });

  it("creates another valid private link without resending email or changing the plan", async () => {
    const { deal, clientId } = await fixture();
    const link = await createPlanShareLink(db, deal.id);
    const token = link?.split("/").at(-1);
    if (!token) throw new Error("Missing client link");
    expect(await resolveMagicLink(db, token)).toEqual({
      dealId: deal.id,
      clientId,
    });
    const events = await db.select().from(schema.event).where(eq(schema.event.dealId, deal.id));
    expect(events).toHaveLength(1);
    const draft = await createDeal(db);
    expect(await createPlanShareLink(db, draft.deal.id)).toBeNull();
  });

  it("records one first-open timestamp for concurrent portal visits, without recording tokens", async () => {
    const { deal } = await fixture();
    await Promise.all(Array.from({ length: 8 }, () => recordPortalOpened(db, deal.id)));
    const rows = await db
      .select()
      .from(schema.event)
      .where(and(eq(schema.event.dealId, deal.id), eq(schema.event.type, "deal.portal_opened")));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toEqual({});
    expect((await getPlanSharing(db, deal.id)).openedAt).toBe(rows[0]?.createdAt.toISOString());
  });

  it("rejects unauthorized sharing requests and invalid portal tokens", async () => {
    mocks.access.mockResolvedValue({ ok: false, response: new Response(null, { status: 404 }) });
    const route = await import("@/app/api/deals/[dealId]/sharing/route");
    const context = { params: Promise.resolve({ dealId: crypto.randomUUID() }) };
    expect((await route.GET(new Request("http://localhost"), context)).status).toBe(404);
    expect(
      (await route.POST(new Request("http://localhost", { method: "POST" }), context)).status,
    ).toBe(404);
    mocks.resolve.mockResolvedValue(null);
    const opened = await import("@/app/api/portal/[token]/opened/route");
    expect(
      (
        await opened.POST(new Request("http://localhost", { method: "POST" }), {
          params: Promise.resolve({ token: "bad" }),
        })
      ).status,
    ).toBe(404);
  });
});
