import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ member: vi.fn(), complete: vi.fn() }));
vi.mock("@/server/session", () => ({ memberOrNull: mocks.member }));
vi.mock("@/server/db", () => ({ getDb: () => ({}) }));
vi.mock("@/server/paypal", () => ({
  getPayPal: () => ({}),
  appUrl: () => "http://localhost:3000",
  holdMechanism: () => "authorization",
}));
vi.mock("@/server/onboarding", () => ({ completeOnboarding: mocks.complete }));

import { GET } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.member.mockResolvedValue({ workspaceId: "workspace" });
});
it("redirects a failed check to a safe error state instead of returning HTTP 500", async () => {
  mocks.complete.mockRejectedValue(new Error("private provider details"));
  const res = await GET(new Request("http://localhost:3000/api/paypal/onboarding/return"));
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("http://localhost:3000/onboarding?paypalCheck=failed");
});
it("requires sign-in before checking a seller", async () => {
  mocks.member.mockResolvedValue(null);
  const res = await GET(new Request("http://localhost:3000/api/paypal/onboarding/return"));
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toContain("/sign-in?next=");
  expect(mocks.complete).not.toHaveBeenCalled();
});
it("returns to Connections after a completed check", async () => {
  mocks.complete.mockResolvedValue({ status: "pending" });
  const res = await GET(new Request("http://localhost:3000/api/paypal/onboarding/return"));
  expect(res.headers.get("location")).toBe("http://localhost:3000/onboarding");
});
