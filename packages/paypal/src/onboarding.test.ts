import { SandboxOnboardingContext, SandboxOperationSpec } from "@tranche/contracts";
import { describe, expect, it } from "vitest";
import { SandboxTransportError } from "./client";
import {
  onboardingFailure,
  onboardingRequest,
  onboardingSpec,
  onboardingStatusRequest,
  parseReferral,
  verifyOnboarding,
} from "./onboarding";

const scope = "https://uri.paypal.com/services/payments/payment/authcapture";
const context = SandboxOnboardingContext.parse({
  seller: "seller-a",
  platformMerchantId: "PLATFORM00001",
  sellerMerchantId: "SELLERA000001",
  platformClientId: "FAKE_CLIENT",
  mappingVersion: 1,
  trackingId: "test-tracking",
  partner: { attributionId: "FAKE_BN" },
  product: "EXPRESS_CHECKOUT",
  features: ["PAYMENT"],
  requiredScopes: [scope],
  shareDataConsent: true,
  checkUntil: "2026-10-13T00:00:00.000Z",
});
function response(change = {}) {
  return {
    merchant_id: context.sellerMerchantId,
    tracking_id: context.trackingId,
    payments_receivable: true,
    primary_email_confirmed: true,
    products: [{ name: "EXPRESS_CHECKOUT", status: "ACTIVE" }],
    oauth_integrations: [
      {
        integration_type: "OAUTH_THIRD_PARTY",
        integration_method: "PAYPAL",
        oauth_third_party: [{ partner_client_id: "FAKE_CLIENT", scopes: [scope] }],
      },
    ],
    ...change,
  };
}
const referral = (
  self = "https://api-m.sandbox.paypal.com/v2/customer/partner-referrals/FAKE_REF",
  action = "https://www.sandbox.paypal.com/consent?token=PRIVATE",
) => ({
  links: [
    { rel: "self", href: self, method: "GET" },
    { rel: "action_url", href: action, method: "GET" },
  ],
});
describe("PayPal onboarding contracts", () => {
  it("constructs exact minimal requests with explicit consent and no money", () => {
    const spec = onboardingSpec({ context, recoveryCalls: 3 });
    expect(spec.request).toEqual(onboardingRequest(context));
    expect(spec.recipients).toEqual([{ alias: "seller-a", cents: 0 }]);
    expect(onboardingStatusRequest(context).path).toBe(
      "/v1/customer/partners/PLATFORM00001/merchant-integrations/SELLERA000001",
    );
    expect(spec.request.body).toMatchObject({
      tracking_id: "test-tracking",
      products: ["EXPRESS_CHECKOUT"],
    });
    expect(
      SandboxOperationSpec.safeParse({ ...spec, recipients: [{ alias: "seller-b", cents: 0 }] })
        .success,
    ).toBe(false);
  });
  it("requires authoritative identity, matching platform grants and readiness", () => {
    expect(verifyOnboarding(response(), context)).toMatchObject({
      status: "consent_verified",
      reason: "ready",
    });
    for (const change of [{ merchant_id: "SELLERB000001" }, { tracking_id: "other" }])
      expect(verifyOnboarding(response(change), context).reason).toBe("identity_mismatch");
  });
  it.each([
    [{ payments_receivable: false }, "payment_readiness"],
    [{ primary_email_confirmed: false }, "payment_readiness"],
    [{ products: [{ name: "EXPRESS_CHECKOUT", status: "PENDING" }] }, "product_inactive"],
    [
      { products: [{ name: "EXPRESS_CHECKOUT", status: "PENDING", vetting_status: "SUBSCRIBED" }] },
      "product_inactive",
    ],
    [{ products: [] }, "product_inactive"],
    [{ oauth_integrations: [] }, "missing_permissions"],
    [
      {
        oauth_integrations: [
          {
            integration_type: "OAUTH_THIRD_PARTY",
            integration_method: "PAYPAL",
            oauth_third_party: [{ partner_client_id: "OTHER_APP", scopes: [scope] }],
          },
        ],
      },
      "missing_permissions",
    ],
  ])("does not claim readiness for incomplete integration", (change, reason) => {
    expect(verifyOnboarding(response(change), context)).toMatchObject({
      status: "readiness_incomplete",
      reason,
    });
  });
  it("rejects malformed readiness and ignores private response extras", () => {
    expect(verifyOnboarding({ payments_receivable: "true" }, context).reason).toBe(
      "malformed_response",
    );
    expect(
      JSON.stringify(
        verifyOnboarding(
          response({ primary_email: "private@example.test", secret: "PRIVATE" }),
          context,
        ),
      ),
    ).not.toMatch(/private@example|PRIVATE/);
  });
  it.each(["PPCP_STANDARD", "PPCP_CUSTOM"])(
    "accepts subscribed %s only when PPCP is requested",
    (name) => {
      const body = response({ products: [{ name, vetting_status: "SUBSCRIBED" }] });
      expect(verifyOnboarding(body, context).reason).toBe("product_inactive");
      expect(verifyOnboarding(body, { ...context, product: "PPCP" })).toMatchObject({
        status: "consent_verified",
        productActive: true,
      });
    },
  );
  it.each([
    { name: "PPCP_STANDARD" },
    { name: "PPCP_STANDARD", vetting_status: "SUBSCRIBED_WITH_LIMIT" },
    { name: "PPCP_STANDARD", vetting_status: "IN_REVIEW" },
    { name: "PPCP_CUSTOM", status: "PENDING", vetting_status: "SUBSCRIBED" },
    { name: "MOBILE_PAYMENT_ACCEPTANCE", status: "ACTIVE" },
  ])("keeps uncertain or unrelated PPCP readiness blocked: %j", (product) => {
    expect(
      verifyOnboarding(response({ products: [product] }), { ...context, product: "PPCP" }),
    ).toMatchObject({ status: "readiness_incomplete", reason: "product_inactive" });
  });
  it("validates both referral destinations without following returned API links", () => {
    expect(parseReferral(referral()).referralId).toBe("FAKE_REF");
    expect(
      parseReferral(
        referral("https://api.sandbox.paypal.com/v2/customer/partner-referrals/FAKE_REF"),
      ).referralId,
    ).toBe("FAKE_REF");
  });
  it.each([
    [
      "https://api-m.paypal.com/v2/customer/partner-referrals/FAKE_REF",
      "https://www.sandbox.paypal.com/consent",
    ],
    [
      "https://api-m.sandbox.paypal.com/v2/customer/partner-referrals/FAKE_REF?token=bad",
      "https://www.sandbox.paypal.com/consent",
    ],
    [
      "https://api-m.sandbox.paypal.com/v2/customer/partner-referrals/FAKE_REF",
      "https://www.paypal.com/consent",
    ],
    [
      "https://evil.test/v2/customer/partner-referrals/FAKE_REF",
      "https://www.sandbox.paypal.com/consent",
    ],
    [
      "https://api-m.sandbox.paypal.com/v2/customer/partner-referrals/FAKE_REF",
      "https://user:pass@www.sandbox.paypal.com/consent",
    ],
  ])("rejects unsafe referral links", (self, action) =>
    expect(() => parseReferral(referral(self, action))).toThrow(),
  );
  it("rejects ambiguous or missing links", () => {
    expect(() => parseReferral({ links: [] })).toThrow();
    const body = referral();
    body.links.push(body.links[0] as (typeof body.links)[number]);
    expect(() => parseReferral(body)).toThrow();
  });
  it.each([
    [403, "permission_denied"],
    [422, "request_rejected"],
    [404, "not_found"],
    [500, "provider_unavailable"],
  ] as const)("reports only safe metadata for HTTP %s", (status, reason) => {
    expect(onboardingFailure(new SandboxTransportError("http", status))).toMatchObject({
      state: "inconclusive",
      onboarding: { evidence: { reason } },
    });
  });
});
