import type { DomainEventType } from "@tranche/contracts";

const SENTENCES: Record<DomainEventType, (title: string) => string> = {
  "deal.created": () => "Deal created",
  "deal.plan_sent": () => "Plan shared for client review",
  "deal.portal_opened": () => "Client portal opened",
  "deal.agreed": () => "Client agreed to the plan",
  "milestone.funding_requested": (t) => `Funding requested for ${t}`,
  "milestone.held": (t) => `Funds held for ${t}`,
  "milestone.hold_expiring": (t) => `Hold for ${t} expires soon`,
  "milestone.started": (t) => `Work started on ${t}`,
  "milestone.delivered": (t) => `${t} delivered`,
  "milestone.verification_requested": (t) => `Verifying ${t}`,
  "milestone.changes_requested": (t) => `Changes requested on ${t}`,
  "milestone.verified": (t) => `${t} passed verification`,
  "milestone.release_pending": (t) => `${t} is ready to release`,
  "milestone.released": (t) => `Payment released for ${t}`,
  "milestone.paid_out": (t) => `Payouts sent for ${t}`,
  "milestone.disputed": (t) => `Dispute opened on ${t}`,
  "milestone.refunded": (t) => `${t} refunded`,
  "milestone.cancelled": (t) => `${t} cancelled`,
  "task.rescheduled": () => "Schedule updated",
  "approval.requested": () => "Approval requested",
  "approval.decided": () => "Approval decided",
  "action.executed": () => "Agent action completed",
  "action.failed": () => "Agent action failed",
  "negotiation.started": () => "Negotiation started",
  "negotiation.agreed": () => "Agents reached agreement",
  "negotiation.escalated": () => "Negotiation needs a human",
  "alert.raised": () => "Needs your attention",
};

export function describeEvent(type: DomainEventType, payload: Record<string, unknown>): string {
  const title = typeof payload.title === "string" ? payload.title : "a milestone";
  return SENTENCES[type](title);
}
