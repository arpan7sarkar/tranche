import { randomUUID } from "node:crypto";
import { SandboxOperationSpec } from "@tranche/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sandboxBuyerChangeSpec } from "./sandbox-policy";

function fixture() {
  return SandboxOperationSpec.parse({
    version: 1,
    kind: "create_order",
    currency: "USD",
    sender: "buyer",
    recipients: [{ alias: "seller-a", cents: 50 }],
    feeBoundCents: 0,
    commitmentId: randomUUID(),
    resourceKey: "fixture",
    recoveryCalls: 3,
    request: { method: "POST", path: "/v2/checkout/orders", body: {} },
    payment: {
      stage: "create_order",
      context: {
        path: "authorization_capture",
        buyerMerchantId: "BUYER00000001",
        buyerMappingVersion: 1,
        principalCents: 50,
        feeBounds: { create_order: 0, authorize_order: 0, capture_order: 0 },
        executeUntil: "2026-10-13T00:00:00.000Z",
        recoverUntil: "2026-10-14T00:00:00.000Z",
        recoveryCalls: 3,
        seller: {
          seller: "seller-a",
          platformMerchantId: "PLATFORM00001",
          sellerMerchantId: "SELLERA000001",
          platformClientId: "FAKE_CLIENT",
          mappingVersion: 1,
          trackingId: "FAKE_TRACK",
          partner: { attributionId: "FAKE_BN" },
          product: "EXPRESS_CHECKOUT",
          features: ["PAYMENT"],
          requiredScopes: ["https://uri.paypal.com/services/payments/payment/authcapture"],
          shareDataConsent: true,
          checkUntil: "2026-10-13T00:00:00.000Z",
        },
      },
    },
  });
}

describe("pure buyer-change policy", () => {
  it("changes only buyer identity and advances exactly one mapping version", () => {
    const source = fixture();
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10000 }), (revision) => {
        const current = structuredClone(source);
        if (!current.payment) throw new Error("fixture");
        current.payment.context.buyerMappingVersion = revision;
        const input = { buyerMerchantId: "BUYER00000002", buyerMappingVersion: revision + 1 };
        expect(sandboxBuyerChangeSpec(current, input)).toEqual({
          ...current,
          payment: { ...current.payment, context: { ...current.payment.context, ...input } },
        });
        expect(current.payment.context.buyerMerchantId).toBe("BUYER00000001");
      }),
      { numRuns: 1000 },
    );
  });
  it.each([
    { buyerMerchantId: "BUYER00000001", buyerMappingVersion: 2 },
    { buyerMerchantId: "SELLERA000001", buyerMappingVersion: 2 },
    { buyerMerchantId: "PLATFORM00001", buyerMappingVersion: 2 },
    { buyerMerchantId: "BUYER00000002", buyerMappingVersion: 1 },
    { buyerMerchantId: "BUYER00000002", buyerMappingVersion: 3 },
    { buyerMerchantId: "BUYER00000002", buyerMappingVersion: 2, principalCents: 1 },
  ])("rejects invalid or expanded amendments", (input) => {
    expect(() => sandboxBuyerChangeSpec(fixture(), input)).toThrow();
  });
  it("cannot turn a later payment stage into a buyer change", () => {
    const source = fixture();
    expect(() =>
      sandboxBuyerChangeSpec(
        { ...source, kind: "authorize_order" },
        {
          buyerMerchantId: "BUYER00000002",
          buyerMappingVersion: 2,
        },
      ),
    ).toThrow("buyer_change_invalid");
  });
});
