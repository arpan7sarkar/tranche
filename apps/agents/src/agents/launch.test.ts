import { afterEach, expect, it, vi } from "vitest";
import { launch } from "./launch";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("submits a stable job identity to the authenticated VPS without redirects", async () => {
  vi.stubEnv("WORKER_URL", "https://worker.example.com");
  vi.stubEnv("WORKER_TOKEN", "s".repeat(32));
  const request = vi.fn(async () => new Response(null, { status: 202 }));
  vi.stubGlobal("fetch", request);
  const inline = vi.fn();
  await launch("moneyTick", [], "same-key", inline);
  expect(request).toHaveBeenCalledWith(
    "https://worker.example.com/jobs",
    expect.objectContaining({
      redirect: "error",
      body: JSON.stringify({ task: "moneyTick", args: [], key: "same-key" }),
    }),
  );
  expect(inline).not.toHaveBeenCalled();
});
it("fails closed in production without worker configuration", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("WORKER_URL", "");
  vi.stubEnv("WORKER_TOKEN", "");
  await expect(launch("moneyTick", [], "key", vi.fn())).rejects.toThrow(
    "worker_configuration_required",
  );
});
it("permits local fallback but never arbitrary remote task names", async () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("WORKER_URL", "");
  vi.stubEnv("WORKER_TOKEN", "");
  const inline = vi.fn();
  await launch("moneyTick", [], "key", inline);
  expect(inline).toHaveBeenCalledOnce();
  await expect(launch("reconcile", [], "key", inline)).rejects.toThrow();
});
