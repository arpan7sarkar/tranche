import type { ActionPayload, Finding, MilestoneState, MonitorSnapshot } from "@tranche/contracts";

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const WORKING: MilestoneState[] = ["held", "in_progress", "changes_requested"];

const day = (d: Date) => d.toISOString().slice(0, 10);
const hoursBetween = (a: Date, b: Date) => Math.floor((b.getTime() - a.getTime()) / HOUR);
const addDays = (iso: string, n: number) => day(new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY));

export function detectFindings(s: MonitorSnapshot, now: Date): Finding[] {
  const findings: Finding[] = [];
  const today = day(now);
  const working = new Set(s.milestones.filter((m) => WORKING.includes(m.state)).map((m) => m.id));

  for (const m of s.milestones) {
    if (m.state !== "release_pending" || !m.pendingSince) continue;
    const hoursWaiting = hoursBetween(m.pendingSince, now);
    if (hoursWaiting < 48) continue;
    findings.push({
      kind: "release_overdue",
      dealId: m.dealId,
      milestoneId: m.id,
      hoursWaiting,
      severity: hoursWaiting >= 96 ? "high" : "medium",
    });
  }

  for (const t of s.tasks) {
    if (!working.has(t.milestoneId)) continue;
    const end = addDays(t.startDate, t.durationDays);
    if (end >= today) continue;
    const daysLate = Math.round((Date.parse(today) - Date.parse(end)) / DAY);
    findings.push({
      kind: "task_late",
      dealId: t.dealId,
      milestoneId: t.milestoneId,
      taskId: t.id,
      taskTitle: t.title,
      daysLate,
    });
  }

  for (const h of s.holds) {
    if (h.status !== "active") continue;
    const hoursLeft = hoursBetween(now, h.expiresAt);
    if (h.expiresAt.getTime() < now.getTime() || h.expiresAt.getTime() - now.getTime() > DAY)
      continue;
    findings.push({
      kind: "hold_expiring",
      dealId: h.dealId,
      milestoneId: h.milestoneId,
      hoursLeft,
    });
  }

  for (const a of s.clientApprovals) {
    const hoursWaiting = hoursBetween(a.createdAt, now);
    if (hoursWaiting >= 72)
      findings.push({
        kind: "client_unresponsive",
        dealId: a.dealId,
        approvalId: a.approvalId,
        hoursWaiting,
      });
  }

  return findings;
}

export type PlannedAction = {
  key: string;
  dealId: string;
  payload: ActionPayload;
  draft: { to: "agency" | "client"; finding: Finding } | null;
  reasoning: string;
};

function reminder(
  f: Finding,
  key: string,
  to: "agency" | "client",
  milestoneId: string | null,
  subject: string,
  body: string,
  reasoning: string,
): PlannedAction {
  return {
    key,
    dealId: f.dealId,
    payload: { type: "send_reminder", milestoneId, to, subject, body },
    draft: { to, finding: f },
    reasoning,
  };
}

export function plannedActions(f: Finding, now: Date): PlannedAction[] {
  const d = day(now);
  switch (f.kind) {
    case "release_overdue": {
      const why = `Release has been waiting ${f.hoursWaiting} hours after a passing verification.`;
      return [
        reminder(
          f,
          `monitor:release_overdue:${f.milestoneId}:remind:${d}`,
          "client",
          f.milestoneId,
          "A delivered milestone is waiting for your release",
          "The work for this milestone passed every agreed check and is waiting for your release. Open your Tranche link to review the evidence and release the payment.",
          why,
        ),
        {
          key: `monitor:release_overdue:${f.milestoneId}:risk:${d}`,
          dealId: f.dealId,
          payload: {
            type: "flag_risk",
            milestoneId: f.milestoneId,
            severity: f.severity,
            message: why,
          },
          draft: null,
          reasoning: why,
        },
      ];
    }
    case "task_late": {
      const why = `Task "${f.taskTitle.slice(0, 100)}" ended ${f.daysLate} days ago without a delivery.`;
      return [
        {
          key: `monitor:task_late:${f.taskId}:reschedule:${d}`,
          dealId: f.dealId,
          payload: {
            type: "reschedule",
            shifts: [{ taskId: f.taskId, start: d }],
            reason: `${why} Suggest restarting it today so dependent dates and payment timers are recomputed.`,
          },
          draft: null,
          reasoning: why,
        },
        reminder(
          f,
          `monitor:task_late:${f.taskId}:remind:${d}`,
          "agency",
          f.milestoneId,
          `"${f.taskTitle.slice(0, 100)}" is ${f.daysLate} days late`,
          "This task is past its planned end. Deliver it or accept the suggested re-plan so the client's payment dates move with it.",
          why,
        ),
      ];
    }
    case "hold_expiring": {
      const why = `The PayPal hold for this milestone expires in ${f.hoursLeft} hours and has not been renewed.`;
      return [
        {
          key: `monitor:hold_expiring:${f.milestoneId}:risk:${d}`,
          dealId: f.dealId,
          payload: {
            type: "flag_risk",
            milestoneId: f.milestoneId,
            severity: "high",
            message: why,
          },
          draft: null,
          reasoning: why,
        },
        reminder(
          f,
          `monitor:hold_expiring:${f.milestoneId}:remind:${d}`,
          "agency",
          f.milestoneId,
          "A payment hold is about to expire",
          "The automatic renewal for this milestone's PayPal hold has not completed. Check the deal before the hold lapses.",
          why,
        ),
      ];
    }
    case "client_unresponsive": {
      const why = `A client approval has been waiting ${f.hoursWaiting} hours.`;
      return [
        reminder(
          f,
          `monitor:client_unresponsive:${f.approvalId}:remind:${d}`,
          "client",
          null,
          "Your approval is needed",
          "A decision on your project is waiting for you. Open your Tranche link to review and approve or decline.",
          why,
        ),
      ];
    }
  }
}
