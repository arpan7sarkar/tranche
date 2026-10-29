import { expect, it, vi } from "vitest";
import { dispatchCron, dueTasks, type Start } from "./cron";

const env = {
  RENDER_API_KEY: "key",
  RENDER_WORKFLOW_SLUG: "agents",
  TRANCHE_CRON_MODE: "active",
  TRANCHE_LLM: "off",
};
const now = new Date("2026-10-29T12:00:00Z");
it("launches money and other independent tasks even if model consumption fails", async () => {
  const start = vi.fn(async (slug: string) => {
    if (slug.endsWith("consumeAll")) throw new Error("private provider failure");
  });
  const result = await dispatchCron("tick", env, now, start);
  expect(result.started).toEqual(["deploymentHealth", "moneyTick", "monitor", "notifications"]);
  expect(result.failed).toEqual(["consumeAll"]);
  expect(JSON.stringify(result)).not.toContain("private");
});
it("reuses the same launch identity within a minute and changes it in the next minute", async () => {
  const start = vi.fn<Start>(async () => {});
  await dispatchCron("tick", env, now, start);
  const first = start.mock.calls.map((call) => call);
  start.mockClear();
  await dispatchCron("tick", env, new Date(now.getTime() + 1000), start);
  expect(start.mock.calls[0]?.[2]).toMatchObject({ idempotencyKey: first[0]?.[2]?.idempotencyKey });
  start.mockClear();
  await dispatchCron("tick", env, new Date(now.getTime() + 60000), start);
  expect(start.mock.calls[0]?.[2]?.idempotencyKey).not.toBe(first[0]?.[2]?.idempotencyKey);
});
it("health mode launches only a read-only diagnostic task", async () => {
  const start = vi.fn<Start>(async () => {});
  await dispatchCron("reconcile", { ...env, TRANCHE_CRON_MODE: "health" }, now, start);
  expect(start).toHaveBeenCalledWith(
    "agents/deploymentHealth",
    ["cron:reconcile"],
    expect.any(Object),
  );
});
it("disabled mode launches nothing and invalid schedules fail", async () => {
  const start = vi.fn<Start>(async () => {});
  await dispatchCron("tick", { ...env, TRANCHE_CRON_MODE: "disabled" }, now, start);
  expect(start).not.toHaveBeenCalled();
  expect(() => dueTasks([{ name: "x", everyMinutes: 0 }], 5)).toThrow();
  expect(dueTasks([{ name: "x", everyMinutes: 5 }], 7)).toEqual([]);
});
