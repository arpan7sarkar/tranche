import type { DomainEventType, MilestoneState } from "@tranche/contracts";

export type MilestoneSnapshot = {
  state: MilestoneState;
  priceMinor: number;
  heldMinor: number;
  releasedMinor: number;
  verifiedAt: string | null;
  releaseAuthorizedAt: string | null;
};

export type MilestoneEvent =
  | { type: "plan_agreed" }
  | { type: "funding_requested" }
  | { type: "funding_failed"; reason: string }
  | { type: "hold_confirmed"; amountMinor: number }
  | { type: "work_started" }
  | { type: "delivered" }
  | { type: "verification_started" }
  | { type: "verification_passed"; at: string }
  | { type: "verification_failed"; missing: string[] }
  | { type: "release_approved"; at: string }
  | { type: "auto_release_due"; at: string }
  | { type: "release_confirmed"; amountMinor: number }
  | { type: "payout_confirmed" }
  | { type: "dispute_opened" }
  | { type: "dispute_resolved"; outcome: "merchant" | "buyer" }
  | { type: "refund_confirmed" }
  | { type: "cancel" };

export type Effect =
  | { type: "emit"; event: DomainEventType }
  | { type: "schedule_funding" }
  | { type: "schedule_auto_release" }
  | { type: "release_funds"; amountMinor: number }
  | { type: "pay_out" }
  | { type: "void_hold" }
  | { type: "cancel_timers" };

export type TransitionResult =
  | { ok: true; next: MilestoneSnapshot; effects: Effect[] }
  | { ok: false; reason: string };

const FUNDED: MilestoneState[] = [
  "held",
  "in_progress",
  "delivered",
  "verifying",
  "changes_requested",
  "release_pending",
];
const emit = (event: DomainEventType): Effect => ({ type: "emit", event });

export function transition(s: MilestoneSnapshot, e: MilestoneEvent): TransitionResult {
  const from = (...states: MilestoneState[]) => states.includes(s.state);
  const reject = (reason = `${e.type} is not allowed in state ${s.state}`): TransitionResult => ({
    ok: false,
    reason,
  });
  const go = (patch: Partial<MilestoneSnapshot>, effects: Effect[]): TransitionResult => ({
    ok: true,
    next: { ...s, ...patch },
    effects,
  });

  switch (e.type) {
    case "plan_agreed":
      return from("draft") ? go({ state: "agreed" }, [{ type: "schedule_funding" }]) : reject();
    case "funding_requested":
      return from("agreed")
        ? go({ state: "funding" }, [emit("milestone.funding_requested")])
        : reject();
    case "funding_failed":
      return from("funding") ? go({ state: "agreed" }, [{ type: "schedule_funding" }]) : reject();
    case "hold_confirmed":
      if (!from("funding")) return reject();
      // An over-hold would let release_funds pay the agency more than the agreed price.
      if (e.amountMinor !== s.priceMinor) {
        return reject(`hold of ${e.amountMinor} does not match the price ${s.priceMinor}`);
      }
      return go({ state: "held", heldMinor: e.amountMinor }, [emit("milestone.held")]);
    case "work_started":
      return from("held") ? go({ state: "in_progress" }, [emit("milestone.started")]) : reject();
    case "delivered":
      return from("held", "in_progress", "changes_requested")
        ? go({ state: "delivered", verifiedAt: null, releaseAuthorizedAt: null }, [
            emit("milestone.delivered"),
          ])
        : reject();
    case "verification_started":
      return from("delivered")
        ? go({ state: "verifying" }, [emit("milestone.verification_requested")])
        : reject();
    case "verification_passed":
      return from("verifying")
        ? go({ state: "release_pending", verifiedAt: e.at }, [
            emit("milestone.verified"),
            emit("milestone.release_pending"),
            { type: "schedule_auto_release" },
          ])
        : reject();
    case "verification_failed":
      return from("verifying")
        ? go({ state: "changes_requested", verifiedAt: null }, [
            emit("milestone.changes_requested"),
          ])
        : reject();
    case "release_approved":
    case "auto_release_due": {
      if (!from("release_pending") || s.verifiedAt === null) return reject();
      if (s.releaseAuthorizedAt !== null) return reject("release already authorized");
      const amountMinor = s.heldMinor - s.releasedMinor;
      if (amountMinor <= 0) return reject("nothing left to release");
      return go({ releaseAuthorizedAt: e.at }, [{ type: "release_funds", amountMinor }]);
    }
    case "release_confirmed":
      if (!from("release_pending") || s.verifiedAt === null || s.releaseAuthorizedAt === null) {
        return reject();
      }
      if (e.amountMinor <= 0 || s.releasedMinor + e.amountMinor > s.heldMinor) {
        return reject(
          `release of ${e.amountMinor} does not fit the ${s.heldMinor - s.releasedMinor} held`,
        );
      }
      return go({ state: "released", releasedMinor: s.releasedMinor + e.amountMinor }, [
        emit("milestone.released"),
        { type: "cancel_timers" },
        { type: "pay_out" },
      ]);
    case "payout_confirmed":
      return from("released") ? go({ state: "paid_out" }, [emit("milestone.paid_out")]) : reject();
    case "dispute_opened":
      return from(...FUNDED, "released", "paid_out")
        ? go({ state: "disputed" }, [emit("milestone.disputed"), { type: "cancel_timers" }])
        : reject();
    case "dispute_resolved":
      if (!from("disputed")) return reject();
      if (e.outcome === "buyer") return go({ state: "refunded" }, [emit("milestone.refunded")]);
      return s.releasedMinor > 0
        ? go({ state: "released" }, [emit("milestone.released")])
        : go({ state: "held", verifiedAt: null, releaseAuthorizedAt: null }, [
            emit("milestone.held"),
          ]);
    case "refund_confirmed":
      return from(...FUNDED, "disputed")
        ? go({ state: "refunded" }, [emit("milestone.refunded"), { type: "cancel_timers" }])
        : reject();
    case "cancel":
      if (from("draft", "agreed", "funding")) {
        return go({ state: "cancelled" }, [emit("milestone.cancelled"), { type: "cancel_timers" }]);
      }
      return from("held", "in_progress", "changes_requested")
        ? go({ state: "cancelled" }, [
            emit("milestone.cancelled"),
            { type: "cancel_timers" },
            { type: "void_hold" },
          ])
        : reject();
  }
}
