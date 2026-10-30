import { expect, it, vi } from "vitest";
import { workerRequest } from "./http";

const token = "s".repeat(32);
const deps = () => ({
  token,
  active: true,
  status: async () => ({ ok: true }),
  submit: vi.fn(async () => null),
});
const request = (body: unknown, auth = token) =>
  new Request("https://worker.example/jobs", {
    method: "POST",
    headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
it("rejects missing or invalid authentication before enqueueing", async () => {
  const d = deps();
  expect((await workerRequest(request({}, "bad"), d)).status).toBe(401);
  expect(d.submit).not.toHaveBeenCalled();
});
it("rejects unknown tasks and malformed payloads", async () => {
  const d = deps();
  expect((await workerRequest(request({ task: "reconcile", args: [], key: "k" }), d)).status).toBe(
    400,
  );
  expect(d.submit).not.toHaveBeenCalled();
});
it("acknowledges only durable enqueue completion, including duplicates", async () => {
  const d = deps();
  const body = { task: "moneyTick", args: [], key: "k" };
  expect((await workerRequest(request(body), d)).status).toBe(202);
  expect(d.submit).toHaveBeenCalledWith("moneyTick", [], "k");
  d.submit.mockRejectedValueOnce(new Error("secret database URL"));
  const failed = await workerRequest(request(body), d);
  expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain("secret");
});
it("rejects wakeups while paused and bounds request payloads", async () => {
  expect((await workerRequest(request({}), { ...deps(), active: false })).status).toBe(503);
  expect((await workerRequest(request({ text: "x".repeat(20000) }), deps())).status).toBe(413);
});
