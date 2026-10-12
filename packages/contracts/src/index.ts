import { z } from "zod";

export * from "./sandbox-capabilities";

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
