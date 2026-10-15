import { SandboxOnboardingResult } from "@tranche/contracts";
import { describe, expect, it, vi } from "vitest";
import { onboardingEvidence, parseReferral } from "./onboarding";
import { SandboxClient, type SandboxRequestAccounting } from "./sandbox-client";

describe("referral response through persisted recovery transport", () => {
  it.each([`${"A".repeat(128)}==`, "Ab+c/d=="])(
    "preserves a documented Base64 referral ID and encodes its read path",
    async (referralId) => {
      const body = {
        links: [
          {
            rel: "self",
            href: `https://api-m.sandbox.paypal.com/v2/customer/partner-referrals/${encodeURIComponent(referralId)}`,
            method: "GET",
          },
          {
            rel: "action_url",
            href: "https://www.sandbox.paypal.com/consent?token=FAKE",
            method: "GET",
          },
        ],
      };
      const parsed = parseReferral(body);
      const stored = SandboxOnboardingResult.parse({
        referralId: parsed.referralId,
        evidence: onboardingEvidence("consent_required"),
      });
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json({
            access_token: "FAKE_TOKEN",
            token_type: "Bearer",
            expires_in: 3600,
          }),
        )
        .mockResolvedValueOnce(Response.json(body));
      const accounting = {
        reserve: vi.fn<SandboxRequestAccounting["reserve"]>(async () => "fake-attempt"),
        finish: vi.fn(async () => {}),
      };
      const client = new SandboxClient(
        { environment: "sandbox", clientId: "FAKE_CLIENT", clientSecret: "FAKE_SECRET" },
        accounting,
        fetcher,
      );
      const recovered = await client.request(
        {
          method: "GET",
          path: `/v2/customer/partner-referrals/${encodeURIComponent(stored.referralId ?? "")}`,
        },
        { recovery: true },
      );
      expect(parseReferral(recovered).referralId).toBe(referralId);
      expect(fetcher.mock.calls[1]?.[0]).toBe(body.links[0]?.href);
      expect(accounting.reserve.mock.calls.map(([kind]) => kind)).toEqual(["oauth", "recovery"]);
    },
  );
  it("accepts an unescaped padded referral link", () => {
    expect(
      parseReferral({
        links: [
          {
            rel: "self",
            href: "https://api-m.sandbox.paypal.com/v2/customer/partner-referrals/Ab+c/d==",
          },
          { rel: "action_url", href: "https://www.sandbox.paypal.com/consent?token=FAKE" },
        ],
      }).referralId,
    ).toBe("Ab+c/d==");
  });
  it.each([
    "/v2/customer/partner-referrals/%2E%2E",
    "/v2/customer/partner-referrals/FAKE%3Ftoken%3Dsecret",
    "/v2/customer/partner-referrals/FAKE%252FREF",
    "/v2/customer/partner-referrals/FAKE%",
    "/v2/checkout/orders/FAKE%3D",
  ])("rejects unsafe or unrelated encoded paths before authentication", async (path) => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new SandboxClient(
      { environment: "sandbox", clientId: "FAKE_CLIENT", clientSecret: "FAKE_SECRET" },
      { reserve: vi.fn(), finish: vi.fn() },
      fetcher,
    );
    await expect(client.request({ method: "GET", path })).rejects.toThrow("sandbox_destination");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
