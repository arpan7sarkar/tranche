import {
  type Adjustment,
  type NegotiationDecision as Decision,
  type Mandate,
  type Offer,
  PlanDraft,
} from "@tranche/contracts";
import { schedulePlan, withinMandate } from "./schedule";
export type NegotiationSide = "agency" | "client";
export function planTotal(plan: PlanDraft): number {
  return plan.milestones.reduce((sum, m) => sum + m.price.minor, 0);
}

export function planEnd(plan: PlanDraft, startDate: string): string {
  let end = startDate;
  for (const d of schedulePlan(plan.tasks, startDate).values()) if (d.end > end) end = d.end;
  return end;
}

export function applyAdjustment(base: PlanDraft, adj: Adjustment): PlanDraft {
  const prices = new Map(adj.milestonePrices.map((p) => [p.key, p.priceMinor]));
  const durations = new Map(adj.taskDurations.map((t) => [t.key, t.durationDays]));
  if (prices.size !== adj.milestonePrices.length || durations.size !== adj.taskDurations.length)
    throw new Error("duplicate adjustment key");
  for (const key of prices.keys()) {
    if (!base.milestones.some((m) => m.key === key)) throw new Error(`unknown milestone "${key}"`);
  }
  for (const key of durations.keys()) {
    if (!base.tasks.some((t) => t.key === key)) throw new Error(`unknown task "${key}"`);
  }
  return {
    ...base,
    milestones: base.milestones.map((m) => ({
      ...m,
      price: { ...m.price, minor: prices.get(m.key) ?? m.price.minor },
    })),
    tasks: base.tasks.map((t) => ({ ...t, durationDays: durations.get(t.key) ?? t.durationDays })),
  };
}

export type TurnLike = {
  round: number;
  side: NegotiationSide;
  kind: "offer" | "accept" | "reject" | "escalate";
};

export function nextSlot(
  turns: TurnLike[],
  maxRounds: number,
): { round: number; side: NegotiationSide } | { limitReached: true } | { finished: true } {
  const last = turns.at(-1);
  if (!last) return { round: 1, side: "agency" };
  if (last.kind === "accept" || last.kind === "escalate") return { finished: true };
  const next =
    last.side === "agency"
      ? { round: last.round, side: "client" as const }
      : { round: last.round + 1, side: "agency" as const };
  return next.round > maxRounds ? { limitReached: true } : next;
}

export type ValidatedTurn = {
  kind: "offer" | "accept" | "escalate";
  offer: Offer | null;
  message: string;
};

export type ValidateInput = {
  decision: Decision;
  side: NegotiationSide;
  mandate: Mandate;
  base: PlanDraft;
  incoming: PlanDraft | null;
  previousOwn: PlanDraft | null;
  startDate: string;
};

export function validateDecision(
  input: ValidateInput,
): { ok: true; turn: ValidatedTurn } | { ok: false; reason: string } {
  const { decision, side, mandate, base, incoming, previousOwn, startDate } = input;
  if (mandate.side !== side) throw new Error("mandate belongs to the other side");

  if (decision.kind === "escalate") {
    return { ok: true, turn: { kind: "escalate", offer: null, message: decision.message } };
  }

  if (decision.kind === "accept") {
    if (!incoming) return { ok: false, reason: "there is no offer to accept yet" };
    const accepted = PlanDraft.safeParse(incoming);
    if (!accepted.success || !Number.isSafeInteger(planTotal(incoming)))
      return { ok: false, reason: "invalid incoming plan" };
    try {
      const adjusted = applyAdjustment(base, {
        milestonePrices: incoming.milestones.map((m) => ({
          key: m.key,
          priceMinor: m.price.minor,
        })),
        taskDurations: incoming.tasks.map((t) => ({ key: t.key, durationDays: t.durationDays })),
      });
      if (JSON.stringify(PlanDraft.parse(adjusted)) !== JSON.stringify(accepted.data))
        return { ok: false, reason: "incoming offer changes scope" };
    } catch {
      return { ok: false, reason: "incoming offer changes scope" };
    }
    const check = withinMandate(incoming, mandate, startDate);
    if (!check.ok) return { ok: false, reason: `cannot accept: ${check.reason}` };
    return {
      ok: true,
      turn: {
        kind: "accept",
        offer: { plan: incoming, note: decision.message },
        message: decision.message,
      },
    };
  }

  let candidate: PlanDraft;
  try {
    candidate = applyAdjustment(base, decision.adjustment);
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
  const parsed = PlanDraft.safeParse(candidate);
  if (!parsed.success)
    return { ok: false, reason: parsed.error.issues.map((i) => i.message).join("; ") };
  const plan = parsed.data;
  if (!Number.isSafeInteger(planTotal(plan))) return { ok: false, reason: "price overflow" };

  const check = withinMandate(plan, mandate, startDate);
  if (!check.ok) return { ok: false, reason: `offer breaks your mandate: ${check.reason}` };

  if (previousOwn) {
    const before = planTotal(previousOwn);
    const after = planTotal(plan);
    if (side === "agency" && after > before) {
      return { ok: false, reason: `agency may not raise its price (was ${before}, now ${after})` };
    }
    if (side === "client" && after < before) {
      return { ok: false, reason: `client may not lower its offer (was ${before}, now ${after})` };
    }
    if (JSON.stringify(previousOwn) === JSON.stringify(plan)) {
      return { ok: false, reason: "offer must change something from your previous offer" };
    }
  }

  return {
    ok: true,
    turn: { kind: "offer", offer: { plan, note: decision.message }, message: decision.message },
  };
}
