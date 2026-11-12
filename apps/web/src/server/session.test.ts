import { createDb, type Db, migrateDb, schema } from "@tranche/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seed } from "../../../../packages/db/src/seed";
import { createUser, createWorkspace } from "./test-fixtures";

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), requestHeaders: vi.fn() }));

vi.mock("./auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("next/headers", () => ({ headers: async () => mocks.requestHeaders() }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new Error(`redirect:${target}`);
  },
}));

const url = process.env.DATABASE_URL;

function signedInAs(userId: string, name = "Test User") {
  mocks.getSession.mockResolvedValue({
    session: { id: `s-${userId}` },
    user: { id: userId, name },
  });
}

describe.runIf(Boolean(url))("session helpers", () => {
  let db: Db;
  let ids: Awaited<ReturnType<typeof seed>>;
  let requireDealAccess: typeof import("./session").requireDealAccess;
  let memberOrNull: typeof import("./session").memberOrNull;
  let getMember: typeof import("./session").getMember;
  let requireMember: typeof import("./session").requireMember;

  beforeAll(async () => {
    db = createDb(url);
    await migrateDb(db);
    ids = await seed(db);
    ({ requireDealAccess, memberOrNull, getMember, requireMember } = await import("./session"));
  });
  afterAll(async () => {
    await db.$client.end();
  });
  beforeEach(() => {
    mocks.getSession.mockReset();
    mocks.requestHeaders.mockReset();
    mocks.requestHeaders.mockReturnValue(new Headers({ cookie: "session=test" }));
  });

  async function joinWorkspace(workspaceId: string, role: "owner" | "member" = "member") {
    const { id: userId } = await createUser(db);
    await db.insert(schema.workspaceMember).values({ workspaceId, userId, role });
    return userId;
  }

  function membershipsOf(userId: string) {
    return db
      .select()
      .from(schema.workspaceMember)
      .where(eq(schema.workspaceMember.userId, userId));
  }

  function uniqueFirstName() {
    return `Zed${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  }

  describe("requireDealAccess", () => {
    it("answers 401 without a session", async () => {
      mocks.getSession.mockResolvedValue(null);
      const result = await requireDealAccess(ids.dealId);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(401);
    });

    it("answers 404, never 403 and never the deal, for a member of another workspace", async () => {
      const other = await createWorkspace(db);
      signedInAs(await joinWorkspace(other.id));
      const result = await requireDealAccess(ids.dealId);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(404);
        expect(await result.response.text()).not.toContain("Acme storefront rebuild");
      }
    });

    it("returns the user and workspace for a member of the owning workspace", async () => {
      const userId = await joinWorkspace(ids.workspaceId);
      signedInAs(userId);
      expect(await requireDealAccess(ids.dealId)).toEqual({
        ok: true,
        userId,
        workspaceId: ids.workspaceId,
      });
    });

    it("answers 404 for a dealId that is not a UUID instead of throwing", async () => {
      signedInAs(await joinWorkspace(ids.workspaceId));
      for (const bad of ["not-a-uuid", "", "1", `${ids.dealId}x`, "' OR 1=1 --"]) {
        const result = await requireDealAccess(bad);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.response.status).toBe(404);
      }
    });

    it("answers 404 for a well-formed dealId that does not exist", async () => {
      signedInAs(await joinWorkspace(ids.workspaceId));
      const result = await requireDealAccess(crypto.randomUUID());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(404);
    });
  });

  describe("memberOrNull", () => {
    it("returns null without a session", async () => {
      mocks.getSession.mockResolvedValue(null);
      expect(await memberOrNull(new Request("http://localhost/api/deals/x"))).toBeNull();
    });

    it("creates a workspace for a signed-in user with no membership and returns the member", async () => {
      const first = uniqueFirstName();
      const user = await createUser(db, `${first} Tester`);
      signedInAs(user.id, user.name);
      const member = await memberOrNull(new Request("http://localhost/api/deals/x"));
      expect(member).toEqual({
        userId: user.id,
        name: user.name,
        workspaceId: expect.any(String),
        workspaceName: `${first}'s studio`,
      });
      expect(member?.workspaceId).not.toBe(ids.workspaceId);
      expect(await membershipsOf(user.id)).toHaveLength(1);
    });

    it("keeps the repaired workspace on later calls", async () => {
      const user = await createUser(db);
      signedInAs(user.id, user.name);
      const request = new Request("http://localhost/api/deals/x");
      const first = await memberOrNull(request);
      const second = await memberOrNull(request);
      expect(second?.workspaceId).toBe(first?.workspaceId);
      expect(await membershipsOf(user.id)).toHaveLength(1);
    });

    it("creates exactly one workspace and membership under concurrent calls", async () => {
      const first = uniqueFirstName();
      const user = await createUser(db, `${first} Tester`);
      signedInAs(user.id, user.name);
      const request = new Request("http://localhost/api/deals/x");
      const members = await Promise.all(Array.from({ length: 8 }, () => memberOrNull(request)));
      expect(new Set(members.map((m) => m?.workspaceId)).size).toBe(1);
      expect(members[0]).not.toBeNull();
      expect(await membershipsOf(user.id)).toHaveLength(1);
      const workspaces = await db
        .select()
        .from(schema.workspace)
        .where(eq(schema.workspace.name, `${first}'s studio`));
      expect(workspaces).toHaveLength(1);
    });

    it("returns the member and reads the session from the request headers", async () => {
      const userId = await joinWorkspace(ids.workspaceId);
      signedInAs(userId, "Ada Lovelace");
      const request = new Request("http://localhost/api/deals/x", { headers: { cookie: "a=b" } });
      expect(await memberOrNull(request)).toEqual({
        userId,
        name: "Ada Lovelace",
        workspaceId: ids.workspaceId,
        workspaceName: "Northwind Studio",
      });
      expect(mocks.getSession).toHaveBeenCalledWith(
        expect.objectContaining({ headers: request.headers }),
      );
    });
  });

  describe("getMember and requireMember", () => {
    it("getMember repairs a signed-in user with no membership", async () => {
      const user = await createUser(db);
      signedInAs(user.id, user.name);
      const member = await getMember();
      expect(member?.userId).toBe(user.id);
      expect(await membershipsOf(user.id)).toHaveLength(1);
    });

    it("requireMember repairs instead of redirecting", async () => {
      const user = await createUser(db);
      signedInAs(user.id, user.name);
      const member = await requireMember();
      expect(member.workspaceId).toEqual(expect.any(String));
      expect(await membershipsOf(user.id)).toHaveLength(1);
    });
  });

  describe("requireMember redirect target", () => {
    async function redirectedTo(path: string | null) {
      mocks.getSession.mockResolvedValue(null);
      mocks.requestHeaders.mockReturnValue(
        new Headers(path === null ? {} : { "x-tranche-path": path }),
      );
      try {
        await requireMember();
      } catch (error) {
        return (error as Error).message;
      }
      return "no redirect";
    }

    it("sends the user to sign-in with the deep link they asked for", async () => {
      expect(await redirectedTo("/deals/abc?filter=x")).toBe(
        `redirect:/sign-in?next=${encodeURIComponent("/deals/abc?filter=x")}`,
      );
    });

    it("sends a plain /sign-in when the header is absent", async () => {
      expect(await redirectedTo(null)).toBe("redirect:/sign-in");
    });

    it.each(["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)", "", "deals"])(
      "sends a plain /sign-in for the unsafe header %j",
      async (path) => {
        expect(await redirectedTo(path)).toBe("redirect:/sign-in");
      },
    );
  });
});
