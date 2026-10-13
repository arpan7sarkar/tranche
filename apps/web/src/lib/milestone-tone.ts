import type { MilestoneState } from "@tranche/contracts";

export type Tone =
  | "neutral"
  | "progress"
  | "held"
  | "verifying"
  | "attention"
  | "released"
  | "danger";

const TONES: Record<MilestoneState, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  agreed: { label: "Agreed", tone: "neutral" },
  funding: { label: "Awaiting funds", tone: "attention" },
  held: { label: "Funds held", tone: "held" },
  in_progress: { label: "In progress", tone: "progress" },
  delivered: { label: "Delivered", tone: "verifying" },
  verifying: { label: "Verifying", tone: "verifying" },
  changes_requested: { label: "Changes requested", tone: "attention" },
  release_pending: { label: "Ready to release", tone: "held" },
  released: { label: "Released", tone: "released" },
  paid_out: { label: "Paid out", tone: "released" },
  disputed: { label: "Disputed", tone: "danger" },
  refunded: { label: "Refunded", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export function milestoneTone(state: MilestoneState): { label: string; tone: Tone } {
  return TONES[state];
}
