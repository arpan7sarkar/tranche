import { describe, expect, it } from "vitest";
import {
  onboardingApprovalSummary,
  SandboxOnboardingContext,
  SandboxOnboardingInput,
} from "./sandbox-onboarding";

const input = {
  seller: "seller-a",
  platformMerchantId: "PLATFORM00001",
  sellerMerchantId: "SELLERA000001",
  platformClientId: "FAKE_CLIENT",
  mappingVersion: 1,
  trackingId: "test-tracking",
  partner: { attributionId: "FAKE_BN" },
  product: "EXPRESS_CHECKOUT",
  features: ["PAYMENT"],
  requiredScopes: ["https://uri.paypal.com/services/payments/payment/authcapture"],
  shareDataConsent: true,
  checkUntil: "2026-10-13T00:00:00.000Z",
};
describe("sandbox onboarding contracts", () => {
  it("accepts a narrow explicit non-payment configuration", () => {
    expect(SandboxOnboardingInput.safeParse({ context: input, recoveryCalls: 3 }).success).toBe(
      true,
    );
  });
  it.each([
    { seller: "buyer" },
    { sellerMerchantId: input.platformMerchantId },
    { platformMerchantId: "../platform" },
    { product: "UNKNOWN" },
    { features: ["PAYMENT", "PAYMENT"] },
    { features: ["VAULT"] },
    { features: ["PAYMENT", "REFUND"] },
    { requiredScopes: ["https://evil.test/scope"] },
    { requiredScopes: [] },
    { shareDataConsent: false },
    { mappingVersion: 0 },
    { secret: "FAKE_SECRET" },
    { checkUntil: "tomorrow" },
    { partner: { attributionId: "x\r\nAuthorization: evil" } },
    { partner: { attributionId: "FAKE_BN", Authorization: "evil" } },
  ])("rejects invalid or excessive configuration %j", (change) => {
    expect(SandboxOnboardingContext.safeParse({ ...input, ...change }).success).toBe(false);
  });
  it("approval summaries show permissions without private identifiers", () => {
    const summary = onboardingApprovalSummary(SandboxOnboardingContext.parse(input));
    expect(summary.features).toEqual(["PAYMENT"]);
    expect(JSON.stringify(summary)).not.toMatch(
      /PLATFORM00001|SELLERA000001|FAKE_CLIENT|FAKE_BN|test-tracking/,
    );
  });
});
