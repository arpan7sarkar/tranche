import { afterEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ createDb: vi.fn(() => ({})) }));
vi.mock("@tranche/db", () => ({ createDb: mocks.createDb }));

afterEach(() => {
  Reflect.deleteProperty(globalThis, "trancheWebDb");
  vi.resetModules();
  vi.clearAllMocks();
});

it("reuses the database pool after a server module reload", async () => {
  const first = (await import("./db")).getDb();
  vi.resetModules();
  const reloaded = (await import("./db")).getDb();

  expect(reloaded).toBe(first);
  expect(mocks.createDb).toHaveBeenCalledTimes(1);
});
