import { expect, it, vi } from "vitest";
import { deploymentSmoke, type HealthObservation } from "../support/deployment-smoke";

const now = Date.parse("2026-10-29T12:00:00Z");
const health = (source: string): HealthObservation => ({
  kind: "tranche-deployment-health",
  source,
  ok: true,
  schemaReady: true,
  webhookConfigured: true,
  observedAt: new Date(now).toISOString(),
});
const deps = () => ({
  fetch: vi.fn<typeof fetch>(async (url) =>
    String(url).endsWith("/api/health")
      ? Response.json({ ok: true })
      : new Response(null, { status: 405 }),
  ),
  workflow: async () => health("smoke"),
  cron: async () => [health("cron:tick"), health("cron:reconcile")],
});
it("checks web, database, workflows, actual cron observations, and webhook configuration without PayPal calls", async () => {
  const d = deps();
  expect((await deploymentSmoke("https://tranche.example", d, "ready", now)).ok).toBe(true);
  expect(d.fetch).toHaveBeenCalledTimes(2);
  expect(
    d.fetch.mock.calls.every(([url]) => String(url).startsWith("https://tranche.example/")),
  ).toBe(true);
});
it("fails when cron history is missing or stale, even if manual health succeeded", async () => {
  const d = deps();
  d.cron = async () => [{ ...health("cron:tick"), observedAt: "2026-10-28T12:00:00Z" }];
  expect((await deploymentSmoke("https://tranche.example", d, "ready", now)).ok).toBe(false);
});
it("allows bootstrap before webhook registration but never labels it ready", async () => {
  const d = deps();
  d.workflow = async () => ({ ...health("smoke"), webhookConfigured: false });
  expect((await deploymentSmoke("https://tranche.example", d, "bootstrap", now)).ok).toBe(true);
  expect((await deploymentSmoke("https://tranche.example", d, "ready", now)).ok).toBe(false);
});
it("does not follow redirects or expose provider error details", async () => {
  const d = deps();
  d.workflow = async () => {
    throw new Error("private key");
  };
  const result = await deploymentSmoke("https://tranche.example", d, "ready", now);
  expect(result.ok).toBe(false);
  expect(JSON.stringify(result)).not.toContain("private");
  expect(d.fetch.mock.calls[0]?.[1]?.redirect).toBe("error");
  await expect(deploymentSmoke("http://tranche.example", d)).rejects.toThrow();
});
