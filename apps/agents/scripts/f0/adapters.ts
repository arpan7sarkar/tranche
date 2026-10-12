import type { SandboxOperationSpec, SandboxOutcome } from "@tranche/contracts";
import { type SandboxStore, sandboxPayloadHash } from "@tranche/db";
import {
  onboardingEvidence,
  onboardingFailure,
  onboardingRequest,
  onboardingStatusRequest,
  parseReferral,
  verifyOnboarding,
} from "@tranche/paypal";
import type { PrivateSandboxArtifacts } from "./private-artifacts";
import type { SandboxAdapter } from "./runner";

export function onboardingAdapter(
  store: SandboxStore,
  artifacts: PrivateSandboxArtifacts,
  platformClientId: string,
): SandboxAdapter {
  function context(spec: SandboxOperationSpec) {
    const c = spec.onboarding;
    if (
      !c ||
      spec.kind !== "onboard_seller" ||
      c.platformClientId !== platformClientId ||
      spec.sender !== "platform" ||
      spec.recipients.length !== 1 ||
      spec.recipients[0]?.alias !== c.seller ||
      spec.recipients[0]?.cents !== 0 ||
      spec.feeBoundCents !== 0 ||
      sandboxPayloadHash(spec.request) !== sandboxPayloadHash(onboardingRequest(c))
    )
      throw new Error("onboarding_configuration");
    return c;
  }
  async function referral(body: unknown, spec: SandboxOperationSpec): Promise<SandboxOutcome> {
    const c = context(spec);
    const result = parseReferral(body);
    const evidence = onboardingEvidence("consent_required");
    try {
      const artifactKey = await artifacts.saveBrowserUrl(result.browserUrl);
      return {
        state: "waiting_for_browser",
        expectedAlias: c.seller,
        artifactKey,
        onboarding: { referralId: result.referralId, artifactKey, evidence },
      };
    } catch {
      return { state: "inconclusive", onboarding: { referralId: result.referralId, evidence } };
    }
  }
  return {
    kind: "onboard_seller",
    validate: (spec) => {
      context(spec);
    },
    prepare: (op) => {
      if (Date.parse(context(op.spec).checkUntil) <= Date.now())
        throw new Error("onboarding_deadline");
      return op.spec.request;
    },
    interpret: (body, op) => referral(body, op.spec),
    failure: onboardingFailure,
    recover: async (op, read, options) => {
      const c = context(op.spec);
      if (Date.parse(c.checkUntil) <= Date.now())
        return {
          state: "inconclusive",
          onboarding: { evidence: onboardingEvidence("deadline_reached") },
        };
      const resource = await store.onboardingResource(op.id);
      if (options?.refreshConsent) {
        if (!resource.referralId)
          return {
            state: "inconclusive",
            onboarding: { evidence: onboardingEvidence("not_found") },
          };
        const body = await read({
          method: "GET",
          partner: c.partner,
          path: `/v2/customer/partner-referrals/${encodeURIComponent(resource.referralId)}`,
        });
        if (parseReferral(body).referralId !== resource.referralId)
          throw new Error("referral_mismatch");
        return referral(body, op.spec);
      }
      const evidence = verifyOnboarding(await read(onboardingStatusRequest(c)), c);
      if (evidence.status === "consent_verified")
        return { state: "succeeded", onboarding: { evidence } };
      if (evidence.reason === "identity_mismatch" || evidence.reason === "malformed_response")
        return { state: "inconclusive", onboarding: { evidence } };
      if (!resource.artifactKey && resource.referralId) {
        const body = await read({
          method: "GET",
          partner: c.partner,
          path: `/v2/customer/partner-referrals/${encodeURIComponent(resource.referralId)}`,
        });
        if (parseReferral(body).referralId !== resource.referralId)
          throw new Error("referral_mismatch");
        return referral(body, op.spec);
      }
      if (resource.artifactKey)
        return {
          state: "waiting_for_browser",
          expectedAlias: c.seller,
          artifactKey: resource.artifactKey,
          onboarding: { artifactKey: resource.artifactKey, evidence },
        };
      return { state: "inconclusive", onboarding: { evidence } };
    },
  };
}
