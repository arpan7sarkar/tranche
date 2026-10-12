import { randomUUID } from "node:crypto";
import { SandboxMaintenanceInput, SandboxOperationSpec } from "@tranche/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sandboxProductContext, sandboxRetirementOrder } from "./sandbox-policy";

const context = {
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
};
function source(payment = false) {
  return SandboxOperationSpec.parse({
    version: 1,
    kind: payment ? "create_order" : "onboard_seller",
    currency: "USD",
    sender: payment ? "buyer" : "platform",
    recipients: [{ alias: "seller-a", cents: payment ? 100 : 0 }],
    feeBoundCents: 0,
    commitmentId: randomUUID(),
    resourceKey: "fixture",
    recoveryCalls: 2,
    request: {
      method: "POST",
      path: payment ? "/v2/checkout/orders" : "/v2/customer/partner-referrals",
      body: {},
    },
    ...(payment
      ? {
          payment: {
            stage: "create_order",
            context: {
              path: "authorization_capture",
              seller: context,
              buyerMerchantId: "BUYER00000001",
              buyerMappingVersion: 1,
              principalCents: 100,
              feeBounds: { create_order: 0, authorize_order: 0, capture_order: 0 },
              executeUntil: "2026-10-13T00:00:00.000Z",
              recoverUntil: "2026-10-14T00:00:00.000Z",
              recoveryCalls: 2,
            },
          },
        }
      : { onboarding: context }),
  });
}
describe("sandbox maintenance policy", () => {
  it("changes only the checked product and mapping version while preserving the dispatched request", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10000 }), (version) => {
        const s = source();
        if (!s.onboarding) throw new Error("fixture");
        s.onboarding.mappingVersion = version;
        const original = structuredClone(s);
        expect(
          sandboxProductContext(s, {
            kind: "onboarding_product",
            product: "PPCP",
            mappingVersion: version + 1,
          }),
        ).toEqual({ ...s.onboarding, product: "PPCP", mappingVersion: version + 1 });
        expect(s).toEqual(original);
      }),
      { numRuns: 1000 },
    );
  });
  it.each([
    { kind: "onboarding_product", product: "PPCP", mappingVersion: 1 },
    { kind: "onboarding_product", product: "PPCP", mappingVersion: 3 },
    { kind: "onboarding_product", product: "EXPRESS_CHECKOUT", mappingVersion: 2 },
    { kind: "onboarding_product", product: "PPCP", mappingVersion: 2, sellerMerchantId: "OTHER" },
    { kind: "retire_order", amount: 0 },
  ])("rejects stale or excessive changes %j", (input) => {
    expect(() => sandboxProductContext(source(), input)).toThrow();
  });
  it("accepts only an empty strict retirement request", () => {
    expect(SandboxMaintenanceInput.parse({ kind: "retire_order" })).toEqual({
      kind: "retire_order",
    });
  });
  function order(s: SandboxOperationSpec, change = {}) {
    return {
      id: "ORDER1",
      intent: "AUTHORIZE",
      status: "PAYER_ACTION_REQUIRED",
      purchase_units: [
        {
          reference_id: s.commitmentId,
          amount: { currency_code: "USD", value: "1.00" },
          payee: { merchant_id: context.sellerMerchantId },
        },
      ],
      ...change,
    };
  }
  it("accepts a matching order without buyer approval or payment resources", () => {
    const s = source(true);
    expect(sandboxRetirementOrder(s, "ORDER1", order(s)).id).toBe("ORDER1");
  });
  it.each([
    { id: "OTHER" },
    { intent: "CAPTURE" },
    { status: "APPROVED" },
    { status: "COMPLETED" },
    { payer: { payer_id: "BUYER00000001" } },
    { payment_source: { paypal: { account_id: "BUYER00000001" } } },
    { purchase_units: [] },
  ])("rejects unsafe retirement evidence %j", (change) => {
    const s = source(true);
    expect(() => sandboxRetirementOrder(s, "ORDER1", order(s, change))).toThrow();
  });
  it.each([
    { amount: { currency_code: "EUR", value: "1.00" } },
    { amount: { currency_code: "USD", value: "0.01" } },
    { reference_id: "OTHER" },
    { payee: { merchant_id: "OTHER" } },
    { payments: { authorizations: [{}] } },
    { payments: { captures: [{}] } },
  ])("rejects mismatching units or existing money resources %j", (change) => {
    const s = source(true);
    const body = order(s);
    expect(() =>
      sandboxRetirementOrder(s, "ORDER1", {
        ...body,
        purchase_units: [{ ...body.purchase_units[0], ...change }],
      }),
    ).toThrow();
  });
});
