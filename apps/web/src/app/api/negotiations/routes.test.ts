import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  start: vi.fn(),
  latest: vi.fn(),
  view: vi.fn(),
  kick: vi.fn(),
  after: vi.fn(),
}));
vi.mock("@/server/session", () => ({ memberOrNull: mocks.member }));
vi.mock("@/server/db", () => ({ getDb: () => ({}) }));
vi.mock("@/server/negotiations", () => ({
  startNegotiation: mocks.start,
  latestNegotiation: mocks.latest,
  loadNegotiationView: mocks.view,
  kickNegotiation: mocks.kick,
}));
vi.mock("next/server", () => ({ after: mocks.after }));

import { GET as detail } from "./[id]/route";
import { GET, POST } from "./route";

const id = crypto.randomUUID();
const ctx = { params: Promise.resolve({ id }) };
const input = { dealId: id, client: { limitMinor: 10000, latestEndDate: null, maxRounds: 3 } };
const request = (body = input) =>
  new Request("http://localhost/api/negotiations", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => vi.resetAllMocks());
it("requires authentication for every route before reading data", async () => {
  mocks.member.mockResolvedValue(null);
  expect((await GET(new Request(`http://localhost?dealId=${id}`))).status).toBe(401);
  expect((await POST(request())).status).toBe(401);
  expect((await detail(new Request("http://localhost"), ctx)).status).toBe(401);
  expect(mocks.start).not.toHaveBeenCalled();
  expect(mocks.view).not.toHaveBeenCalled();
});
it("uses only the authenticated workspace and hides foreign rooms", async () => {
  mocks.member.mockResolvedValue({ workspaceId: "trusted" });
  mocks.view.mockResolvedValue(null);
  expect((await detail(new Request("http://localhost?workspaceId=foreign"), ctx)).status).toBe(404);
  expect(mocks.view).toHaveBeenCalledWith({}, "trusted", id);
});
it("rejects malformed budgets and dates before starting", async () => {
  mocks.member.mockResolvedValue({ workspaceId: "trusted" });
  expect(
    (await POST(request({ ...input, client: { ...input.client, limitMinor: -1 } }))).status,
  ).toBe(422);
  expect(mocks.start).not.toHaveBeenCalled();
});
it("returns the durable identity before scheduling the recoverable kick", async () => {
  mocks.member.mockResolvedValue({ workspaceId: "trusted" });
  mocks.start.mockResolvedValue({ ok: true, negotiationId: id });
  expect((await POST(request())).status).toBe(202);
  expect(mocks.start).toHaveBeenCalledWith({}, "trusted", input);
  expect(mocks.after).toHaveBeenCalledOnce();
  expect(mocks.kick).not.toHaveBeenCalled();
  await mocks.after.mock.calls[0]?.[0]();
  expect(mocks.kick).toHaveBeenCalledWith(id);
});
it("returns named conflicts and no kick for a deal that cannot negotiate", async () => {
  mocks.member.mockResolvedValue({ workspaceId: "trusted" });
  mocks.start.mockResolvedValue({ ok: false, error: "send_plan_first" });
  expect((await POST(request())).status).toBe(409);
  expect(mocks.after).not.toHaveBeenCalled();
});
