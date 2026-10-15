import { afterEach, describe, expect, it, vi } from "vitest";
import { createPayPalClient } from "./client";
import { CONFIG, mockPayPal } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

const SIGNATURE_HEADERS = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42",
  "paypal-transmission-id": "69cd13f0-d67a-11e5-baa3-778b53f4ae55",
  "paypal-transmission-sig": "lmI95Jx3Y9nhR5SJWlHVIWpg4AgFk7n9bCHSRxbrd8A9zrhdu2rMyFrmz==",
  "paypal-transmission-time": "2026-10-10T10:00:00Z",
};
const VERIFY_PATH = "/v1/notifications/verify-webhook-signature";

describe("verifyWebhook", () => {
  it("sends the raw webhook body verbatim", async () => {
    const rawBody =
      '{"id": "WH-1",   "event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"amount":{"value":"10.00"}}}';
    const m = mockPayPal([
      { method: "POST", path: VERIFY_PATH, body: { verification_status: "SUCCESS" } },
    ]);
    const paypal = createPayPalClient(CONFIG);
    await expect(
      paypal.verifyWebhook({ headers: SIGNATURE_HEADERS, rawBody, webhookId: "WH-ID" }),
    ).resolves.toBe(true);
    const sent = m.calls[0]?.body ?? "";
    expect(sent.endsWith(`"webhook_event":${rawBody}}`)).toBe(true);
    expect(JSON.parse(sent)).toMatchObject({ webhook_id: "WH-ID", auth_algo: "SHA256withRSA" });
  });

  it("returns false on FAILURE", async () => {
    mockPayPal([{ method: "POST", path: VERIFY_PATH, body: { verification_status: "FAILURE" } }]);
    await expect(
      createPayPalClient(CONFIG).verifyWebhook({
        headers: SIGNATURE_HEADERS,
        rawBody: '{"id":"WH-1"}',
        webhookId: "WH-ID",
      }),
    ).resolves.toBe(false);
  });

  it("returns false without calling PayPal when a header is missing or the body is not JSON", async () => {
    const m = mockPayPal([]);
    const paypal = createPayPalClient(CONFIG);
    const { "paypal-transmission-sig": _, ...missing } = SIGNATURE_HEADERS;
    await expect(
      paypal.verifyWebhook({ headers: missing, rawBody: '{"id":"WH-1"}', webhookId: "WH-ID" }),
    ).resolves.toBe(false);
    await expect(
      paypal.verifyWebhook({ headers: SIGNATURE_HEADERS, rawBody: "not json", webhookId: "WH-ID" }),
    ).resolves.toBe(false);
    expect(m.calls).toHaveLength(0);
  });
});
