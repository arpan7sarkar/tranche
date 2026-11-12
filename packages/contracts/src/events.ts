import { z } from "zod";
import { Id, RepoRef } from "./ids";

export const DomainEventType = z.enum([
  "deal.created",
  "deal.plan_sent",
  "deal.portal_opened",
  "deal.agreed",
  "milestone.funding_requested",
  "milestone.held",
  "milestone.hold_expiring",
  "milestone.started",
  "milestone.delivered",
  "milestone.verification_requested",
  "milestone.changes_requested",
  "milestone.verified",
  "milestone.release_pending",
  "milestone.released",
  "milestone.paid_out",
  "milestone.disputed",
  "milestone.refunded",
  "milestone.cancelled",
  "task.rescheduled",
  "approval.requested",
  "approval.decided",
  "action.executed",
  "action.failed",
  "negotiation.started",
  "negotiation.agreed",
  "negotiation.escalated",
  "alert.raised",
]);
export type DomainEventType = z.infer<typeof DomainEventType>;

export const DealPlanSentPayload = z.object({ clientId: Id });
export type DealPlanSentPayload = z.infer<typeof DealPlanSentPayload>;

export const ApprovalRequestedPayload = z.object({
  approvalId: Id,
  proposedActionId: Id,
  side: z.enum(["agency", "client"]),
});
export type ApprovalRequestedPayload = z.infer<typeof ApprovalRequestedPayload>;

export const FundingRequestedPayload = z.object({
  orderId: z.string().min(1),
  approveUrl: z.url().nullable(),
});
export type FundingRequestedPayload = z.infer<typeof FundingRequestedPayload>;

export const AlertRaisedPayload = z.looseObject({ kind: z.string().min(1) });
export type AlertRaisedPayload = z.infer<typeof AlertRaisedPayload>;

export const InboxMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("paypal.webhook"),
    eventType: z.string().min(1),
    resource: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("delivery.detected"),
    milestoneId: Id,
    source: z.enum(["github", "manual"]),
    repo: RepoRef.nullable(),
    sha: z.string().nullable(),
    prNumber: z.number().int().positive().nullable(),
    urls: z.array(z.url()).max(10),
    notes: z.string().max(2000).optional(),
  }),
  z.object({ type: z.literal("timer.due"), scheduledActionId: Id }),
]);
export type InboxMessage = z.infer<typeof InboxMessage>;
