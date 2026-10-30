import { afterEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("postgres", () => ({
  default: vi.fn(() => {
    throw new Error("persistent_listener_forbidden");
  }),
}));

import { subscribe } from "./event-hub";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
it("polls for Vercel catch-up and releases the timer on disconnect", async () => {
  vi.useFakeTimers();
  vi.stubEnv("VERCEL", "1");
  const onResync = vi.fn();
  const unsubscribe = await subscribe({ onResync, onEvent: vi.fn() });
  await vi.advanceTimersByTimeAsync(3000);
  expect(onResync).toHaveBeenCalledOnce();
  unsubscribe();
  await vi.advanceTimersByTimeAsync(6000);
  expect(onResync).toHaveBeenCalledOnce();
});
