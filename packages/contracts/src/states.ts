import { z } from "zod";

export const MilestoneState = z.enum([
  "draft",
  "agreed",
  "funding",
  "held",
  "in_progress",
  "delivered",
  "verifying",
  "changes_requested",
  "release_pending",
  "released",
  "paid_out",
  "disputed",
  "refunded",
  "cancelled",
]);
export type MilestoneState = z.infer<typeof MilestoneState>;

export const DealStatus = z.enum([
  "draft",
  "sent",
  "negotiating",
  "agreed",
  "active",
  "completed",
  "cancelled",
]);
export type DealStatus = z.infer<typeof DealStatus>;

export const HoldMechanism = z.enum(["delayed_disbursement", "authorization"]);
export type HoldMechanism = z.infer<typeof HoldMechanism>;

export const HoldStatus = z.enum(["pending", "active", "released", "voided", "expired", "failed"]);
export type HoldStatus = z.infer<typeof HoldStatus>;

export const ScheduledActionKind = z.enum(["fund", "renew_hold", "auto_release", "remind"]);
export type ScheduledActionKind = z.infer<typeof ScheduledActionKind>;
