import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { detectFindings, plannedActions } from "./monitor";

describe("monitor boundaries", () => {
  const now = new Date("2026-11-10T00:00:00Z");
  it("uses the exact 24-hour hold window", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000, max: 100_000_000 }), (offset) => {
        const findings = detectFindings(
          {
            milestones: [],
            tasks: [],
            clientApprovals: [],
            holds: [
              {
                dealId: "deal",
                milestoneId: "milestone",
                status: "active",
                expiresAt: new Date(now.getTime() + offset),
              },
            ],
          },
          now,
        );
        expect(findings.length).toBe(offset >= 0 && offset <= 86_400_000 ? 1 : 0);
      }),
    );
  });
  it("keeps same-day proposal identities stable as a release ages", () => {
    fc.assert(
      fc.property(fc.integer({ min: 48, max: 10000 }), (hoursWaiting) => {
        const finding = {
          kind: "release_overdue" as const,
          dealId: "deal",
          milestoneId: "milestone",
          severity: "high" as const,
          hoursWaiting,
        };
        const actions = plannedActions(finding, now);
        expect(actions.map((a) => a.key)).toEqual(
          plannedActions({ ...finding, hoursWaiting: hoursWaiting + 1 }, now).map((a) => a.key),
        );
        expect(
          actions.every(
            (a) => a.payload.type === "flag_risk" || a.payload.type === "send_reminder",
          ),
        ).toBe(true);
      }),
    );
  });
});
