import { Policy, type ProposedActionInput } from "@tranche/contracts";
import { describe, expect, it } from "vitest";
import { defaultAgencyPolicy, evaluatePolicy, type PolicyContext } from "./policy";

const DEAL = "6f1d7c4e-1b9a-4d55-9c3e-2a7b8e9f0a11";
const MS = "0b7f3a2c-5d4e-4f61-8a9b-1c2d3e4f5a6b";
const EV = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

const policy: Policy = {
  perActionMaxMinor: 100000,
  perMilestoneMaxMinor: 300000,
  perDealMaxMinor: 500000,
  autoReleaseAfterHours: 48,
  cooldownMinutes: 10,
  alwaysAsk: [],
};

const context: PolicyContext = {
  now: "2026-10-10T10:00:00Z",
  heldForMilestoneMinor: 400000,
  releasedForMilestoneMinor: 0,
  releasedForDealMinor: 0,
  lastExecutedAt: null,
};

const release = (
  minor: number,
  agent: ProposedActionInput["agent"] = "negotiator",
): ProposedActionInput => ({
  dealId: DEAL,
  agent,
  side: "client",
  reasoning: "Verified delivery",
  evidenceIds: [EV],
  idempotencyKey: `release:${MS}:${minor}`,
  payload: { type: "release", milestoneId: MS, amount: { currency: "USD", minor } },
});

describe("evaluatePolicy", () => {
  it("approves a release within every limit", () => {
    expect(evaluatePolicy({ action: release(100000), policy, context }).decision).toBe("approve");
  });

  it("asks above the per-action limit", () => {
    const d = evaluatePolicy({ action: release(100001), policy, context });
    expect(d).toEqual({
      decision: "needs_approval",
      reason: "release of 100001 is above the per-action limit 100000",
    });
  });

  it("asks above the per-milestone and per-deal limits", () => {
    expect(
      evaluatePolicy({
        action: release(50000),
        policy,
        context: { ...context, releasedForMilestoneMinor: 260000 },
      }).decision,
    ).toBe("needs_approval");
    expect(
      evaluatePolicy({
        action: release(50000),
        policy,
        context: { ...context, releasedForDealMinor: 460000 },
      }).decision,
    ).toBe("needs_approval");
  });

  it("rejects a release above what is still held, from anyone", () => {
    const ctx = { ...context, heldForMilestoneMinor: 100000, releasedForMilestoneMinor: 60000 };
    expect(evaluatePolicy({ action: release(50000), policy, context: ctx }).decision).toBe(
      "reject",
    );
  });

  it("rejects a human release above the held amount", () => {
    const ctx = { ...context, heldForMilestoneMinor: 10000 };
    expect(evaluatePolicy({ action: release(20000, "human"), policy, context: ctx }).decision).toBe(
      "reject",
    );
  });

  it("approves a human release above the agent limits", () => {
    expect(evaluatePolicy({ action: release(300000, "human"), policy, context }).decision).toBe(
      "approve",
    );
  });

  it("always asks for actions that change the agreement", () => {
    const reschedule: ProposedActionInput = {
      dealId: DEAL,
      agent: "monitor",
      side: "agency",
      reasoning: "Build slipped",
      evidenceIds: [],
      idempotencyKey: "monitor:reschedule:1",
      payload: {
        type: "reschedule",
        shifts: [{ taskId: MS, start: "2026-10-20" }],
        reason: "slip",
      },
    };
    expect(evaluatePolicy({ action: reschedule, policy, context }).decision).toBe("needs_approval");
  });

  it("asks for types the owner listed in alwaysAsk", () => {
    const flag: ProposedActionInput = {
      dealId: DEAL,
      agent: "monitor",
      side: "system",
      reasoning: "Late",
      evidenceIds: [],
      idempotencyKey: "monitor:flag:1",
      payload: { type: "flag_risk", milestoneId: null, severity: "low", message: "Client slow" },
    };
    expect(evaluatePolicy({ action: flag, policy, context }).decision).toBe("approve");
    expect(
      evaluatePolicy({ action: flag, policy: { ...policy, alwaysAsk: ["flag_risk"] }, context })
        .decision,
    ).toBe("needs_approval");
  });

  it("asks during the cooldown", () => {
    const ctx = { ...context, lastExecutedAt: "2026-10-10T09:55:00Z" };
    expect(evaluatePolicy({ action: release(1000), policy, context: ctx })).toEqual({
      decision: "needs_approval",
      reason: "cooldown: 5 minutes left",
    });
    const later = { ...context, lastExecutedAt: "2026-10-10T09:49:00Z" };
    expect(evaluatePolicy({ action: release(1000), policy, context: later }).decision).toBe(
      "approve",
    );
  });
});

describe("defaultAgencyPolicy", () => {
  it("caps every level at the deal total and always asks for reschedules", () => {
    expect(defaultAgencyPolicy(750000)).toEqual({
      perActionMaxMinor: 750000,
      perMilestoneMaxMinor: 750000,
      perDealMaxMinor: 750000,
      autoReleaseAfterHours: 72,
      cooldownMinutes: 10,
      alwaysAsk: ["reschedule"],
    });
  });

  it("parses with the Policy schema", () => {
    expect(Policy.safeParse(defaultAgencyPolicy(750000)).success).toBe(true);
    expect(Policy.safeParse(defaultAgencyPolicy(0)).success).toBe(true);
  });
});
