import { afterEach, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/server/db", () => ({ getDb: () => ({ execute }) }));

import { GET } from "./route";

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
it("checks the database without using a model or caching the response", async () => {
  execute.mockResolvedValue([]);
  const result = await GET();
  expect(result.status).toBe(200);
  expect(result.headers.get("cache-control")).toBe("no-store");
  expect(await result.json()).toEqual({ ok: true });
});
it("returns a redacted 503 on failure", async () => {
  execute.mockRejectedValue(new Error("private database URL"));
  const result = await GET();
  expect(result.status).toBe(503);
  expect(await result.json()).toEqual({ ok: false });
});
it("bounds the response time when the database stops responding", async () => {
  vi.useFakeTimers();
  execute.mockReturnValue(new Promise(() => {}));
  const pending = GET();
  await vi.advanceTimersByTimeAsync(3000);
  expect((await pending).status).toBe(503);
});
