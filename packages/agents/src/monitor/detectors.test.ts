import { describe, expect, it } from "vitest";
import { detectFindings, type MonitorSnapshot, plannedActions } from "./detectors";

const now = new Date("2026-11-20T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);
const hoursAhead = (h: number) => new Date(now.getTime() + h * 3600_000);
const ids = {
  deal: "d0000000-0000-4000-8000-000000000001",
  m1: "m0000000-0000-4000-8000-000000000001",
  m2: "m0000000-0000-4000-8000-000000000002",
};

const empty: MonitorSnapshot = { milestones: [], tasks: [], holds: [], clientApprovals: [] };
const milestone = (over: Partial<MonitorSnapshot["milestones"][number]>) => ({
  id: ids.m1,
  dealId: ids.deal,
  dealTitle: "Acme storefront rebuild",
  title: "Storefront build",
  state: "release_pending" as const,
  priceMinor: 480000,
  currency: "USD",
  pendingSince: hoursAgo(50),
  ...over,
});

describe("detectFindings", () => {
  it("flags releases pending for more than 48 hours, high after 96", () => {
    expect(
      detectFindings({ ...empty, milestones: [milestone({ pendingSince: hoursAgo(47) })] }, now),
    ).toEqual([]);
    expect(detectFindings({ ...empty, milestones: [milestone({})] }, now)).toEqual([
      {
        kind: "release_overdue",
        dealId: ids.deal,
        milestoneId: ids.m1,
        hoursWaiting: 50,
        severity: "medium",
      },
    ]);
    expect(
      detectFindings(
        { ...empty, milestones: [milestone({ pendingSince: hoursAgo(100) })] },
        now,
      )[0],
    ).toMatchObject({
      severity: "high",
    });
  });

  it("flags tasks past their end while the milestone is still in progress", () => {
    const s: MonitorSnapshot = {
      ...empty,
      milestones: [milestone({ state: "in_progress", pendingSince: null })],
      tasks: [
        {
          id: "t1",
          dealId: ids.deal,
          milestoneId: ids.m1,
          title: "Checkout",
          startDate: "2026-11-10",
          durationDays: 6,
        },
        {
          id: "t2",
          dealId: ids.deal,
          milestoneId: ids.m1,
          title: "Perf",
          startDate: "2026-11-16",
          durationDays: 6,
        },
      ],
    };
    expect(detectFindings(s, now)).toEqual([
      {
        kind: "task_late",
        dealId: ids.deal,
        milestoneId: ids.m1,
        taskId: "t1",
        taskTitle: "Checkout",
        daysLate: 4,
      },
    ]);
  });

  it("ignores late tasks of delivered or released milestones", () => {
    const s: MonitorSnapshot = {
      ...empty,
      milestones: [milestone({ state: "delivered", pendingSince: null })],
      tasks: [
        {
          id: "t1",
          dealId: ids.deal,
          milestoneId: ids.m1,
          title: "Checkout",
          startDate: "2026-11-01",
          durationDays: 2,
        },
      ],
    };
    expect(detectFindings(s, now)).toEqual([]);
  });

  it("flags active holds expiring within 24 hours", () => {
    const s: MonitorSnapshot = {
      ...empty,
      holds: [
        { milestoneId: ids.m1, dealId: ids.deal, status: "active", expiresAt: hoursAhead(10) },
        { milestoneId: ids.m2, dealId: ids.deal, status: "active", expiresAt: hoursAhead(30) },
      ],
    };
    expect(detectFindings(s, now)).toEqual([
      { kind: "hold_expiring", dealId: ids.deal, milestoneId: ids.m1, hoursLeft: 10 },
    ]);
  });

  it("flags client approvals unanswered for 72 hours", () => {
    const s: MonitorSnapshot = {
      ...empty,
      clientApprovals: [
        { approvalId: "a1", dealId: ids.deal, createdAt: hoursAgo(80) },
        { approvalId: "a2", dealId: ids.deal, createdAt: hoursAgo(10) },
      ],
    };
    expect(detectFindings(s, now)).toEqual([
      { kind: "client_unresponsive", dealId: ids.deal, approvalId: "a1", hoursWaiting: 80 },
    ]);
  });
});

describe("plannedActions", () => {
  it("buckets keys by UTC day", () => {
    const f = {
      kind: "release_overdue" as const,
      dealId: ids.deal,
      milestoneId: ids.m1,
      hoursWaiting: 50,
      severity: "medium" as const,
    };
    const today = plannedActions(f, now).map((a) => a.key);
    const tomorrow = plannedActions(f, new Date("2026-11-21T00:30:00Z")).map((a) => a.key);
    expect(today).toEqual([
      `monitor:release_overdue:${ids.m1}:remind:2026-11-20`,
      `monitor:release_overdue:${ids.m1}:risk:2026-11-20`,
    ]);
    expect(tomorrow[0]).toBe(`monitor:release_overdue:${ids.m1}:remind:2026-11-21`);
  });

  it("suggests restarting a late task today", () => {
    const f = {
      kind: "task_late" as const,
      dealId: ids.deal,
      milestoneId: ids.m1,
      taskId: "t1",
      taskTitle: "Checkout",
      daysLate: 4,
    };
    const [reschedule, remind] = plannedActions(f, now);
    expect(reschedule?.payload).toMatchObject({
      type: "reschedule",
      shifts: [{ taskId: "t1", start: "2026-11-20" }],
    });
    expect(remind?.payload).toMatchObject({ type: "send_reminder", to: "agency" });
    expect(remind?.draft).toMatchObject({ to: "agency" });
  });
});
