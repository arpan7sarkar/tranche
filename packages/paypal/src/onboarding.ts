import { randomUUID } from "node:crypto";
import {
  PayPalIntegrationResponse,
  PayPalReferralId,
  PayPalReferralResponse,
  SandboxOnboardingContext,
  type SandboxOnboardingEvidence,
  SandboxOnboardingInput,
  SandboxOperationSpec,
  type SandboxOutcome,
} from "@tranche/contracts";
import { type SandboxRequest, SandboxTransportError } from "./client";

export function onboardingRequest(context: SandboxOnboardingContext): SandboxRequest {
  const c = SandboxOnboardingContext.parse(context);
  return {
    method: "POST",
    path: "/v2/customer/partner-referrals",
    partner: c.partner,
    body: {
      tracking_id: c.trackingId,
      operations: [
        {
          operation: "API_INTEGRATION",
          api_integration_preference: {
            rest_api_integration: {
              integration_method: "PAYPAL",
              integration_type: "THIRD_PARTY",
              third_party_details: { features: c.features },
            },
          },
        },
      ],
      products: [c.product],
      legal_consents: [{ type: "SHARE_DATA_CONSENT", granted: c.shareDataConsent }],
    },
  };
}

export function onboardingSpec(input: unknown): SandboxOperationSpec {
  const { context, recoveryCalls } = SandboxOnboardingInput.parse(input);
  return SandboxOperationSpec.parse({
    version: 1,
    kind: "onboard_seller",
    currency: "USD",
    sender: "platform",
    recipients: [{ alias: context.seller, cents: 0 }],
    feeBoundCents: 0,
    commitmentId: randomUUID(),
    resourceKey: randomUUID(),
    recoveryCalls,
    onboarding: context,
    request: onboardingRequest(context),
  });
}

export function onboardingStatusRequest(context: SandboxOnboardingContext): SandboxRequest {
  const c = SandboxOnboardingContext.parse(context);
  return {
    method: "GET",
    partner: c.partner,
    path: `/v1/customer/partners/${c.platformMerchantId}/merchant-integrations/${c.sellerMerchantId}`,
  };
}

export function onboardingEvidence(
  reason: SandboxOnboardingEvidence["reason"],
): SandboxOnboardingEvidence {
  return {
    status: reason === "consent_required" ? "waiting_for_consent" : "inconclusive",
    reason,
    merchantMatched: false,
    platformConnected: false,
    permissionsGranted: false,
    paymentsReceivable: null,
    primaryEmailConfirmed: null,
    productActive: false,
    missingScopes: [],
  };
}

export function parseReferral(body: unknown): { referralId: string; browserUrl: string } {
  const parsed = PayPalReferralResponse.parse(body);
  const self = parsed.links.filter((l) => l.rel === "self");
  const action = parsed.links.filter((l) => l.rel === "action_url");
  if (self.length !== 1 || action.length !== 1) throw new Error("referral_links");
  const selfUrl = new URL(self[0]?.href ?? "");
  const browser = new URL(action[0]?.href ?? "");
  const match = /^\/v2\/customer\/partner-referrals\/(.{1,765})$/.exec(selfUrl.pathname);
  if (
    !["https://api-m.sandbox.paypal.com", "https://api.sandbox.paypal.com"].includes(
      selfUrl.origin,
    ) ||
    selfUrl.username ||
    selfUrl.password ||
    selfUrl.search ||
    selfUrl.hash ||
    !match ||
    (self[0]?.method && self[0].method !== "GET") ||
    browser.protocol !== "https:" ||
    browser.username ||
    browser.password ||
    browser.port ||
    !["www.sandbox.paypal.com", "sandbox.paypal.com"].includes(browser.hostname) ||
    (action[0]?.method && action[0].method !== "GET")
  )
    throw new Error("referral_destination");
  const referralId = PayPalReferralId.parse(decodeURIComponent(match[1] as string));
  return { referralId, browserUrl: browser.href };
}

export function verifyReferralRecovery(
  body: unknown,
  context: SandboxOnboardingContext,
  expectedReferralId: string,
): { referralId: string; browserUrl: string } {
  const response = body as {
    partner_referral_id?: unknown;
    referral_data?: { tracking_id?: unknown };
    submitter_client_id?: unknown;
  } | null;
  const referral = parseReferral(body);
  if (
    referral.referralId !== expectedReferralId ||
    response?.partner_referral_id !== expectedReferralId ||
    response?.referral_data?.tracking_id !== context.trackingId ||
    response.submitter_client_id !== context.platformClientId
  )
    throw new Error("referral_recovery_mismatch");
  return referral;
}

export function verifyOnboarding(
  body: unknown,
  context: SandboxOnboardingContext,
): SandboxOnboardingEvidence {
  const result = PayPalIntegrationResponse.safeParse(body);
  if (!result.success) return onboardingEvidence("malformed_response");
  const data = result.data;
  if (data.merchant_id !== context.sellerMerchantId || data.tracking_id !== context.trackingId)
    return onboardingEvidence("identity_mismatch");
  const grants = (data.oauth_integrations ?? [])
    .filter((i) => i.integration_type === "OAUTH_THIRD_PARTY" && i.integration_method === "PAYPAL")
    .flatMap((i) => i.oauth_third_party ?? [])
    .filter((g) => g.partner_client_id === context.platformClientId);
  // Require one integration grant to cover the requested scopes.
  const grant = grants.find((g) => context.requiredScopes.every((s) => g.scopes.includes(s)));
  const scopes = grant?.scopes ?? grants[0]?.scopes ?? [];
  const missingScopes = context.requiredScopes.filter((s) => !scopes.includes(s));
  const productActive = data.products.some(
    (p) =>
      (p.name === context.product ||
        (context.product === "PPCP" && ["PPCP_STANDARD", "PPCP_CUSTOM"].includes(p.name))) &&
      (p.status === "ACTIVE" || (p.status === undefined && p.vetting_status === "SUBSCRIBED")) &&
      (p.vetting_status === undefined || p.vetting_status === "SUBSCRIBED"),
  );
  const reason = !grant
    ? "missing_permissions"
    : !data.payments_receivable || !data.primary_email_confirmed
      ? "payment_readiness"
      : !productActive
        ? "product_inactive"
        : "ready";
  return {
    status: reason === "ready" ? "consent_verified" : "readiness_incomplete",
    reason,
    merchantMatched: true,
    platformConnected: grants.length > 0,
    permissionsGranted: Boolean(grant),
    paymentsReceivable: data.payments_receivable,
    primaryEmailConfirmed: data.primary_email_confirmed,
    productActive,
    missingScopes,
  };
}

export function onboardingFailure(error: unknown): SandboxOutcome {
  const reason =
    error instanceof SandboxTransportError
      ? error.code === "response"
        ? "malformed_response"
        : error.status === 401 || error.status === 403
          ? "permission_denied"
          : error.status === 400 || error.status === 422
            ? "request_rejected"
            : error.status === 404
              ? "not_found"
              : "provider_unavailable"
      : "malformed_response";
  return { state: "inconclusive", onboarding: { evidence: onboardingEvidence(reason) } };
}
