import { HoldMechanism, type Money, toPayPalValue } from "@tranche/contracts";
import { describe, expect, it } from "vitest";
import { createPayPalClient, type PayPal } from "./client";
import { PayPalError } from "./errors";
import { platformFeeFor } from "./fees";
import { payPalConfigFromEnv } from "./http";

const env = process.env;
const live =
  env.RUN_PAYPAL_SANDBOX_TEST === "1" && Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET);
const mechanism = HoldMechanism.parse(env.HOLD_MECHANISM ?? "authorization");
const seller = env.SANDBOX_SELLER_MERCHANT_ID;
const amount: Money = { currency: "USD", minor: 100 };
const fee = platformFeeFor(amount);
const value = (m: Money) => ({ currency_code: m.currency, value: toPayPalValue(m) });

function cardOrder(paypal: PayPal, intent: "AUTHORIZE" | "CAPTURE", payee?: string) {
  return paypal.transport.request<{ id: string; status: string }>({
    method: "POST",
    path: "/v2/checkout/orders",
    requestId: crypto.randomUUID(),
    prefer: "return=representation",
    body: {
      intent,
      purchase_units: [
        {
          reference_id: "sandbox-test",
          amount: value(amount),
          ...(payee
            ? {
                payee: { merchant_id: payee },
                payment_instruction: {
                  platform_fees: [{ amount: value(fee) }],
                  ...(intent === "CAPTURE" ? { disbursement_mode: "DELAYED" } : {}),
                },
              }
            : {}),
        },
      ],
      payment_source: {
        card: {
          number: "4111111111111111",
          expiry: "2030-12",
          name: "Sandbox Buyer",
          security_code: "123",
        },
      },
    },
  });
}

describe.runIf(live)("PayPal sandbox", () => {
  const paypal = createPayPalClient(payPalConfigFromEnv());

  it("authorizes, reads the hold, and voids it", async () => {
    const order = await cardOrder(paypal, "AUTHORIZE");
    const hold = await paypal.placeHold({
      requestId: crypto.randomUUID(),
      orderId: order.id,
      mechanism: "authorization",
    });
    expect(Date.parse(hold.expiresAt)).toBeGreaterThan(Date.now() + 20 * 86_400_000);
    await paypal.voidHold({
      requestId: crypto.randomUUID(),
      mechanism: "authorization",
      authorizationId: hold.authorizationId,
      captureId: null,
    });
    const auth = await paypal.getAuthorization(hold.authorizationId ?? "");
    expect(auth.status).toBe("VOIDED");
  }, 60_000);

  it("authorizes and releases by capture, idempotently", async () => {
    const order = await cardOrder(paypal, "AUTHORIZE");
    const hold = await paypal.placeHold({
      requestId: crypto.randomUUID(),
      orderId: order.id,
      mechanism: "authorization",
    });
    const release = {
      requestId: crypto.randomUUID(),
      mechanism: "authorization" as const,
      captureId: null,
      authorizationId: hold.authorizationId,
      amount,
    };
    const first = await paypal.releaseHold(release);
    const again = await paypal.releaseHold(release);
    expect(again.releaseRef).toBe(first.releaseRef);
  }, 60_000);

  it.runIf(Boolean(seller))(
    `holds and releases for the seller with ${mechanism}`,
    async () => {
      const order = await cardOrder(
        paypal,
        mechanism === "authorization" ? "AUTHORIZE" : "CAPTURE",
        seller,
      );
      const hold = await paypal.placeHold({
        requestId: crypto.randomUUID(),
        orderId: order.id,
        mechanism,
      });
      const { releaseRef } = await paypal.releaseHold({
        requestId: crypto.randomUUID(),
        mechanism,
        captureId: hold.captureId,
        authorizationId: hold.authorizationId,
        amount,
        platformFee: fee,
        payeeMerchantId: seller,
      });
      expect(releaseRef).toBeTruthy();
    },
    60_000,
  );

  it("surfaces business errors as non-retryable PayPalError", async () => {
    const err = await paypal.getOrder("DOES-NOT-EXIST-123").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err).toMatchObject({ status: 404, retryable: false });
  }, 30_000);
});
