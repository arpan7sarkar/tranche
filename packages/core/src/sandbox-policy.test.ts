import { randomUUID } from "node:crypto";
import type { SandboxAllocation, SandboxOperationSpec } from "@tranche/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { needsSandboxApproval, sandboxApprovalMatches, sandboxEligibility } from "./sandbox-policy";

const allocation: SandboxAllocation = {
  id: 1,
  currency: "USD",
  limitCents: 100,
  callLimit: 50,
  reservedCents: 0,
  committedCents: 0,
  consumedCalls: 0,
  heldCalls: 0,
};
const spec: SandboxOperationSpec = {
  version: 1,
  kind: "create_order",
  currency: "USD",
  sender: "buyer",
  recipients: [{ alias: "seller-a", cents: 10 }],
  feeBoundCents: 2,
  commitmentId: randomUUID(),
  resourceKey: "fixture",
  recoveryCalls: 2,
  request: { method: "POST", path: "/v2/checkout/orders", body: {} },
};

describe("sandbox policy", () => {
  it("binds approval to an unchanged payload and one unused dispatch attempt", () => {
    const payloadHash = "a".repeat(64);
    const approval = { payloadHash, attempt: 1, consumed: false };
    expect(sandboxApprovalMatches({ payloadHash, nextAttempt: 1, approval })).toBe(true);
    expect(sandboxApprovalMatches({ payloadHash: "b".repeat(64), nextAttempt: 1, approval })).toBe(
      false,
    );
    expect(sandboxApprovalMatches({ payloadHash, nextAttempt: 2, approval })).toBe(false);
    expect(
      sandboxApprovalMatches({
        payloadHash,
        nextAttempt: 1,
        approval: { ...approval, consumed: true },
      }),
    ).toBe(false);
  });
  it("requires approval for every business write", () => {
    for (const kind of [
      "create_order",
      "capture_order",
      "release_payment",
      "payout",
      "onboard_seller",
    ] as const) {
      expect(needsSandboxApproval({ ...spec, kind })).toBe(true);
    }
    expect(
      needsSandboxApproval({
        ...spec,
        kind: "read_status",
        request: { method: "GET", path: "/v2/checkout/orders/FAKE" },
      }),
    ).toBe(false);
  });
  it("allows exact boundaries and blocks overages", () => {
    expect(sandboxEligibility({ allocation, spec, additionalCents: 100, requiredCalls: 50 })).toBe(
      "allowed",
    );
    expect(sandboxEligibility({ allocation, spec, additionalCents: 101, requiredCalls: 1 })).toBe(
      "money_limit",
    );
    expect(
      sandboxEligibility({
        allocation: { ...allocation, heldCalls: 49 },
        spec,
        additionalCents: 0,
        requiredCalls: 2,
      }),
    ).toBe("call_limit");
  });
  it("rejects invalid values", () => {
    for (const additionalCents of [-1, 0.5, Number.NaN, Infinity]) {
      expect(sandboxEligibility({ allocation, spec, additionalCents, requiredCalls: 1 })).toBe(
        "invalid",
      );
    }
    expect(
      sandboxEligibility({
        allocation,
        spec: { ...spec, currency: "EUR" } as unknown as SandboxOperationSpec,
        additionalCents: 0,
        requiredCalls: 1,
      }),
    ).toBe("invalid");
  });
  it("never permits an allocation to exceed either limit", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 1, max: 51 }),
        (reservedCents, committedCents, extra, consumedCalls, heldCalls, requiredCalls) => {
          const result = sandboxEligibility({
            allocation: { ...allocation, reservedCents, committedCents, consumedCalls, heldCalls },
            spec,
            additionalCents: extra,
            requiredCalls,
          });
          expect(result === "allowed").toBe(
            reservedCents + committedCents + extra <= 100 &&
              consumedCalls + heldCalls + requiredCalls <= 50,
          );
        },
      ),
      { numRuns: 1000 },
    );
  });
});
