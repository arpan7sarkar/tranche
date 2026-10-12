import { randomUUID } from "node:crypto";
import { SandboxPaymentContext, SandboxPaymentSpec } from "@tranche/contracts";
import { describe, expect, it } from "vitest";
import {
  paymentAuthorization,
  paymentBrowserUrl,
  paymentCapture,
  paymentRequest,
  paymentSpec,
  verifyAuthorizationResource,
  verifyBuyerChangeOrder,
  verifyPaymentOrder,
} from "./protection";

const c = SandboxPaymentContext.parse({
  checkout: {
    returnUrl: "http://localhost:3000/sandbox/checkout/return",
    cancelUrl: "http://localhost:3000/sandbox/checkout/cancel",
  },
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
    checkUntil: new Date(Date.now() + 3600000).toISOString(),
  },
  buyerMerchantId: "BUYER00000001",
  buyerMappingVersion: 1,
  principalCents: 50,
  feeBounds: { create_order: 0, authorize_order: 0, capture_order: 0 },
  executeUntil: new Date(Date.now() + 3600000).toISOString(),
  recoverUntil: new Date(Date.now() + 7200000).toISOString(),
  recoveryCalls: 3,
});
const commitmentId = randomUUID();
const spec = paymentSpec(c, commitmentId);
const p = SandboxPaymentSpec.parse(spec.payment);
function order(status = "APPROVED") {
  return {
    id: "ORDER1",
    status,
    intent: "AUTHORIZE",
    payer: { payer_id: c.buyerMerchantId },
    purchase_units: [
      {
        reference_id: commitmentId,
        amount: { currency_code: "USD", value: "0.50" },
        payee: { merchant_id: c.seller.sellerMerchantId },
      },
    ],
    links: [
      {
        rel: "payer-action",
        method: "GET",
        href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER1",
      },
    ],
  };
}
const auth = () => ({
  id: "AUTH1",
  status: "CREATED",
  amount: { currency_code: "USD", value: "0.50" },
  expiration_time: new Date(Date.now() + 86400000).toISOString(),
});
const cap = () => ({
  id: "CAPTURE1",
  status: "COMPLETED",
  amount: { currency_code: "USD", value: "0.50" },
  supplementary_data: { related_ids: { order_id: "ORDER1", authorization_id: "AUTH1" } },
});
describe("P4 exact PayPal contracts", () => {
  it("requires an unapproved matching order without payer identity or payment resources for buyer changes", () => {
    const unapproved = { ...order("PAYER_ACTION_REQUIRED"), payer: undefined };
    expect(verifyBuyerChangeOrder(unapproved, p, commitmentId).id).toBe("ORDER1");
    expect(() => verifyBuyerChangeOrder(order("APPROVED"), p, commitmentId)).toThrow();
    expect(() => verifyBuyerChangeOrder(order("CREATED"), p, commitmentId)).toThrow();
    expect(() =>
      verifyBuyerChangeOrder(
        { ...unapproved, payment_source: { paypal: { account_id: c.buyerMerchantId } } },
        p,
        commitmentId,
      ),
    ).toThrow();
    expect(() =>
      verifyBuyerChangeOrder(
        {
          ...unapproved,
          purchase_units: [
            { ...unapproved.purchase_units[0], payments: { authorizations: [auth()] } },
          ],
        },
        p,
        commitmentId,
      ),
    ).toThrow();
    expect(() =>
      verifyBuyerChangeOrder(
        { ...unapproved, id: "OTHER" },
        { ...p, orderId: "ORDER1" },
        commitmentId,
      ),
    ).toThrow();
  });
  it("builds AUTHORIZE order, mapped payee and controlled headers", () => {
    expect(spec.request).toMatchObject({
      path: "/v2/checkout/orders",
      assertion: { sellerMerchantId: c.seller.sellerMerchantId },
      representation: true,
      body: {
        payment_source: {
          paypal: {
            experience_context: {
              user_action: "CONTINUE",
              return_url: c.checkout?.returnUrl,
              cancel_url: c.checkout?.cancelUrl,
            },
          },
        },
        intent: "AUTHORIZE",
        purchase_units: [
          {
            reference_id: commitmentId,
            amount: { value: "0.50" },
            payee: { merchant_id: c.seller.sellerMerchantId },
          },
        ],
      },
    });
  });
  it.each(["authorize_order", "capture_order"] as const)("requires references for %s", (stage) =>
    expect(() => paymentRequest({ ...p, stage }, commitmentId)).toThrow(),
  );
  it("builds final capture against the matching authorization", () =>
    expect(
      paymentSpec(c, commitmentId, "capture_order", { orderId: "ORDER1", authorizationId: "AUTH1" })
        .request,
    ).toMatchObject({
      path: "/v2/payments/authorizations/AUTH1/capture",
      body: { amount: { value: "0.50" }, final_capture: true },
    }));
  it.each(["buyer", "seller", "amount", "reference", "intent", "currency"])(
    "rejects changed order %s",
    (field) => {
      const o = order();
      const unit = o.purchase_units[0];
      if (!unit) throw new Error("missing_fixture_unit");
      if (field === "buyer") o.payer.payer_id = "OTHER00000001";
      if (field === "seller") unit.payee.merchant_id = "OTHER00000001";
      if (field === "amount") unit.amount.value = "0.51";
      if (field === "reference") unit.reference_id = randomUUID();
      if (field === "intent") o.intent = "CAPTURE";
      if (field === "currency") unit.amount.currency_code = "EUR";
      expect(() => verifyPaymentOrder(o, p, commitmentId)).toThrow();
    },
  );
  it("requires buyer identity after checkout approval", () => {
    const o = order();
    expect(() => verifyPaymentOrder({ ...o, payer: undefined }, p, commitmentId)).toThrow(
      "buyer_identity_missing",
    );
  });
  it.each([
    "https://www.paypal.com/checkoutnow?token=ORDER1",
    "https://www.sandbox.paypal.com/checkoutnow?token=OTHER",
    "https://evil.example/?token=ORDER1",
    "https://www.sandbox.paypal.com/?token=ORDER1&token=ORDER1",
  ])("rejects unsafe checkout %s", (url) => {
    const o = order("CREATED");
    const link = o.links[0];
    if (!link) throw new Error("missing_fixture_link");
    link.href = url;
    expect(() => paymentBrowserUrl(o, p, commitmentId)).toThrow();
  });
  it("accepts a matching sandbox checkout link", () =>
    expect(paymentBrowserUrl(order("CREATED"), p, commitmentId).orderId).toBe("ORDER1"));
  it("requires a valid authorization expiry and matching amount", () => {
    const o = order("COMPLETED");
    const body = {
      ...o,
      purchase_units: [{ ...o.purchase_units[0], payments: { authorizations: [auth()] } }],
    };
    expect(paymentAuthorization(body, { ...p, orderId: "ORDER1" }, commitmentId).evidence).toBe(
      "authorized",
    );
    expect(() =>
      paymentAuthorization(
        {
          ...body,
          purchase_units: [
            {
              ...body.purchase_units[0],
              payments: { authorizations: [{ ...auth(), expiration_time: undefined }] },
            },
          ],
        },
        p,
        commitmentId,
      ),
    ).toThrow();
    expect(() =>
      verifyAuthorizationResource(
        { ...auth(), id: "OTHER" },
        { ...p, orderId: "ORDER1", authorizationId: "AUTH1" },
      ),
    ).toThrow();
  });
  it("requires capture lineage and distinguishes pending", () => {
    const context = {
      ...p,
      stage: "capture_order" as const,
      orderId: "ORDER1",
      authorizationId: "AUTH1",
    };
    expect(paymentCapture(cap(), context).evidence).toBe("captured_immediate");
    expect(paymentCapture({ ...cap(), status: "PENDING" }, context).evidence).toBe("pending");
    expect(() => paymentCapture({ ...cap(), supplementary_data: undefined }, context)).toThrow(
      "capture_lineage",
    );
  });
});
