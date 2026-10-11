import type { Mandate, PlanDraft } from "@tranche/contracts";
import { describe, expect, it } from "vitest";
import { withinMandate } from "./schedule";

const plan: PlanDraft = {
  summary: "Site",
  currency: "USD",
  milestones: [
    {
      key: "m1",
      title: "Build",
      price: { currency: "USD", minor: 500000 },
      criteria: { checks: [{ kind: "url_live", url: "https://example.com" }], prose: [] },
      payees: [{ kind: "agency", shareBps: 10000 }],
    },
  ],
  tasks: [
    { key: "a", title: "A", durationDays: 5, dependsOn: [], milestoneKey: "m1" },
    { key: "b", title: "B", durationDays: 5, dependsOn: ["a"], milestoneKey: "m1" },
  ],
};

const client = (limitMinor: number, latestEndDate: string | null = null): Mandate => ({
  side: "client",
  limitMinor,
  latestEndDate,
  maxRounds: 4,
});

describe("withinMandate", () => {
  it("accepts a plan within the client budget", () => {
    expect(withinMandate(plan, client(500000), "2026-10-10")).toEqual({ ok: true });
  });

  it("rejects a plan over the client budget", () => {
    const r = withinMandate(plan, client(499999), "2026-10-10");
    expect(r).toEqual({ ok: false, reason: "total 500000 exceeds the client limit 499999" });
  });

  it("rejects a plan below the agency minimum", () => {
    const r = withinMandate(
      plan,
      { side: "agency", limitMinor: 600000, latestEndDate: null, maxRounds: 4 },
      "2026-10-10",
    );
    expect(r).toEqual({ ok: false, reason: "total 500000 is below the agency minimum 600000" });
  });

  it("accepts a plan ending on the latest end date", () => {
    expect(withinMandate(plan, client(500000, "2026-10-20"), "2026-10-10")).toEqual({ ok: true });
  });

  it("rejects a plan ending after the latest end date", () => {
    const r = withinMandate(plan, client(500000, "2026-10-19"), "2026-10-10");
    expect(r).toEqual({
      ok: false,
      reason: "plan ends 2026-10-20, after the latest end date 2026-10-19",
    });
  });
});
