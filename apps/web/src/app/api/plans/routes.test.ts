import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  status: vi.fn(),
  save: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@/server/session", () => ({ memberOrNull: mocks.member }));
vi.mock("@/server/db", () => ({ getDb: () => ({}) }));
vi.mock("@/server/plans", () => ({
  draftStatus: mocks.status,
  saveDraft: mocks.save,
  createDraftDeal: mocks.create,
}));

import { GET, PUT } from "./[dealId]/route";
import { POST } from "./draft/route";

const dealId = crypto.randomUUID();
const ctx = { params: Promise.resolve({ dealId }) };
beforeEach(() => {
  vi.resetAllMocks();
});
it("rejects unauthenticated reads and mutations before accessing the database", async () => {
  mocks.member.mockResolvedValue(null);
  expect((await GET(new Request("http://localhost"), ctx)).status).toBe(401);
  expect((await PUT(new Request("http://localhost", { method: "PUT" }), ctx)).status).toBe(401);
  expect((await POST(new Request("http://localhost", { method: "POST" }))).status).toBe(401);
  expect(mocks.status).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
});
it("uses session workspace identity and hides missing or foreign deals", async () => {
  mocks.member.mockResolvedValue({ workspaceId: "trusted-workspace" });
  mocks.status.mockResolvedValue(null);
  expect((await GET(new Request("http://localhost?workspaceId=foreign"), ctx)).status).toBe(404);
  expect(mocks.status).toHaveBeenCalledWith({}, "trusted-workspace", dealId);
});
it("rejects malformed dates and brief data", async () => {
  mocks.member.mockResolvedValue({ workspaceId: "trusted-workspace" });
  expect(
    (
      await POST(
        new Request("http://localhost", {
          method: "POST",
          body: JSON.stringify({ startDate: "2026-02-31", brief: "short" }),
        }),
      )
    ).status,
  ).toBe(422);
  expect(mocks.create).not.toHaveBeenCalled();
});
