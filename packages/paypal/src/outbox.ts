import type { PayPal } from "./client";

export const PAYPAL_OUTBOX_KINDS = [
  "paypal.create_order",
  "paypal.place_hold",
  "paypal.renew_hold",
  "paypal.release_hold",
  "paypal.void_hold",
  "paypal.send_payouts",
  "paypal.submit_dispute_evidence",
] as const;
export type PayPalOutboxKind = (typeof PAYPAL_OUTBOX_KINDS)[number];

type Input<K extends keyof PayPal> = PayPal[K] extends (input: infer I) => unknown ? I : never;

export async function runPayPalOutbox(
  paypal: PayPal,
  kind: PayPalOutboxKind,
  request: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (kind) {
    case "paypal.create_order":
      return paypal.createFundingOrder(request as Input<"createFundingOrder">);
    case "paypal.place_hold":
      return paypal.placeHold(request as Input<"placeHold">);
    case "paypal.renew_hold":
      return paypal.renewHold(request as Input<"renewHold">);
    case "paypal.release_hold":
      return paypal.releaseHold(request as Input<"releaseHold">);
    case "paypal.void_hold":
      await paypal.voidHold(request as Input<"voidHold">);
      return {};
    case "paypal.send_payouts":
      return paypal.sendPayouts(request as Input<"sendPayouts">);
    case "paypal.submit_dispute_evidence":
      await paypal.submitDisputeEvidence(request as Input<"submitDisputeEvidence">);
      return {};
  }
}
