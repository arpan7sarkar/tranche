import { SandboxPaymentApproval, type SandboxPaymentContext } from "@tranche/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { paymentApproval, paymentStageCalls, paymentTotalCalls } from "./sandbox-payment-budget";

const context: SandboxPaymentContext = {
  path: "authorization_capture",
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
    checkUntil: "2026-10-16T10:00:00.000Z",
  },
  buyerMerchantId: "BUYER00000001",
  buyerMappingVersion: 2,
  principalCents: 50,
  feeBounds: { create_order: 1, authorize_order: 2, capture_order: 3 },
  executeUntil: "2026-10-16T10:00:00.000Z",
  recoverUntil: "2026-10-16T11:00:00.000Z",
  recoveryCalls: 3,
};

describe("sandbox payment budget", () => {
  it.each([
    [2, 7, 9, 10, 26],
    [3, 9, 11, 12, 32],
    [4, 11, 13, 14, 38],
  ])(
    "preserves the approved call allowances for %i recovery reads",
    (n, order, auth, capture, total) => {
      expect(paymentStageCalls("create_order", n)).toBe(order);
      expect(paymentStageCalls("authorize_order", n)).toBe(auth);
      expect(paymentStageCalls("capture_order", n)).toBe(capture);
      expect(paymentTotalCalls({ ...context, recoveryCalls: n })).toBe(total);
    },
  );

  it("reserves each stage once without multiplying principal", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 4 }), (recoveryCalls) => {
        const input = { ...context, recoveryCalls };
        const stages = ["create_order", "authorize_order", "capture_order"] as const;
        expect(paymentTotalCalls(input)).toBe(
          stages.reduce((sum, stage) => sum + paymentStageCalls(stage, recoveryCalls), 0),
        );
        expect(paymentTotalCalls(input)).toBeLessThanOrEqual(50);
        expect(input.principalCents).toBe(50);
      }),
    );
  });

  it("preserves approval terms and excludes private seller and buyer identifiers", () => {
    expect(SandboxPaymentApproval.parse(paymentApproval(context))).toEqual({
      path: "authorization_capture",
      buyerMappingVersion: 2,
      sellerMappingVersion: 1,
      executeUntil: context.executeUntil,
      recoverUntil: context.recoverUntil,
      lifecycleCalls: 32,
      totalFeeBoundCents: 6,
    });
    const checkout = {
      returnUrl: "http://localhost:3000/sandbox/checkout/return",
      cancelUrl: "http://localhost:3000/sandbox/checkout/cancel",
    };
    expect(paymentApproval({ ...context, checkout }).checkout).toEqual(checkout);
  });
});
