import { afterEach, describe, expect, it, vi } from "vitest";
import { createPayPalClient } from "./client";
import { CONFIG, mockPayPal, ORDER_APPROVED, ORDER_CAPTURED } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

const ORDER_PATH = "/v2/checkout/orders/5O190127TN364715T";
const input = {
  requestId: "place-hold-h1",
  orderId: "5O190127TN364715T",
  mechanism: "delayed_disbursement" as const,
};

describe("placeHold", () => {
  it("captures an approved order with the stable request id", async () => {
    const m = mockPayPal([
      { method: "GET", path: ORDER_PATH, body: ORDER_APPROVED },
      { method: "POST", path: `${ORDER_PATH}/capture`, status: 201, body: ORDER_CAPTURED },
    ]);
    const hold = await createPayPalClient(CONFIG).placeHold(input);
    expect(hold).toEqual({
      captureId: "3C679366HH908993F",
      authorizationId: null,
      expiresAt: "2026-11-06T10:00:00.000Z",
      honorExpiresAt: null,
      vaultId: "8kk8451t",
    });
    expect(m.calls[1]?.headers.get("paypal-request-id")).toBe("place-hold-h1");
  });

  it("does not capture an order that is already captured", async () => {
    const m = mockPayPal([{ method: "GET", path: ORDER_PATH, body: ORDER_CAPTURED }]);
    const hold = await createPayPalClient(CONFIG).placeHold(input);
    expect(hold.captureId).toBe("3C679366HH908993F");
    expect(m.calls).toHaveLength(1);
  });
});

describe("createFundingOrder", () => {
  it("omits platform fees when the fee is zero", async () => {
    const m = mockPayPal([
      { method: "POST", path: "/v2/checkout/orders", status: 201, body: ORDER_APPROVED },
    ]);
    await createPayPalClient(CONFIG).createFundingOrder({
      requestId: "fund-m1-0",
      mechanism: "authorization",
      amount: { currency: "USD", minor: 100 },
      platformFee: { currency: "USD", minor: 0 },
      payeeMerchantId: "SELLER1",
      milestoneId: "m1",
      vaultId: null,
      returnUrl: "https://app.test/portal/tok?funded=m1",
      cancelUrl: "https://app.test/portal/tok",
    });
    const unit = JSON.parse(m.calls[0]?.body ?? "{}").purchase_units[0];
    expect(unit.payment_instruction).toBeUndefined();
  });
});
