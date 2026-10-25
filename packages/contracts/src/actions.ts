import { z } from "zod";
import { Id, IsoDate } from "./ids";
import { Money } from "./money";
import { PlanDraft } from "./plan";

export const ACTION_TYPES = [
  "create_plan",
  "mark_verified",
  "request_changes",
  "release",
  "send_reminder",
  "reschedule",
  "flag_risk",
  "accept_plan",
  "escalate",
  "submit_dispute_evidence",
] as const;
export const ActionType = z.enum(ACTION_TYPES);
export type ActionType = z.infer<typeof ActionType>;

export const AgentName = z.enum([
  "planner",
  "verifier",
  "monitor",
  "negotiator",
  "dispute",
  "human",
  "system",
]);
export const Side = z.enum(["agency", "client", "system"]);
export const ActionStatus = z.enum([
  "pending",
  "needs_approval",
  "approved",
  "rejected",
  "executing",
  "executed",
  "failed",
]);
export type ActionStatus = z.infer<typeof ActionStatus>;

const text = z.string().min(1).max(4000);

export const ActionPayload = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create_plan"), plan: PlanDraft }),
  z.object({
    type: z.literal("mark_verified"),
    milestoneId: Id,
    evidenceIds: z.array(Id).min(1),
    deliveryId: Id.optional(),
  }),
  z.object({
    type: z.literal("request_changes"),
    deliveryId: Id.optional(),
    milestoneId: Id,
    evidenceIds: z.array(Id).min(1),
    missing: z.array(z.string().min(1).max(500)).min(1),
  }),
  z.object({ type: z.literal("release"), milestoneId: Id, amount: Money }),
  z.object({
    type: z.literal("send_reminder"),
    milestoneId: Id.nullable(),
    to: z.enum(["agency", "client"]),
    subject: z.string().min(1).max(200),
    body: text,
  }),
  z.object({
    type: z.literal("reschedule"),
    shifts: z.array(z.object({ taskId: Id, start: IsoDate })).min(1),
    reason: text,
  }),
  z.object({
    type: z.literal("flag_risk"),
    milestoneId: Id.nullable(),
    severity: z.enum(["low", "medium", "high"]),
    message: text,
  }),
  z.object({ type: z.literal("accept_plan"), negotiationId: Id, plan: PlanDraft }),
  z.object({ type: z.literal("escalate"), negotiationId: Id.nullable(), reason: text }),
  z.object({
    type: z.literal("submit_dispute_evidence"),
    disputeId: z.string().min(1),
    notes: text,
    evidenceIds: z.array(Id).min(1),
  }),
]);
export type ActionPayload = z.infer<typeof ActionPayload>;

export const ProposedActionInput = z.object({
  dealId: Id,
  agent: AgentName,
  side: Side,
  reasoning: text,
  evidenceIds: z.array(Id),
  idempotencyKey: z.string().min(8).max(200),
  payload: ActionPayload,
});
export type ProposedActionInput = z.infer<typeof ProposedActionInput>;

export type Executor = "money" | "state" | "notify" | "display";

export const ACTION_EXECUTOR: Record<ActionType, Executor> = {
  create_plan: "state",
  mark_verified: "state",
  request_changes: "state",
  release: "money",
  send_reminder: "notify",
  reschedule: "state",
  flag_risk: "display",
  accept_plan: "state",
  escalate: "notify",
  submit_dispute_evidence: "money",
};
