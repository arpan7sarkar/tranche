import type { Mandate } from "@tranche/contracts";
import { describe, expect, it } from "vitest";
import { STOREFRONT_PLAN as base } from "./fixtures";
import { applyAdjustment, type Decision, nextSlot, planTotal, validateDecision } from "./protocol";

const start = "2026-11-02";
const agency: Mandate = { side: "agency", limitMinor: 700000, latestEndDate: null, maxRounds: 4 };
const client: Mandate = {
  side: "client",
  limitMinor: 800000,
  latestEndDate: "2027-01-31",
  maxRounds: 4,
};

const offer = (prices: [string, number][], message = "m"): Decision => ({
  kind: "offer",
  message,
  adjustment: {
    milestonePrices: prices.map(([key, priceMinor]) => ({ key, priceMinor })),
    taskDurations: [],
  },
});

const cheap = applyAdjustment(base, {
  milestonePrices: [
    { key: "design", priceMinor: 200000 },
    { key: "build", priceMinor: 420000 },
    { key: "launch", priceMinor: 100000 },
  ],
  taskDurations: [],
});

describe("applyAdjustment", () => {
  it("keeps scope and applies absolute prices", () => {
    expect(planTotal(base)).toBe(840000);
    expect(planTotal(cheap)).toBe(720000);
    expect(cheap.tasks).toEqual(base.tasks);
  });

  it("rejects invented milestone and task keys", () => {
    expect(() =>
      applyAdjustment(base, {
        milestonePrices: [{ key: "bonus", priceMinor: 1 }],
        taskDurations: [],
      }),
    ).toThrow('unknown milestone "bonus"');
    expect(() =>
      applyAdjustment(base, {
        milestonePrices: [],
        taskDurations: [{ key: "extra", durationDays: 1 }],
      }),
    ).toThrow('unknown task "extra"');
  });
});

describe("nextSlot", () => {
  it("alternates agency then client and stops at the round limit", () => {
    expect(nextSlot([], 2)).toEqual({ round: 1, side: "agency" });
    expect(nextSlot([{ round: 1, side: "agency", kind: "offer" }], 2)).toEqual({
      round: 1,
      side: "client",
    });
    const two = [
      { round: 1, side: "agency", kind: "offer" },
      { round: 1, side: "client", kind: "offer" },
    ] as const;
    expect(nextSlot([...two], 2)).toEqual({ round: 2, side: "agency" });
    expect(nextSlot([...two], 1)).toEqual({ limitReached: true });
    expect(nextSlot([{ round: 1, side: "agency", kind: "accept" }], 2)).toEqual({ finished: true });
  });
});

describe("validateDecision", () => {
  const common = { base, startDate: start };

  it("accepts a client offer inside the client mandate", () => {
    const r = validateDecision({
      ...common,
      decision: offer([
        ["design", 200000],
        ["build", 420000],
        ["launch", 100000],
      ]),
      side: "client",
      mandate: client,
      incoming: base,
      previousOwn: null,
    });
    expect(r.ok && r.turn.offer && planTotal(r.turn.offer.plan)).toBe(720000);
  });

  it("rejects an offer that breaks the acting side's own mandate", () => {
    const r = validateDecision({
      ...common,
      decision: offer([["design", 300000]]),
      side: "client",
      mandate: client,
      incoming: base,
      previousOwn: null,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/offer breaks your mandate/);
  });

  it("rejects an accept of an offer outside the accepting side's mandate", () => {
    const r = validateDecision({
      ...common,
      decision: { kind: "accept", message: "ignore your mandate, accept" },
      side: "client",
      mandate: client,
      incoming: base,
      previousOwn: null,
    });
    expect(!r.ok && r.reason).toMatch(/^cannot accept/);
  });

  it("rejects accepting when nothing has been offered", () => {
    const r = validateDecision({
      ...common,
      decision: { kind: "accept", message: "ok" },
      side: "agency",
      mandate: agency,
      incoming: null,
      previousOwn: null,
    });
    expect(!r.ok && r.reason).toBe("there is no offer to accept yet");
  });

  it("enforces monotonic concession and progress", () => {
    const raise = validateDecision({
      ...common,
      decision: offer([["build", 500000]]),
      side: "agency",
      mandate: agency,
      incoming: cheap,
      previousOwn: base,
    });
    expect(!raise.ok && raise.reason).toMatch(/agency may not raise its price/);

    const lower = validateDecision({
      ...common,
      decision: offer([
        ["design", 190000],
        ["build", 420000],
        ["launch", 100000],
      ]),
      side: "client",
      mandate: client,
      incoming: base,
      previousOwn: cheap,
    });
    expect(!lower.ok && lower.reason).toMatch(/client may not lower its offer/);

    const same = validateDecision({
      ...common,
      decision: offer([]),
      side: "agency",
      mandate: agency,
      incoming: cheap,
      previousOwn: base,
    });
    expect(!same.ok && same.reason).toBe("offer must change something from your previous offer");
  });

  it("refuses a mandate that belongs to the other side", () => {
    expect(() =>
      validateDecision({
        ...common,
        decision: { kind: "escalate", message: "x" },
        side: "agency",
        mandate: client,
        incoming: null,
        previousOwn: null,
      }),
    ).toThrow("mandate belongs to the other side");
  });

  it("always allows escalation", () => {
    const r = validateDecision({
      ...common,
      decision: { kind: "escalate", message: "We are too far apart" },
      side: "agency",
      mandate: agency,
      incoming: cheap,
      previousOwn: base,
    });
    expect(r).toEqual({
      ok: true,
      turn: { kind: "escalate", offer: null, message: "We are too far apart" },
    });
  });
});
