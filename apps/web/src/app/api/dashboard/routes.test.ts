import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ member: vi.fn(), data: vi.fn(), turn: vi.fn() }));
vi.mock("@/server/session", () => ({ memberOrNull: mocks.member }));
vi.mock("@/server/db", () => ({ getDb: () => ({}) }));
vi.mock("@tranche/agents/dashboard/data", () => ({
  loadDashboardData: mocks.data,
}));
vi.mock("@tranche/agents/dashboard/llm", async (original) => ({
  ...(await original<typeof import("@tranche/agents/dashboard/llm")>()),
  runStudioTurn: mocks.turn,
}));
vi.mock("@tranche/agents/models", () => ({
  selectModels: () => ({ fast: "fake" }),
}));

import { StudioRateLimitError } from "@tranche/agents/dashboard/llm";
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
  it("returns quota exhaustion as 429 instead of generic 503", async () => {
    mocks.member.mockResolvedValue({ workspaceId: "mine" });
    mocks.turn.mockRejectedValue(new StudioRateLimitError());
    const response = await POST(
      new Request("http://localhost/api/dashboard/llm", {
        method: "POST",
        body: JSON.stringify({ input: [] }),
      }),
    );
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "model_rate_limited" });
  });
});
