import { afterEach, describe, expect, it, vi } from "vitest";
import { createPayPalClient } from "./client";
import { CONFIG, mockPayPal } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

const scope = (s: string) => `https://uri.paypal.com/services/${s}`;
const grant = (partner: string, scopes: string[]) => ({
  integration_type: "OAUTH_THIRD_PARTY",
  integration_method: "PAYPAL",
  oauth_third_party: [{ partner_client_id: partner, scopes }],
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
