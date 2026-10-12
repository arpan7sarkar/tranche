import { z } from "zod";
import { PayPalMerchantId, PayPalOpaqueId, SandboxOnboardingContext } from "./sandbox-onboarding";

export const SandboxPaymentPath = z.enum(["authorization_capture", "delayed_disbursement"]);
export const SandboxPaymentStage = z.enum(["create_order", "authorize_order", "capture_order"]);
export const SandboxCheckout = z
  .strictObject({
    returnUrl: z.url().max(2048),
    cancelUrl: z.url().max(2048),
  })
  .superRefine((c, ctx) => {
    if (!URL.canParse(c.returnUrl) || !URL.canParse(c.cancelUrl)) {
      ctx.addIssue({ code: "custom", message: "Invalid sandbox checkout destinations" });
      return;
    }
    const returned = new URL(c.returnUrl);
    const cancelled = new URL(c.cancelUrl);
    const safe = (url: URL) =>
      (url.protocol === "https:" ||
        (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash;
    if (
      !safe(returned) ||
      !safe(cancelled) ||
      returned.origin !== cancelled.origin ||
      returned.pathname !== "/sandbox/checkout/return" ||
      cancelled.pathname !== "/sandbox/checkout/cancel"
    )
      ctx.addIssue({ code: "custom", message: "Invalid sandbox checkout destinations" });
  });
export const SandboxPaymentContext = z
  .strictObject({
    path: z.literal("authorization_capture"),
    seller: SandboxOnboardingContext,
    buyerMerchantId: PayPalMerchantId,
    buyerMappingVersion: z.number().int().positive(),
    principalCents: z.number().int().min(1).max(100),
    feeBounds: z.strictObject({
      create_order: z.number().int().min(0).max(100),
      authorize_order: z.number().int().min(0).max(100),
      capture_order: z.number().int().min(0).max(100),
    }),
    executeUntil: z.iso.datetime(),
    recoverUntil: z.iso.datetime(),
    recoveryCalls: z.number().int().min(2).max(4),
    checkout: SandboxCheckout.optional(),
  })
  .superRefine((c, ctx) => {
    if (
      c.principalCents + Object.values(c.feeBounds).reduce((a, b) => a + b, 0) > 100 ||
      [c.seller.platformMerchantId, c.seller.sellerMerchantId].includes(c.buyerMerchantId) ||
      !c.seller.requiredScopes.includes(
        "https://uri.paypal.com/services/payments/payment/authcapture",
      ) ||
      Date.parse(c.recoverUntil) < Date.parse(c.executeUntil)
    ) {
      ctx.addIssue({ code: "custom", message: "Invalid payment context" });
    }
  });
export type SandboxPaymentContext = z.infer<typeof SandboxPaymentContext>;
export const SandboxBuyerChangeInput = z.strictObject({
  buyerMerchantId: PayPalMerchantId,
  buyerMappingVersion: z.number().int().positive(),
});
export const SandboxBuyerChangeSummary = z.strictObject({
  id: z.uuid(),
  operationId: z.uuid(),
  approvalHash: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(["awaiting_approval", "approved", "applied"]),
  fromBuyerMappingVersion: z.number().int().positive(),
  toBuyerMappingVersion: z.number().int().positive(),
  principalCents: z.number().int().min(1).max(100),
  additionalCalls: z.literal(4),
  executeUntil: z.iso.datetime(),
  recoverUntil: z.iso.datetime(),
});
export const SandboxPaymentSpec = z.strictObject({
  context: SandboxPaymentContext,
  stage: SandboxPaymentStage,
  orderId: PayPalOpaqueId.optional(),
  authorizationId: PayPalOpaqueId.optional(),
});
export type SandboxPaymentSpec = z.infer<typeof SandboxPaymentSpec>;
export const SandboxPaymentEvidence = z.enum([
  "order_created",
  "buyer_approved",
  "authorized",
  "captured_immediate",
  "pending",
  "inconclusive",
]);
export const SandboxPaymentResult = z.strictObject({
  evidence: SandboxPaymentEvidence,
  orderId: PayPalOpaqueId.optional(),
  authorizationId: PayPalOpaqueId.optional(),
  captureId: PayPalOpaqueId.optional(),
  artifactKey: z.uuid().optional(),
  providerExpiresAt: z.iso.datetime().optional(),
});
export type SandboxPaymentResult = z.infer<typeof SandboxPaymentResult>;
export const SandboxAssertionContext = z.strictObject({
  platformClientId: PayPalOpaqueId,
  sellerMerchantId: PayPalMerchantId,
});
export const SandboxPaymentApproval = z.strictObject({
  checkout: SandboxCheckout.optional(),
  path: z.literal("authorization_capture"),
  buyerMappingVersion: z.number().int().positive(),
  sellerMappingVersion: z.number().int().positive(),
  executeUntil: z.iso.datetime(),
  recoverUntil: z.iso.datetime(),
  lifecycleCalls: z.number().int().positive().max(50),
  totalFeeBoundCents: z.number().int().min(0).max(100),
});
export function paymentStageCalls(stage: z.infer<typeof SandboxPaymentStage>, n: number): number {
  return { create_order: 3, authorize_order: 5, capture_order: 6 }[stage] + 2 * n;
}
export function paymentTotalCalls(c: SandboxPaymentContext): number {
  return 14 + 6 * c.recoveryCalls;
}
export function paymentApproval(c: SandboxPaymentContext) {
  return {
    ...(c.checkout ? { checkout: c.checkout } : {}),
    path: c.path,
    buyerMappingVersion: c.buyerMappingVersion,
    sellerMappingVersion: c.seller.mappingVersion,
    executeUntil: c.executeUntil,
    recoverUntil: c.recoverUntil,
    lifecycleCalls: paymentTotalCalls(c),
    totalFeeBoundCents: Object.values(c.feeBounds).reduce((a, b) => a + b, 0),
  };
}
