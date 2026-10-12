import { z } from "zod";

export const SandboxSeller = z.enum(["seller-a", "seller-b"]);
export const PayPalMerchantId = z.string().regex(/^[A-Z0-9]{13}$/);
export const PayPalOpaqueId = z.string().regex(/^[A-Za-z0-9_-]{1,127}$/);
export const PayPalReferralId = z
  .string()
  .regex(/^(?:[A-Za-z0-9+/=]{1,255}|[A-Za-z0-9_-]{1,127})$/);
export const SandboxPartnerContext = z.strictObject({
  attributionId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
});
export const OnboardingScope = z.enum([
  "https://uri.paypal.com/services/payments/realtimepayment",
  "https://uri.paypal.com/services/payments/payment/authcapture",
  "https://uri.paypal.com/services/payments/refund",
]);
export const SandboxOnboardingContext = z
  .strictObject({
    seller: SandboxSeller,
    platformMerchantId: PayPalMerchantId,
    sellerMerchantId: PayPalMerchantId,
    platformClientId: PayPalOpaqueId,
    mappingVersion: z.number().int().positive(),
    trackingId: PayPalOpaqueId,
    partner: SandboxPartnerContext,
    product: z.enum(["EXPRESS_CHECKOUT", "PPCP"]),
    features: z
      .array(z.enum(["PAYMENT", "REFUND"]))
      .min(1)
      .max(2),
    requiredScopes: z.array(OnboardingScope).min(1).max(3),
    shareDataConsent: z.literal(true),
    checkUntil: z.iso.datetime(),
  })
  .superRefine((input, ctx) => {
    const paymentScopes = input.requiredScopes.filter((s) => !s.endsWith("/refund"));
    if (
      input.platformMerchantId === input.sellerMerchantId ||
      new Set(input.features).size !== input.features.length ||
      new Set(input.requiredScopes).size !== input.requiredScopes.length ||
      !input.features.includes("PAYMENT") ||
      paymentScopes.length === 0 ||
      input.features.includes("REFUND") !== input.requiredScopes.some((s) => s.endsWith("/refund"))
    )
      ctx.addIssue({ code: "custom", message: "Invalid onboarding configuration" });
  });
export type SandboxOnboardingContext = z.infer<typeof SandboxOnboardingContext>;

export const SandboxOnboardingInput = z.strictObject({
  context: SandboxOnboardingContext,
  recoveryCalls: z.number().int().min(1).max(10),
});

export const SandboxOnboardingApproval = z.strictObject({
  seller: SandboxOnboardingContext.shape.seller,
  mappingVersion: SandboxOnboardingContext.shape.mappingVersion,
  product: SandboxOnboardingContext.shape.product,
  features: SandboxOnboardingContext.shape.features,
  requiredScopes: SandboxOnboardingContext.shape.requiredScopes,
  checkUntil: SandboxOnboardingContext.shape.checkUntil,
});
export function onboardingApprovalSummary(context: SandboxOnboardingContext) {
  return SandboxOnboardingApproval.parse({
    seller: context.seller,
    mappingVersion: context.mappingVersion,
    product: context.product,
    features: context.features,
    requiredScopes: context.requiredScopes,
    checkUntil: context.checkUntil,
  });
}

export const SandboxOnboardingEvidence = z.strictObject({
  status: z.enum([
    "waiting_for_consent",
    "consent_verified",
    "readiness_incomplete",
    "inconclusive",
  ]),
  reason: z.enum([
    "consent_required",
    "ready",
    "missing_permissions",
    "payment_readiness",
    "product_inactive",
    "identity_mismatch",
    "permission_denied",
    "request_rejected",
    "not_found",
    "malformed_response",
    "provider_unavailable",
    "deadline_reached",
  ]),
  merchantMatched: z.boolean(),
  platformConnected: z.boolean(),
  permissionsGranted: z.boolean(),
  paymentsReceivable: z.boolean().nullable(),
  primaryEmailConfirmed: z.boolean().nullable(),
  productActive: z.boolean(),
  missingScopes: z.array(OnboardingScope),
});
export type SandboxOnboardingEvidence = z.infer<typeof SandboxOnboardingEvidence>;
export const SandboxOnboardingResult = z.strictObject({
  referralId: PayPalReferralId.optional(),
  artifactKey: z.uuid().optional(),
  evidence: SandboxOnboardingEvidence,
});
export type SandboxOnboardingResult = z.infer<typeof SandboxOnboardingResult>;

export const PayPalReferralResponse = z.object({
  links: z
    .array(z.object({ rel: z.string(), href: z.string(), method: z.string().optional() }))
    .max(20),
});
export const PayPalIntegrationResponse = z.object({
  merchant_id: z.string(),
  tracking_id: z.string(),
  payments_receivable: z.boolean(),
  primary_email_confirmed: z.boolean(),
  products: z
    .array(
      z.object({
        name: z.string(),
        status: z.string().optional(),
        vetting_status: z.string().optional(),
      }),
    )
    .max(20),
  oauth_integrations: z
    .array(
      z.object({
        integration_type: z.string(),
        integration_method: z.string(),
        oauth_third_party: z
          .array(z.object({ partner_client_id: z.string(), scopes: z.array(z.string()).max(100) }))
          .max(20)
          .optional(),
      }),
    )
    .max(20)
    .optional(),
});
