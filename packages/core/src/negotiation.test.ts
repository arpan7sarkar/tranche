import type { PlanDraft } from "@tranche/contracts";
import fc from "fast-check";
import { expect, it } from "vitest";
import { applyAdjustment, validateDecision } from "./negotiation";

const base: PlanDraft = {
  summary: "Build",
  currency: "USD",
  milestones: [
    {
      key: "build",
      title: "Build",
      price: { currency: "USD", minor: 10000 },
      criteria: { checks: [{ kind: "url_live", url: "https://example.com" }], prose: [] },
      payees: [{ kind: "agency", shareBps: 10000 }],
    },
  ],
  tasks: [{ key: "build", title: "Build", durationDays: 2, dependsOn: [], milestoneKey: "build" }],
};
it("never admits a client's offer above its budget across generated prices", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 1000000 }),
      fc.integer({ min: 1, max: 1000000 }),
      (price, limit) => {
        const result = validateDecision({
          base,
          side: "client",
          mandate: { side: "client", limitMinor: limit, latestEndDate: null, maxRounds: 4 },
          incoming: null,
          previousOwn: null,
          startDate: "2026-11-02",
          decision: {
            kind: "offer",
            adjustment: {
              milestonePrices: [{ key: "build", priceMinor: price }],
              taskDurations: [],
            },
            message: "Offer",
          },
        });
        expect(result.ok).toBe(price <= limit);
      },
    ),
  );
});
it("rejects changed scope even when the incoming price is affordable", () => {
  const incoming = structuredClone(base);
  const task = incoming.tasks[0];
  if (!task) throw new Error("missing_fixture_task");
  task.title = "Different scope";
  expect(
    validateDecision({
      base,
      incoming,
      previousOwn: null,
      side: "client",
      mandate: { side: "client", limitMinor: 20000, latestEndDate: null, maxRounds: 4 },
      startDate: "2026-11-02",
      decision: { kind: "accept", message: "Accept" },
    }).ok,
  ).toBe(false);
});
it("rejects duplicate adjustment keys", () => {
  expect(() =>
    applyAdjustment(base, {
      milestonePrices: [
        { key: "build", priceMinor: 1 },
        { key: "build", priceMinor: 2 },
      ],
      taskDurations: [],
    }),
  ).toThrow("duplicate");
});
