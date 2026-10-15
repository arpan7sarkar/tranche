import { describe, expect, it } from "vitest";
import {
  SandboxBuyerChangeInput,
  SandboxCheckout,
  SandboxPaymentContext,
} from "./sandbox-protection";

export function paymentFixture() {
  return {
    path: "authorization_capture" as const,
    seller: {
      seller: "seller-a" as const,
      platformMerchantId: "PLATFORM00001",
      sellerMerchantId: "SELLERA000001",
      platformClientId: "FAKE_CLIENT",
      mappingVersion: 1,
      trackingId: "FAKE_TRACK",
      partner: { attributionId: "FAKE_BN" },
      product: "EXPRESS_CHECKOUT" as const,
      features: ["PAYMENT" as const],
      requiredScopes: ["https://uri.paypal.com/services/payments/payment/authcapture" as const],
      shareDataConsent: true as const,
      checkUntil: new Date(Date.now() + 3600000).toISOString(),
    },
    buyerMerchantId: "BUYER00000001",
    buyerMappingVersion: 1,
    principalCents: 50,
    feeBounds: { create_order: 1, authorize_order: 2, capture_order: 3 },
    executeUntil: new Date(Date.now() + 3600000).toISOString(),
    recoverUntil: new Date(Date.now() + 7200000).toISOString(),
    recoveryCalls: 3,
  };
}
describe("P4 private payment context", () => {
  it.each([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
    "https://example.test",
  ])("accepts same-origin sandbox callbacks at %s", (origin) => {
    expect(
      SandboxCheckout.safeParse({
        returnUrl: `${origin}/sandbox/checkout/return`,
        cancelUrl: `${origin}/sandbox/checkout/cancel`,
      }).success,
    ).toBe(true);
  });
  it.each([
    { returnUrl: "not-a-url" },
    { returnUrl: "javascript:alert(1)" },
    { returnUrl: "http://example.test/sandbox/checkout/return" },
    { returnUrl: "https://user:pass@example.test/sandbox/checkout/return" },
    { returnUrl: "https://other.test/sandbox/checkout/return" },
    { returnUrl: "https://example.test/sandbox/checkout/return?token=PRIVATE" },
    { returnUrl: "https://example.test/sandbox/checkout/return#fragment" },
    { returnUrl: "https://example.test/elsewhere" },
    { cancelUrl: "https://example.test/sandbox/checkout/return" },
    { extra: "unexpected" },
  ])("rejects unsafe or unrelated callback destinations %j", (change) => {
    expect(
      SandboxCheckout.safeParse({
        returnUrl: "https://example.test/sandbox/checkout/return",
        cancelUrl: "https://example.test/sandbox/checkout/cancel",
        ...change,
      }).success,
    ).toBe(false);
  });
  it.each([
    { buyerMerchantId: "short", buyerMappingVersion: 2 },
    { buyerMerchantId: "BUYER00000002", buyerMappingVersion: 0 },
    {
      buyerMerchantId: "BUYER00000002",
      buyerMappingVersion: 2,
      executeUntil: "2027-01-01T00:00:00.000Z",
    },
  ])("rejects unsafe buyer-change input", (input) => {
    expect(SandboxBuyerChangeInput.safeParse(input).success).toBe(false);
  });
  it("accepts a bounded single-seller authorization experiment", () =>
    expect(SandboxPaymentContext.parse(paymentFixture()).principalCents).toBe(50));
  it.each([
    { path: "delayed_disbursement" },
    { buyerMerchantId: "SELLERA000001" },
    { principalCents: 0 },
    { principalCents: 100 },
    { recoveryCalls: 1 },
    { recoveryCalls: 5 },
    { buyerMappingVersion: 0 },
    { recoverUntil: "2020-01-01T00:00:00.000Z" },
    { extra: "PRIVATE" },
  ])("rejects unsafe context %j", (change) =>
    expect(SandboxPaymentContext.safeParse({ ...paymentFixture(), ...change }).success).toBe(false),
  );
  it("requires authorization permissions", () => {
    const c = paymentFixture();
    expect(
      SandboxPaymentContext.safeParse({
        ...c,
        seller: {
          ...c.seller,
          requiredScopes: ["https://uri.paypal.com/services/payments/realtimepayment"],
        },
      }).success,
    ).toBe(false);
  });
});
