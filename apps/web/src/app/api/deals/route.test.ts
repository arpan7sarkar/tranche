import { createDb, type Db, migrateDb } from "@tranche/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspace } from "@/server/test-fixtures";
import { seed } from "../../../../../../packages/db/src/seed";

const mocks = vi.hoisted(() => ({ memberOrNull: vi.fn() }));

vi.mock("@/server/session", () => ({ memberOrNull: mocks.memberOrNull }));

const url = process.env.DATABASE_URL;

describe.runIf(Boolean(url))("GET /api/deals/[dealId]", () => {
  let db: Db;
  let ids: Awaited<ReturnType<typeof seed>>;
  let GET: typeof import("./[dealId]/route").GET;

  beforeAll(async () => {
    db = createDb(url);
    await migrateDb(db);
    ids = await seed(db);
    ({ GET } = await import("./[dealId]/route"));
  });
  afterAll(async () => {
    await db.$client.end();
  });
  beforeEach(() => {
    mocks.memberOrNull.mockReset();
  });

  function call(dealId: string) {
    return GET(new Request(`http://localhost/api/deals/${dealId}`), {
      params: Promise.resolve({ dealId }),
    } as Parameters<typeof GET>[1]);
  }

  function member(workspaceId: string) {
    return { userId: "user-1", name: "Ada", workspaceId, workspaceName: "Studio" };
  }

  it("answers 401 without a member", async () => {
    mocks.memberOrNull.mockResolvedValue(null);
    const res = await call(ids.dealId);
    expect(res.status).toBe(401);
  });

  it("answers 404 for another workspace's deal without leaking it", async () => {
    const other = await createWorkspace(db);
    mocks.memberOrNull.mockResolvedValue(member(other.id));
    const res = await call(ids.dealId);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("Acme storefront rebuild");
  });

  it("answers 404 for a dealId that is not a UUID", async () => {
    mocks.memberOrNull.mockResolvedValue(member(ids.workspaceId));
    const res = await call("not-a-uuid");
    expect(res.status).toBe(404);
  });

  it("answers 200 with the DealView for the owning workspace", async () => {
    mocks.memberOrNull.mockResolvedValue(member(ids.workspaceId));
    const res = await call(ids.dealId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const view = await res.json();
    expect(view.deal).toMatchObject({ id: ids.dealId, title: "Acme storefront rebuild" });
    expect(view.milestones.map((m: { key: string }) => m.key)).toEqual([
      "design",
      "build",
      "launch",
    ]);
    expect(view.tasks).toHaveLength(6);
  });

  it("passes the request to memberOrNull", async () => {
    mocks.memberOrNull.mockResolvedValue(null);
    const request = new Request(`http://localhost/api/deals/${ids.dealId}`);
    await GET(request, { params: Promise.resolve({ dealId: ids.dealId }) } as Parameters<
      typeof GET
    >[1]);
    expect(mocks.memberOrNull).toHaveBeenCalledWith(request);
  });
});
