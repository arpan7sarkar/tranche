import { decryptGmailToken, GMAIL_SEND_SCOPE, gmailConfig } from "@tranche/agents-service/gmail";
import { type Db, schema } from "@tranche/db";
import { createTestDb } from "@tranche/db/testing";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { beginGmail, consumeGmailState, finishGmail, gmailOwner, gmailSameOrigin } from "./gmail";
import type { Member } from "./session";
import { createDeal, createUser } from "./test-fixtures";

const mocks = vi.hoisted(() => ({ db: vi.fn(), member: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.db }));
vi.mock("./session", () => ({ getMember: mocks.member }));

describe.runIf(Boolean(process.env.DATABASE_URL))("Gmail connection", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createTestDb("gmail_oauth");
    mocks.db.mockImplementation(() => db);
  });
  afterAll(async () => {
    await db?.$client.end();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function owner() {
    vi.stubEnv("GMAIL_CLIENT_ID", "test-client");
    vi.stubEnv("GMAIL_CLIENT_SECRET", "test-secret");
    vi.stubEnv("GMAIL_REDIRECT_URI", "http://localhost:3000/api/gmail/callback");
    vi.stubEnv("GMAIL_TOKEN_ENCRYPTION_KEY", "ab".repeat(32));
    const { workspaceId } = await createDeal(db);
    const user = await createUser(db, "Fictional Sender");
    await db.insert(schema.workspaceMember).values({ workspaceId, userId: user.id, role: "owner" });
    const member: Member = {
      userId: user.id,
      name: user.name,
      workspaceId,
      workspaceName: "Test workspace",
    };
    mocks.member.mockResolvedValue(member);
    return member;
  }

  function google() {
    const fetch = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("/token")
        ? Response.json({
            access_token: "private-access",
            refresh_token: "private-refresh",
            scope: `openid email ${GMAIL_SEND_SCOPE}`,
          })
        : Response.json({ sub: "google-user", email: "fictional@gmail.com", email_verified: true }),
    );
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  it("requests send-only Gmail access with PKCE and consumes session-bound state exactly once", async () => {
    const member = await owner();
    const start = await beginGmail(member);
    const url = new URL(start.url);
    expect(url.searchParams.get("scope")).toBe(`openid email ${GMAIL_SEND_SCOPE}`);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const [attempt] = await db
      .select()
      .from(schema.verification)
      .where(
        eq(
          schema.verification.identifier,
          `gmail:${(await import("node:crypto")).createHash("sha256").update(start.state).digest("hex")}`,
        ),
      );
    expect(attempt?.identifier).not.toContain(start.state);
    await expect(consumeGmailState(member, start.state, "wrong-cookie")).rejects.toThrow(
      "gmail_invalid_state",
    );
    expect(await consumeGmailState(member, start.state, start.state)).toHaveLength(43);
    await expect(consumeGmailState(member, start.state, start.state)).rejects.toThrow(
      "gmail_invalid_state",
    );
  });

  it("rejects state from another workspace and expired state", async () => {
    const member = await owner();
    const start = await beginGmail(member);
    await expect(
      consumeGmailState({ ...member, workspaceId: crypto.randomUUID() }, start.state, start.state),
    ).rejects.toThrow("gmail_invalid_state");
    const expired = await beginGmail(member);
    await db.update(schema.verification).set({ expiresAt: new Date(0) });
    await expect(consumeGmailState(member, expired.state, expired.state)).rejects.toThrow(
      "gmail_invalid_state",
    );
  });

  it("exchanges the callback once and stores only encrypted refresh credentials", async () => {
    const member = await owner();
    const start = await beginGmail(member);
    const fetch = google();
    const { GET } = await import("@/app/api/gmail/callback/route");
    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/gmail/callback?state=${start.state}&code=test-code`,
        { headers: { cookie: `tranche_gmail_state=${start.state}` } },
      ),
    );
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/onboarding?gmail=connected",
    );
    const [row] = await db
      .select()
      .from(schema.gmailConnection)
      .where(eq(schema.gmailConnection.workspaceId, member.workspaceId));
    expect(row?.email).toBe("fictional@gmail.com");
    expect(row?.refreshTokenCiphertext).not.toContain("private-refresh");
    const config = gmailConfig();
    if (!row || !config) throw new Error("Missing connection");
    expect(decryptGmailToken(row.refreshTokenCiphertext, member.workspaceId, config.key)).toBe(
      "private-refresh",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    const again = await GET(
      new NextRequest(
        `http://localhost:3000/api/gmail/callback?state=${start.state}&code=test-code`,
        { headers: { cookie: `tranche_gmail_state=${start.state}` } },
      ),
    );
    expect(again.headers.get("location")).toContain("gmail=failed");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("preserves an existing connection if send permission is missing or consent is cancelled", async () => {
    const member = await owner();
    google();
    await finishGmail(member, "code", "verifier");
    const [before] = await db
      .select()
      .from(schema.gmailConnection)
      .where(eq(schema.gmailConnection.workspaceId, member.workspaceId));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ access_token: "a", refresh_token: "r", scope: "openid email" }),
      ),
    );
    await expect(finishGmail(member, "code", "verifier")).rejects.toThrow(
      "gmail_permission_missing",
    );
    const start = await beginGmail(member);
    const { GET } = await import("@/app/api/gmail/callback/route");
    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/gmail/callback?state=${start.state}&error=access_denied`,
        { headers: { cookie: `tranche_gmail_state=${start.state}` } },
      ),
    );
    expect(response.headers.get("location")).toContain("gmail=denied");
    const [after] = await db
      .select()
      .from(schema.gmailConnection)
      .where(eq(schema.gmailConnection.workspaceId, member.workspaceId));
    expect(after?.id).toBe(before?.id);
  });

  it("requires workspace ownership and same-origin requests for connection changes", async () => {
    const member = await owner();
    expect(await gmailOwner()).toEqual(member);
    expect(
      gmailSameOrigin(
        new Request("http://localhost:3000", { headers: { origin: "https://other.example" } }),
      ),
    ).toBe(false);
    await db
      .update(schema.workspaceMember)
      .set({ role: "member" })
      .where(eq(schema.workspaceMember.userId, member.userId));
    expect(await gmailOwner()).toBeNull();
    const { POST } = await import("@/app/api/gmail/connect/route");
    expect(
      (
        await POST(
          new Request("http://localhost:3000/api/gmail/connect", {
            method: "POST",
            headers: { origin: "http://localhost:3000" },
          }),
        )
      ).status,
    ).toBe(403);
  });

  it("disconnects locally even when Google revocation is unavailable", async () => {
    const member = await owner();
    google();
    await finishGmail(member, "code", "verifier");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("unavailable");
      }),
    );
    const { POST } = await import("@/app/api/gmail/disconnect/route");
    expect(
      (
        await POST(
          new Request("http://localhost:3000/api/gmail/disconnect", {
            method: "POST",
            headers: { origin: "http://localhost:3000" },
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      await db
        .select()
        .from(schema.gmailConnection)
        .where(eq(schema.gmailConnection.workspaceId, member.workspaceId)),
    ).toHaveLength(0);
  });
});
