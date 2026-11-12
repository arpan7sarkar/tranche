import { type Db, schema } from "@tranche/db";
import { createTestDb, truncateAll } from "@tranche/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeMilestone } from "../money/test-helpers";
import { encryptGmailToken, resolveEmailTransport } from "./gmail";
import { deliverNotifications, enqueueNotification } from "./queue";

const env = {
  GMAIL_CLIENT_ID: "test-client",
  GMAIL_CLIENT_SECRET: "test-secret",
  GMAIL_REDIRECT_URI: "http://localhost:3000/api/gmail/callback",
  GMAIL_TOKEN_ENCRYPTION_KEY: "ab".repeat(32),
};
describe.runIf(Boolean(process.env.DATABASE_URL))("Gmail notification delivery", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createTestDb("gmail_delivery");
  });
  beforeEach(async () => {
    await truncateAll(db);
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    await db?.$client.end();
  });
  async function fixture(connect = true) {
    const fixture = await makeMilestone(db);
    if (connect) {
      const id = crypto.randomUUID();
      await db.insert(schema.user).values({ id, name: "Sender", email: "sender@gmail.com" });
      await db.insert(schema.gmailConnection).values({
        workspaceId: fixture.workspaceId,
        connectedBy: id,
        email: "sender@gmail.com",
        name: "Sender",
        googleSubject: "google-user",
        refreshTokenCiphertext: encryptGmailToken(
          "private-refresh",
          fixture.workspaceId,
          Buffer.from(env.GMAIL_TOKEN_ENCRYPTION_KEY, "hex"),
        ),
      });
    }
    await enqueueNotification(db, {
      key: "test-gmail",
      dealId: fixture.dealId,
      side: "client",
      subject: "Your plan",
      body: "Review your plan",
    });
    return fixture;
  }
  it("sends a queued client notification using the connected workspace Gmail and records provider acceptance", async () => {
    await fixture();
    const fetch = vi.fn(async (url: string | URL | Request, _options?: RequestInit) =>
      String(url).includes("/token")
        ? Response.json({ access_token: "access" })
        : Response.json({ id: "gmail-message" }),
    );
    vi.stubGlobal("fetch", fetch);
    const fallback = vi.fn(async () => "resend-message");
    expect(
      await deliverNotifications(db, fallback, 20, resolveEmailTransport(db, fallback, env)),
    ).toBe(1);
    const [job] = await db.select().from(schema.notificationJob);
    expect(job).toMatchObject({ transport: "gmail", status: "sent", providerId: "gmail-message" });
    expect(fallback).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
    const options = fetch.mock.calls[1]?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(options?.body)) as { raw: string };
    expect(Buffer.from(body.raw, "base64url").toString()).toContain("<sender@gmail.com>");
  });
  it("supports concurrent claims without exhausting the connection pool", async () => {
    const { dealId } = await fixture();
    for (let i = 0; i < 11; i++)
      await enqueueNotification(db, {
        key: `concurrent:${i}`,
        dealId,
        side: "client",
        subject: "Review",
        body: "Plan",
      });
    let counter = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) =>
        String(url).includes("/token")
          ? Response.json({ access_token: "access" })
          : Response.json({ id: `message-${++counter}` }),
      ),
    );
    const resolve = resolveEmailTransport(db, null, env);
    const sent = await Promise.all(
      Array.from({ length: 12 }, () => deliverNotifications(db, null, 1, resolve)),
    );
    expect(sent.reduce((a, b) => a + b, 0)).toBe(12);
    expect(counter).toBe(12);
  });
  it("does not retry uncertain Gmail requests or fall back to another provider", async () => {
    await fixture();
    const fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/token")) return Response.json({ access_token: "access" });
      throw new Error("timeout after acceptance");
    });
    vi.stubGlobal("fetch", fetch);
    const fallback = vi.fn(async () => "resend-message");
    const resolver = resolveEmailTransport(db, fallback, env);
    expect(await deliverNotifications(db, fallback, 20, resolver)).toBe(0);
    await db.update(schema.notificationJob).set({ nextAttemptAt: sql`now()` });
    expect(await deliverNotifications(db, fallback, 20, resolver)).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fallback).not.toHaveBeenCalled();
    expect((await db.select().from(schema.notificationJob))[0]?.status).toBe("review");
  });
  it("recovers a process crash without repeating a Gmail attempt", async () => {
    await fixture();
    await db
      .update(schema.notificationJob)
      .set({ transport: "gmail", status: "sending", dispatchedAt: new Date() });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await deliverNotifications(db, null, 20, resolveEmailTransport(db, null, env));
    expect(fetch).not.toHaveBeenCalled();
    expect((await db.select().from(schema.notificationJob))[0]?.status).toBe("review");
  });
  it("keeps Resend retries pinned to their original transport after Gmail is connected", async () => {
    await fixture();
    await db.update(schema.notificationJob).set({
      transport: "resend",
      senderIdentity: "platform@example.com",
      status: "sending",
      dispatchedAt: new Date(),
    });
    const fallback = vi.fn(async () => "resend-id");
    await deliverNotifications(
      db,
      fallback,
      20,
      resolveEmailTransport(db, fallback, { ...env, EMAIL_FROM: "platform@example.com" }),
    );
    expect(fallback).toHaveBeenCalledTimes(1);
    expect((await db.select().from(schema.notificationJob))[0]?.transport).toBe("resend");
  });
  it("retains idempotent Resend retries after an uncertain result", async () => {
    await fixture(false);
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("uncertain"))
      .mockResolvedValue("resend-id");
    expect(await deliverNotifications(db, send)).toBe(0);
    await db.update(schema.notificationJob).set({ nextAttemptAt: sql`now()` });
    expect(await deliverNotifications(db, send)).toBe(1);
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
  });
  it("does not borrow a Gmail connection from a different workspace", async () => {
    await fixture();
    const other = await makeMilestone(db);
    await enqueueNotification(db, {
      key: "other",
      dealId: other.dealId,
      side: "client",
      subject: "Other",
      body: "Other plan",
    });
    const [otherJob] = await db
      .select()
      .from(schema.notificationJob)
      .where(eq(schema.notificationJob.dealId, other.dealId));
    if (!otherJob) throw new Error("Missing fixture");
    expect(await resolveEmailTransport(db, null, env)(otherJob)).toBeNull();
  });
});
