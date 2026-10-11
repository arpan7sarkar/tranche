import type { ActionType, Policy, ProposedActionInput } from "@tranche/contracts";

export type PolicyContext = {
  now: string;
  heldForMilestoneMinor: number;
  releasedForMilestoneMinor: number;
  releasedForDealMinor: number;
  lastExecutedAt: string | null;
};

export type PolicyDecision = { decision: "approve" | "needs_approval" | "reject"; reason: string };

const CHANGES_AGREEMENT: ReadonlySet<ActionType> = new Set([
  "create_plan",
  "accept_plan",
  "reschedule",
  "submit_dispute_evidence",
]);

const ISO_INSTANT = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function instantMs(value: string): number | null {
  const match = ISO_INSTANT.exec(value);
  if (!match) return null;
  const ms = Date.parse(value);
  const day = new Date(`${match[1]}T00:00:00Z`);
  if (Number.isNaN(ms) || Number.isNaN(day.getTime())) return null;
  return day.toISOString().slice(0, 10) === match[1] ? ms : null;
}

const approve = (reason: string): PolicyDecision => ({ decision: "approve", reason });
const ask = (reason: string): PolicyDecision => ({ decision: "needs_approval", reason });
const reject = (reason: string): PolicyDecision => ({ decision: "reject", reason });

export function defaultAgencyPolicy(totalMinor: number): Policy {
  return {
    perActionMaxMinor: totalMinor,
    perMilestoneMaxMinor: totalMinor,
    perDealMaxMinor: totalMinor,
    autoReleaseAfterHours: 72,
    cooldownMinutes: 10,
    alwaysAsk: ["reschedule"],
  };
}

export function evaluatePolicy({
  action,
  policy,
  context,
}: {
  action: ProposedActionInput;
  policy: Policy;
  context: PolicyContext;
}): PolicyDecision {
  const p = action.payload;

  if (p.type === "release") {
    const remaining = context.heldForMilestoneMinor - context.releasedForMilestoneMinor;
    if (p.amount.minor <= 0) return reject("release amount must be positive");
    if (p.amount.minor > remaining) {
      return reject(`release of ${p.amount.minor} exceeds the ${remaining} still held`);
    }
  }

  if (action.agent === "human") return approve("initiated by a person");
  if (policy.alwaysAsk.includes(p.type)) return ask(`${p.type} always needs approval`);
  if (CHANGES_AGREEMENT.has(p.type)) return ask(`${p.type} changes the agreement`);

  if (p.type === "release") {
    const amount = p.amount.minor;
    if (amount > policy.perActionMaxMinor) {
      return ask(`release of ${amount} is above the per-action limit ${policy.perActionMaxMinor}`);
    }
    if (context.releasedForMilestoneMinor + amount > policy.perMilestoneMaxMinor) {
      return ask(`release would pass the per-milestone limit ${policy.perMilestoneMaxMinor}`);
    }
    if (context.releasedForDealMinor + amount > policy.perDealMaxMinor) {
      return ask(`release would pass the per-deal limit ${policy.perDealMaxMinor}`);
    }
  }

  if (context.lastExecutedAt !== null && policy.cooldownMinutes > 0) {
    const now = instantMs(context.now);
    const last = instantMs(context.lastExecutedAt);
    if (now === null || last === null) {
      return ask(
        "cooldown cannot be evaluated: timestamps must be ISO 8601 instants with an offset",
      );
    }
    const elapsed = (now - last) / 60_000;
    if (elapsed < policy.cooldownMinutes) {
      return ask(`cooldown: ${Math.ceil(policy.cooldownMinutes - elapsed)} minutes left`);
    }
  }

  return approve("within policy");
}
