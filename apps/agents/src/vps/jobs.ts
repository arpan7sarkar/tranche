import type { Job } from "./scheduler";

const CONSUMERS = ["planner", "verifier", "negotiator"] as const;
const MONEY_JOBS = ["moneyTick", "reconcile"] as const;

export const VPS_JOBS: readonly Job[] = [
  { name: "moneyTick", everyMs: 60_000, timeoutMs: 300_000 },
  { name: "reconcile", everyMs: 3_600_000, timeoutMs: 1_800_000 },
  ...CONSUMERS.map((name) => ({ name: `consume:${name}`, everyMs: 60_000, timeoutMs: 1_800_000 })),
  { name: "notifications", everyMs: 60_000, timeoutMs: 1_800_000 },
  { name: "monitor", everyMs: 300_000, timeoutMs: 1_800_000 },
];

export function moneyEnabled(env: Record<string, string | undefined>): boolean {
  return env.VPS_MONEY_ENABLED === "1";
}

export function isMoneyJob(name: string): boolean {
  return MONEY_JOBS.some((job) => job === name);
}

export function selectVpsJobs(env: Record<string, string | undefined>): readonly Job[] {
  return VPS_JOBS.filter((job) => moneyEnabled(env) || !isMoneyJob(job.name));
}

export function consumerForJob(name: string): string | undefined {
  return CONSUMERS.find((consumer) => name === `consume:${consumer}`);
}

export function assertConsumerRegistry(registry: readonly { name: string }[]): void {
  const names = registry.map((consumer) => consumer.name);
  if (
    names.length !== CONSUMERS.length ||
    new Set(names).size !== CONSUMERS.length ||
    CONSUMERS.some((name) => !names.includes(name))
  ) {
    throw new Error("consumer_registry_diverged");
  }
}
