import type { HoldStatus, MilestoneState } from "./states";

export type SnapMilestone = {
  id: string;
  dealId: string;
  dealTitle: string;
  title: string;
  state: MilestoneState;
  priceMinor: number;
  currency: string;
  pendingSince: Date | null;
};
export type SnapTask = {
  id: string;
  dealId: string;
  milestoneId: string;
  title: string;
  startDate: string;
  durationDays: number;
};
export type SnapHold = { milestoneId: string; dealId: string; status: HoldStatus; expiresAt: Date };
export type SnapApproval = { approvalId: string; dealId: string; createdAt: Date };
export type MonitorSnapshot = {
  milestones: SnapMilestone[];
  tasks: SnapTask[];
  holds: SnapHold[];
  clientApprovals: SnapApproval[];
};

export type Finding =
  | {
      kind: "release_overdue";
      dealId: string;
      milestoneId: string;
      hoursWaiting: number;
      severity: "medium" | "high";
    }
  | {
      kind: "task_late";
      dealId: string;
      milestoneId: string;
      taskId: string;
      taskTitle: string;
      daysLate: number;
    }
  | { kind: "hold_expiring"; dealId: string; milestoneId: string; hoursLeft: number }
  | { kind: "client_unresponsive"; dealId: string; approvalId: string; hoursWaiting: number };

import { z } from "zod";
export const ReminderDraft = z.object({
  subject: z.string().min(1).max(120),
  body: z.string().min(1).max(1200),
});
