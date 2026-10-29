import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ member: vi.fn(), data: vi.fn(), turn: vi.fn() }));
vi.mock("@/server/session", () => ({ memberOrNull: mocks.member }));
vi.mock("@/server/db", () => ({ getDb: () => ({}) }));
vi.mock("@tranche/agents", async (original) => ({
  ...(await original<typeof import("@tranche/agents")>()),
  loadDashboardData: mocks.data,
  runStudioTurn: mocks.turn,
  selectModels: () => ({ fast: "fake" }),
}));

import { GET } from "./data/route";
import { POST } from "./llm/route";

beforeEach(() => {
  vi.clearAllMocks();
});
describe("dashboard routes", () => {
  it("rejects unauthenticated data and assistant requests", async () => {
    mocks.member.mockResolvedValue(null);
    expect((await GET(new Request("http://localhost/api/dashboard/data"))).status).toBe(401);
    expect(
      (await POST(new Request("http://localhost/api/dashboard/llm", { method: "POST" }))).status,
    ).toBe(401);
    expect(mocks.data).not.toHaveBeenCalled();
    expect(mocks.turn).not.toHaveBeenCalled();
  });
  it("uses authenticated workspace identity and disables caching", async () => {
    mocks.member.mockResolvedValue({ workspaceId: "mine" });
    mocks.data.mockResolvedValue({ currency: "JPY" });
    const response = await GET(
      new Request("http://localhost/api/dashboard/data?workspaceId=foreign&currency=JPY"),
    );
    expect(mocks.data).toHaveBeenCalledWith({}, "mine", "JPY");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("bounds request bytes before sending anything to a model", async () => {
    mocks.member.mockResolvedValue({ workspaceId: "mine" });
    const response = await POST(
      new Request("http://localhost/api/dashboard/llm", {
        method: "POST",
        body: "x".repeat(256 * 1024 + 1),
      }),
    );
    expect(response.status).toBe(413);
    expect(mocks.turn).not.toHaveBeenCalled();
  });
  it("rejects malformed requests and hides provider errors", async () => {
    mocks.member.mockResolvedValue({ workspaceId: "mine" });
    expect(
      (await POST(new Request("http://localhost/api/dashboard/llm", { method: "POST", body: "{" })))
        .status,
    ).toBe(400);
    mocks.turn.mockRejectedValue(new Error("private provider details"));
    const response = await POST(
      new Request("http://localhost/api/dashboard/llm", {
        method: "POST",
        body: JSON.stringify({ input: [] }),
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private");
  });
});
