import { afterEach, describe, expect, it, vi } from "vitest";
import { createPayPalClient, requiredSellerFeatures } from "./client";
import { CONFIG, mockPayPal } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

const scope = (s: string) => `https://uri.paypal.com/services/${s}`;
const grant = (partner: string, scopes: string[]) => ({
  integration_type: "OAUTH_THIRD_PARTY",
  integration_method: "PAYPAL",
  oauth_third_party: [{ partner_client_id: partner, scopes }],
});

describe("requiredSellerFeatures", () => {
  it("requires delayed disbursement only for that hold mechanism", () => {
    expect(requiredSellerFeatures("authorization")).not.toContain("DELAY_FUNDS_DISBURSEMENT");
    expect(requiredSellerFeatures("delayed_disbursement")).toContain("DELAY_FUNDS_DISBURSEMENT");
  });
});

describe("createSellerReferral", () => {
  it("requests delayed disbursement only for that hold mechanism", async () => {
    const m = mockPayPal([
      {
        method: "POST",
        path: "/v2/customer/partner-referrals",
        status: 201,
        body: { links: [{ rel: "action_url", href: "https://www.sandbox.paypal.com/x" }] },
      },
    ]);
    await createPayPalClient(CONFIG).createSellerReferral({
      trackingId: "ws-1",
      returnUrl: "https://app.test/return",
      mechanism: "authorization",
    });
    const body = JSON.parse(m.calls[0]?.body ?? "{}");
    const features =
      body.operations[0].api_integration_preference.rest_api_integration.third_party_details
        .features;
    expect(features).not.toContain("DELAY_FUNDS_DISBURSEMENT");
    expect(features).toContain("PARTNER_FEE");
    expect(m.calls[0]?.headers.get("paypal-request-id")).toBe("referral-authorization-ws-1");
  });
});

describe("getSellerStatus", () => {
  it("reports only the features granted to our platform client", async () => {
    mockPayPal([
      {
        method: "GET",
        path: "/v1/customer/partners/PARTNER123/merchant-integrations",
        body: { merchant_id: "SELLER1" },
      },
      {
        method: "GET",
        path: "/v1/customer/partners/PARTNER123/merchant-integrations/SELLER1",
        body: {
          payments_receivable: true,
          primary_email_confirmed: true,
          oauth_integrations: [
            grant(CONFIG.clientId, [
              scope("payments/payment/authcapture"),
              scope("payments/refund"),
            ]),
            grant("someone-else", [
              scope("payments/partnerfee"),
              scope("vault/payment-tokens/readwrite"),
            ]),
          ],
        },
      },
    ]);
    await expect(
      createPayPalClient(CONFIG).getSellerStatus({ trackingId: "ws-1" }),
    ).resolves.toEqual({
      merchantId: "SELLER1",
      paymentsReceivable: true,
      primaryEmailConfirmed: true,
      grantedFeatures: ["PAYMENT", "REFUND"],
    });
  });
});
