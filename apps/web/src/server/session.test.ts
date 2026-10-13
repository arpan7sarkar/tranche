import { createDb, type Db, migrateDb, schema } from "@tranche/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seed } from "../../../../packages/db/src/seed";
import { createWorkspace } from "./test-fixtures";

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("./auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ cookie: "session=test" }) }));

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

  beforeAll(async () => {
    db = createDb(url);
    await migrateDb(db);
    ids = await seed(db);
    ({ requireDealAccess, memberOrNull } = await import("./session"));
  });
  afterAll(async () => {
    await db.$client.end();
  });
  beforeEach(() => {
    mocks.getSession.mockReset();
  });

  async function joinWorkspace(workspaceId: string, role: "owner" | "member" = "member") {
    const userId = `user-${crypto.randomUUID()}`;
    await db.insert(schema.workspaceMember).values({ workspaceId, userId, role });
    return userId;
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

    it("returns null for a signed-in user with no workspace membership", async () => {
      signedInAs(`user-${crypto.randomUUID()}`);
      expect(await memberOrNull(new Request("http://localhost/api/deals/x"))).toBeNull();
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
});
