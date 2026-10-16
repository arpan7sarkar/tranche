import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { SandboxOperationSpec } from "@tranche/contracts";
import { SandboxStore } from "@tranche/db";
import { openSandboxTestDb, sandboxTestOptions } from "@tranche/db/testing";
import { onboardingSpec, paymentSpec } from "@tranche/paypal";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { onboardingAdapter } from "./adapters";
import { sandboxCli } from "./index";
import { paymentAdapters } from "./payment-adapters";
import { PrivateSandboxArtifacts, sandboxBrowserUrl } from "./private-artifacts";
import { type SandboxAdapter, SandboxRunner } from "./runner";

const credentials = {
  environment: "sandbox",
  clientId: "FAKE_CLIENT",
  clientSecret: "FAKE_SECRET",
};

async function removeTestDirectory(directory: string): Promise<void> {
  const target = resolve(directory);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("tranche-p2-")) {
    throw new Error("unexpected_test_directory");
  }
  await rm(target, { recursive: true });
}
function spec(change: Partial<SandboxOperationSpec> = {}): SandboxOperationSpec {
  return {
    version: 1,
    kind: "create_order",
    currency: "USD",
    sender: "buyer",
    recipients: [{ alias: "seller-a", cents: 10 }],
    feeBoundCents: 1,
    commitmentId: randomUUID(),
    resourceKey: randomUUID(),
    recoveryCalls: 2,
    request: { method: "POST", path: "/v2/checkout/orders", body: { fixture: "PRIVATE_PAYLOAD" } },
    ...change,
  };
}
const token = () =>
  Response.json({ access_token: "FAKE_TOKEN", token_type: "Bearer", expires_in: 3600 });
function adapter(change: Partial<SandboxAdapter> = {}): SandboxAdapter {
  return {
    kind: "create_order",
    validate: () => {},
    prepare: (op) => op.spec.request,
    interpret: async () => ({ state: "succeeded" }),
    recover: async (_op, read) => {
      await read({ method: "GET", path: "/v2/checkout/orders/FAKE" });
      return { state: "succeeded" };
    },
    ...change,
  };
}

describe("private browser artifacts", () => {
  it.each([
    "https://www.paypal.com/checkout",
    "http://www.sandbox.paypal.com/checkout",
    "https://www.sandbox.paypal.com.evil.example",
    "https://user:pass@www.sandbox.paypal.com",
  ])("rejects unsafe URL %s", (value) => {
    expect(() => sandboxBrowserUrl(value)).toThrow();
  });
  it("stores token links privately under opaque keys", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tranche-p2-artifacts-"));
    try {
      const artifacts = new PrivateSandboxArtifacts(directory);
      const url = "https://www.sandbox.paypal.com/checkoutnow?token=FAKE_PRIVATE";
      const key = await artifacts.saveBrowserUrl(url);
      expect(key).not.toContain("FAKE_PRIVATE");
      expect(await artifacts.readBrowserUrl(key)).toBe(url);
      await expect(artifacts.readBrowserUrl("../secret")).rejects.toThrow("artifact_key");
    } finally {
      await removeTestDirectory(directory);
    }
  });
});

const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl) sandboxTestOptions(testUrl);

describe.skipIf(!testUrl)("P2 disposable PostgreSQL runner integration", () => {
  let store: SandboxStore;
  const onboardingDirectories: string[] = [];
  beforeAll(async () => {
    store = new SandboxStore(await openSandboxTestDb(testUrl));
  });
  beforeEach(async () => {
    await store.db.$client.unsafe(
      "TRUNCATE sandbox_browser_wait, sandbox_attempt, sandbox_approval, sandbox_operation, sandbox_commitment, sandbox_run, sandbox_allocation CASCADE",
    );
  });
  afterAll(async () => {
    if (store) await store.db.$client.end();
    for (const directory of onboardingDirectories) await removeTestDirectory(directory);
  });

  async function prepared(input = spec()) {
    const runId = await store.start();
    const op = await store.prepare(runId, randomUUID(), input);
    return { runId, op };
  }
  async function approved(input = spec()) {
    const result = await prepared(input);
    await store.approve(result.op.id, result.op.payloadHash, 1);
    return result;
  }

  async function onboardingSetup(
    recoveryCalls = 4,
    product: "EXPRESS_CHECKOUT" | "PPCP" = "EXPRESS_CHECKOUT",
  ) {
    const context = {
      seller: "seller-a",
      platformMerchantId: "PLATFORM00001",
      sellerMerchantId: "SELLERA000001",
      platformClientId: credentials.clientId,
      mappingVersion: 1,
      trackingId: randomUUID(),
      partner: { attributionId: "FAKE_BN" },
      product,
      features: ["PAYMENT"],
      requiredScopes: ["https://uri.paypal.com/services/payments/payment/authcapture"],
      shareDataConsent: true,
      checkUntil: new Date(Date.now() + 3_600_000).toISOString(),
    };
    const directory = await mkdtemp(join(tmpdir(), "tranche-p2-onboarding-"));
    onboardingDirectories.push(directory);
    const artifacts = new PrivateSandboxArtifacts(directory);
    const referralBody = {
      links: [
        {
          rel: "self",
          href: "https://api-m.sandbox.paypal.com/v2/customer/partner-referrals/FAKE_REF",
          method: "GET",
        },
        {
          rel: "action_url",
          href: "https://www.sandbox.paypal.com/consent?token=PRIVATE_CONSENT",
          method: "GET",
        },
      ],
    };
    const statusBody = {
      merchant_id: context.sellerMerchantId,
      tracking_id: context.trackingId,
      payments_receivable: true,
      primary_email_confirmed: true,
      products: [{ name: context.product, status: "ACTIVE" }] as {
        name: string;
        status?: string;
        vetting_status?: string;
      }[],
      oauth_integrations: [
        {
          integration_type: "OAUTH_THIRD_PARTY",
          integration_method: "PAYPAL",
          oauth_third_party: [
            { partner_client_id: context.platformClientId, scopes: context.requiredScopes },
          ],
        },
      ],
    };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (String(url).endsWith("/token")) return token();
      if (init?.method === "POST" || String(url).includes("/partner-referrals/"))
        return Response.json(referralBody);
      return Response.json(statusBody);
    });
    const input = onboardingSpec({ context, recoveryCalls });
    const { runId, op } = await prepared(input);
    const adapter = onboardingAdapter(store, artifacts, credentials.clientId);
    const runner = new SandboxRunner(store, credentials, [adapter], fetcher);
    return {
      context,
      input,
      runId,
      op,
      artifacts,
      directory,
      referralBody,
      statusBody,
      fetcher,
      adapter,
      runner,
    };
  }

  it("P3 requires approval, persists referral and consent, then verifies counted status after restart", async () => {
    const x = await onboardingSetup();
    await x.runner.resume(x.op.id);
    expect(x.fetcher).not.toHaveBeenCalled();
    expect((await store.inspect(x.runId)).approvals[0]?.onboarding?.features).toEqual(["PAYMENT"]);
    await store.approve(x.op.id, x.op.payloadHash, 1);
    await x.runner.resume(x.op.id);
    expect((await store.operation(x.op.id)).state).toBe("waiting_for_browser");
    const resource = await store.onboardingResource(x.op.id);
    expect(resource.referralId).toBe("FAKE_REF");
    expect(await x.artifacts.readBrowserUrl(resource.artifactKey ?? "")).toContain(
      "PRIVATE_CONSENT",
    );
    expect((await store.report(x.runId)).allocation).toMatchObject({
      consumedCalls: 2,
      reservedCents: 0,
      committedCents: 0,
    });
    expect(JSON.stringify(await store.inspect(x.runId))).not.toMatch(
      /PRIVATE_CONSENT|PLATFORM00001|SELLERA000001|FAKE_CLIENT|FAKE_BN|FAKE_REF/,
    );
    const reopened = new SandboxStore(await openSandboxTestDb(testUrl));
    try {
      const runner = new SandboxRunner(
        reopened,
        credentials,
        [onboardingAdapter(reopened, x.artifacts, credentials.clientId)],
        x.fetcher,
      );
      await runner.resume(x.op.id);
      expect((await reopened.report(x.runId)).onboarding?.[0]?.evidence.status).toBe(
        "consent_verified",
      );
      expect((await reopened.operation(x.op.id)).state).toBe("succeeded");
      expect((await reopened.inspect(x.runId)).browserWaits[0]?.resolved).toBe(true);
      expect((await reopened.report(x.runId)).allocation).toMatchObject({
        consumedCalls: 4,
        heldCalls: 0,
        committedCents: 0,
      });
    } finally {
      await reopened.db.$client.end();
    }
    expect(
      x.fetcher.mock.calls.filter(
        ([, init]) =>
          init?.method === "POST" && init?.headers && "PayPal-Request-Id" in init.headers,
      ),
    ).toHaveLength(1);
  });

  it.each(["EXPRESS_CHECKOUT", "PPCP"] as const)(
    "P3 verifies subscribed PPCP products only for the approved PPCP request: %s",
    async (product) => {
      const x = await onboardingSetup(1, product);
      x.statusBody.products = [
        { name: "PPCP_CUSTOM", vetting_status: "SUBSCRIBED" },
        { name: "MOBILE_PAYMENT_ACCEPTANCE", status: "ACTIVE" },
        { name: "PPCP_STANDARD", vetting_status: "SUBSCRIBED" },
      ];
      await sandboxCli(["approve", x.op.id, x.op.payloadHash, "1"], store, x.runner);
      await sandboxCli(["resume", x.op.id], store, x.runner);
      await sandboxCli(["resume", x.op.id], store, x.runner);
      const ready = product === "PPCP";
      expect((await store.operation(x.op.id)).state).toBe(ready ? "succeeded" : "blocked");
      expect((await store.report(x.runId)).onboarding?.[0]?.evidence).toMatchObject({
        status: ready ? "consent_verified" : "readiness_incomplete",
        reason: ready ? "ready" : "product_inactive",
        merchantMatched: true,
        platformConnected: true,
        permissionsGranted: true,
        paymentsReceivable: true,
        primaryEmailConfirmed: true,
        productActive: ready,
      });
      expect((await store.report(x.runId)).allocation).toMatchObject({
        consumedCalls: 4,
        heldCalls: 0,
        reservedCents: 0,
        committedCents: 0,
      });
      const post = x.fetcher.mock.calls.filter(
        ([, init]) =>
          init?.method === "POST" && init?.body && !String(init.body).includes("grant_type"),
      );
      expect(post).toHaveLength(1);
      expect(JSON.parse(String(post[0]?.[1]?.body)).products).toEqual([product]);
    },
  );

  it("P3 prevents duplicate sellers or tracking IDs across runs and mapping changes", async () => {
    const x = await onboardingSetup();
    const runId = await store.start();
    for (const context of [
      { ...x.context, trackingId: randomUUID(), mappingVersion: 2 },
      { ...x.context, product: "PPCP", trackingId: randomUUID(), mappingVersion: 2 },
      { ...x.context, seller: "seller-b", sellerMerchantId: "SELLERB000001" },
    ])
      await expect(
        store.prepare(runId, randomUUID(), onboardingSpec({ context, recoveryCalls: 4 })),
      ).rejects.toThrow();
    expect((await store.report(runId)).operations).toHaveLength(0);
  });

  async function productMaintenance() {
    const x = await onboardingSetup(1);
    x.statusBody.products = [{ name: "PPCP_STANDARD", vetting_status: "SUBSCRIBED" }];
    await store.approve(x.op.id, x.op.payloadHash, 1);
    await x.runner.resume(x.op.id);
    await x.runner.resume(x.op.id);
    const file = join(x.directory, "product-maintenance.json");
    await writeFile(
      file,
      JSON.stringify({ kind: "onboarding_product", product: "PPCP", mappingVersion: 2 }),
    );
    const summary = (await sandboxCli(["maintenance", x.op.id, file], store, x.runner)) as {
      id: string;
      approvalHash: string;
    };
    return { ...x, summary };
  }

  it("releases an approved product-check reservation when onboarding expires", async () => {
    const x = await productMaintenance();
    await store.approveMaintenance(x.summary.id, x.summary.approvalHash);
    expect((await store.report(x.runId)).allocation.heldCalls).toBe(2);
    const requests = x.fetcher.mock.calls.length;
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(x.context.checkUntil) + 1);
    try {
      await expect(x.runner.resume(x.op.id)).rejects.toThrow("onboarding_recovery_limit");
      expect((await store.operation(x.op.id)).state).toBe("blocked");
      expect((await store.report(x.runId)).allocation.heldCalls).toBe(0);
      expect((await store.maintenanceRecord(x.summary.id)).state).toBe("failed");
      expect(x.fetcher).toHaveBeenCalledTimes(requests);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("P3 audits a separately approved existing product check without another referral or budget reset", async () => {
    const x = await productMaintenance();
    const before = (await store.report(x.runId)).allocation;
    await expect(x.runner.maintain(x.summary.id)).rejects.toThrow("maintenance_approval_required");
    await x.runner.resume(x.op.id);
    expect((await store.operation(x.op.id)).state).toBe("blocked");
    await sandboxCli(
      ["approve-maintenance", x.summary.id, x.summary.approvalHash],
      store,
      x.runner,
    );
    await sandboxCli(["apply-maintenance", x.summary.id], store, x.runner);
    expect((await store.operation(x.op.id)).spec).toEqual(x.input);
    expect((await store.operation(x.op.id)).attempts).toBe(1);
    expect((await store.operation(x.op.id)).recoveryReads).toBe(2);
    expect((await store.operation(x.op.id)).state).toBe("succeeded");
    expect((await store.inspect(x.runId)).maintenance).toMatchObject([
      { state: "applied", product: "PPCP", mappingVersion: 2 },
    ]);
    expect((await store.report(x.runId)).allocation).toMatchObject({
      consumedCalls: before.consumedCalls + 2,
      heldCalls: 0,
      reservedCents: 0,
      committedCents: 0,
    });
    const p = paymentSpec({
      path: "authorization_capture",
      seller: { ...x.context, product: "PPCP", mappingVersion: 2 },
      buyerMerchantId: "BUYER00000001",
      buyerMappingVersion: 1,
      principalCents: 1,
      feeBounds: { create_order: 0, authorize_order: 0, capture_order: 0 },
      executeUntil: new Date(Date.now() + 3600000).toISOString(),
      recoverUntil: new Date(Date.now() + 7200000).toISOString(),
      recoveryCalls: 2,
    });
    await expect(store.requirePaymentConsent(p)).resolves.toBeUndefined();
    if (!p.payment || !x.input.onboarding) throw new Error("fixture");
    await expect(
      store.requirePaymentConsent({
        ...p,
        payment: { ...p.payment, context: { ...p.payment.context, seller: x.input.onboarding } },
      }),
    ).rejects.toThrow("p3_consent_required");
    await expect(x.runner.maintain(x.summary.id)).rejects.toThrow();
    expect(
      x.fetcher.mock.calls.filter(([, init]) => String(init?.body).includes("tracking_id")),
    ).toHaveLength(1);
  });

  it.each(["wrong_hash", "exhausted", "tampered"])(
    "P3 rejects unsafe product maintenance approval: %s",
    async (failure) => {
      const x = await productMaintenance();
      if (failure === "exhausted")
        await store.db.$client`UPDATE sandbox_allocation SET consumed_calls = 49`;
      if (failure === "tampered")
        await store.db
          .$client`UPDATE sandbox_maintenance SET target_context = jsonb_set(target_context, '{mappingVersion}', '99') WHERE id = ${x.summary.id}`;
      const before = (await store.report(x.runId)).allocation;
      await expect(
        store.approveMaintenance(
          x.summary.id,
          failure === "wrong_hash" ? "0".repeat(64) : x.summary.approvalHash,
        ),
      ).rejects.toThrow();
      expect((await store.report(x.runId)).allocation).toEqual(before);
    },
  );

  it.each(["missing_scope", "inactive", "network"])(
    "P3 keeps failed product checks blocked without releasing or resetting budgets: %s",
    async (failure) => {
      const x = await productMaintenance();
      await store.approveMaintenance(x.summary.id, x.summary.approvalHash);
      if (failure === "missing_scope") x.statusBody.oauth_integrations = [];
      if (failure === "inactive") x.statusBody.products = [];
      if (failure === "network") x.fetcher.mockRejectedValue(new Error("network"));
      await expect(x.runner.maintain(x.summary.id)).rejects.toThrow();
      expect((await store.maintenanceRecord(x.summary.id)).state).toBe("failed");
      expect((await store.operation(x.op.id)).state).toBe("inconclusive");
      await expect(x.runner.maintain(x.summary.id)).rejects.toThrow();
      await expect(x.runner.resume(x.op.id)).rejects.toThrow(
        "maintenance_requires_dedicated_command",
      );
    },
  );

  it("P3 cannot finish maintenance without counted successful reads or reuse its approval", async () => {
    const x = await productMaintenance();
    await store.approveMaintenance(x.summary.id, x.summary.approvalHash);
    await expect(store.approveMaintenance(x.summary.id, x.summary.approvalHash)).rejects.toThrow();
    const claim = await store.beginMaintenance(x.summary.id);
    await expect(store.beginMaintenance(x.summary.id)).rejects.toThrow();
    await expect(store.finishMaintenance(claim, x.summary.id)).rejects.toThrow(
      "maintenance_read_required",
    );
    const oauth = await store.reserveClaimRequest(claim, "oauth");
    await store.finishRequest(oauth, true);
    await expect(store.reserveClaimRequest(claim, "oauth")).rejects.toThrow(
      "maintenance_call_limit",
    );
  });

  it("P3 invalidates approval when private context is changed", async () => {
    const x = await onboardingSetup();
    await store.approve(x.op.id, x.op.payloadHash, 1);
    await store.db
      .$client`UPDATE sandbox_operation SET spec = jsonb_set(spec, '{onboarding,mappingVersion}', '2') WHERE id = ${x.op.id}`;
    await expect(x.runner.resume(x.op.id)).rejects.toThrow("payload_changed");
    expect(x.fetcher).not.toHaveBeenCalled();
  });

  it("P3 rejects a different app or altered referral payload before network dispatch", async () => {
    const x = await onboardingSetup();
    await store.approve(x.op.id, x.op.payloadHash, 1);
    const runner = new SandboxRunner(
      store,
      credentials,
      [onboardingAdapter(store, x.artifacts, "OTHER_APP")],
      x.fetcher,
    );
    await expect(runner.resume(x.op.id)).rejects.toThrow("onboarding_configuration");
    expect(() =>
      x.adapter.validate({
        ...x.input,
        request: { ...x.input.request, body: { tracking_id: "other" } },
      }),
    ).toThrow("onboarding_configuration");
    expect(x.fetcher).not.toHaveBeenCalled();
  });

  it.each([
    "wrong_seller",
    "wrong_app",
    "missing_permissions",
    "email",
    "payment",
    "product",
    "malformed",
  ])("P3 never marks an incomplete or wrong integration ready: %s", async (failure) => {
    const x = await onboardingSetup();
    await store.approve(x.op.id, x.op.payloadHash, 1);
    await x.runner.resume(x.op.id);
    if (failure === "wrong_seller") x.statusBody.merchant_id = "SELLERB000001";
    const grant = x.statusBody.oauth_integrations[0]?.oauth_third_party[0];
    const product = x.statusBody.products[0];
    if (!grant || !product) throw new Error("missing_test_fixture");
    if (failure === "wrong_app") grant.partner_client_id = "OTHER_APP";
    if (failure === "missing_permissions") grant.scopes = [];
    if (failure === "email") x.statusBody.primary_email_confirmed = false;
    if (failure === "payment") x.statusBody.payments_receivable = false;
    if (failure === "product") product.status = "PENDING";
    if (failure === "malformed")
      x.fetcher.mockImplementation(async (url) =>
        String(url).endsWith("/token") ? token() : Response.json({ invalid: true }),
      );
    await x.runner.resume(x.op.id);
    expect((await store.operation(x.op.id)).state).not.toBe("succeeded");
    expect((await store.report(x.runId)).onboarding?.[0]?.evidence.status).not.toBe(
      "consent_verified",
    );
  });

  it("P3 stores safe permission-denied evidence without response details", async () => {
    const x = await onboardingSetup();
    await store.approve(x.op.id, x.op.payloadHash, 1);
    x.fetcher.mockImplementation(async (url) =>
      String(url).endsWith("/token") ? token() : new Response("PRIVATE_DENIAL", { status: 403 }),
    );
    await x.runner.resume(x.op.id);
    const report = await store.report(x.runId);
    expect(report.onboarding?.[0]?.evidence.reason).toBe("permission_denied");
    expect(JSON.stringify(report)).not.toContain("PRIVATE_DENIAL");
    expect(x.fetcher).toHaveBeenCalledTimes(2);
  });

  it("P3 recovers a timed-out referral only through reads and never sends a replacement POST", async () => {
    const x = await onboardingSetup();
    await store.approve(x.op.id, x.op.payloadHash, 1);
    x.fetcher.mockImplementation(async (url, init) => {
      if (String(url).endsWith("/token")) return token();
      if (init?.method === "POST") throw new Error("PRIVATE_TIMEOUT");
      return Response.json(x.statusBody);
    });
    await x.runner.resume(x.op.id);
    expect((await store.operation(x.op.id)).state).toBe("inconclusive");
    expect((await store.onboardingResource(x.op.id)).referralId).toBeNull();
    await x.runner.resume(x.op.id);
    expect((await store.operation(x.op.id)).state).toBe("succeeded");
    expect((await store.operation(x.op.id)).attempts).toBe(1);
    expect(
      x.fetcher.mock.calls.filter(
        ([, init]) => init?.method === "POST" && String(init?.body).includes("tracking_id"),
      ),
    ).toHaveLength(1);
  });

  it("P3 restores a lost pre-consent referral with an approved, matching provider GET", async () => {
    const x = await onboardingSetup(6);
    await store.approve(x.op.id, x.op.payloadHash, 1);
    x.fetcher.mockImplementation(async (url, init) => {
      if (String(url).endsWith("/token")) return token();
      if (init?.method === "POST") throw new Error("PRIVATE_TIMEOUT");
      if (String(url).endsWith("/partner-referrals/FAKE_REF"))
        return Response.json({
          ...x.referralBody,
          partner_referral_id: "FAKE_REF",
          submitter_client_id: x.context.platformClientId,
          referral_data: { tracking_id: x.context.trackingId },
        });
      return Response.json({ name: "NOT_FOUND" }, { status: 404 });
    });
    await x.runner.resume(x.op.id);
    await x.runner.resume(x.op.id);
    expect((await store.onboardingResource(x.op.id)).referralId).toBeNull();
    const anotherRun = await store.start();
    await expect(
      store.prepare(
        anotherRun,
        randomUUID(),
        onboardingSpec({
          context: { ...x.context, mappingVersion: 2, trackingId: randomUUID() },
          recoveryCalls: 2,
        }),
      ),
    ).rejects.toThrow();
    const file = join(x.directory, "recovery.json");
    await writeFile(file, JSON.stringify({ referralId: "FAKE_REF" }));
    const proposal = (await sandboxCli(["referral-recovery", x.op.id, file], store, x.runner)) as {
      id: string;
      approvalHash: string;
    };
    await expect(x.runner.recoverReferral(proposal.id)).rejects.toThrow(
      "referral_recovery_approval_required",
    );
    await store.approveReferralRecovery(proposal.id, proposal.approvalHash);
    const before = (await store.report(x.runId)).allocation;
    await x.runner.recoverReferral(proposal.id);
    expect((await store.operation(x.op.id)).state).toBe("waiting_for_browser");
    const resource = await store.onboardingResource(x.op.id);
    expect(resource.referralId).toBe("FAKE_REF");
    expect(await x.artifacts.readBrowserUrl(resource.artifactKey ?? "")).toContain(
      "PRIVATE_CONSENT",
    );
    expect((await store.report(x.runId)).allocation).toMatchObject({
      consumedCalls: before.consumedCalls + 2,
      heldCalls: before.heldCalls - 2,
    });
    expect(
      x.fetcher.mock.calls.filter(
        ([, init]) => init?.method === "POST" && String(init.body).includes("tracking_id"),
      ),
    ).toHaveLength(1);
    expect(JSON.stringify(await store.inspect(x.runId))).not.toContain("FAKE_REF");
  });

  it("P3 rejects a recovered referral with the wrong tracking ID", async () => {
    const x = await onboardingSetup();
    await store.approve(x.op.id, x.op.payloadHash, 1);
    x.fetcher.mockImplementation(async (url, init) => {
      if (String(url).endsWith("/token")) return token();
      if (init?.method === "POST") throw new Error("PRIVATE_TIMEOUT");
      return Response.json({
        ...x.referralBody,
        partner_referral_id: "FAKE_REF",
        submitter_client_id: x.context.platformClientId,
        referral_data: { tracking_id: "WRONG" },
      });
    });
    await x.runner.resume(x.op.id);
    const proposal = await store.proposeReferralRecovery(x.op.id, "FAKE_REF");
    await store.approveReferralRecovery(proposal.id, proposal.approvalHash);
    await expect(x.runner.recoverReferral(proposal.id)).rejects.toThrow(
      "referral_recovery_mismatch",
    );
    expect((await store.onboardingResource(x.op.id)).referralId).toBeNull();
    expect((await store.referralRecovery(proposal.id)).state).toBe("awaiting_approval");
  });

  it("P3 keeps a failed known-ID read auditable and requires a new approval", async () => {
    const x = await onboardingSetup(4);
    await store.approve(x.op.id, x.op.payloadHash, 1);
    x.fetcher.mockImplementation(async (url, init) => {
      if (String(url).endsWith("/token")) return token();
      if (init?.method === "POST") throw new Error("PRIVATE_TIMEOUT");
      return Response.json({ name: "NOT_FOUND" }, { status: 404 });
    });
    await x.runner.resume(x.op.id);
    const proposal = await store.proposeReferralRecovery(x.op.id, "FAKE_REF");
    await store.approveReferralRecovery(proposal.id, proposal.approvalHash);
    await expect(x.runner.recoverReferral(proposal.id)).rejects.toThrow();
    expect((await store.referralRecovery(proposal.id)).state).toBe("awaiting_approval");
    expect((await store.onboardingResource(x.op.id)).referralId).toBeNull();
    await expect(x.runner.recoverReferral(proposal.id)).rejects.toThrow(
      "referral_recovery_approval_required",
    );
    expect((await store.report(x.runId)).allocation.heldCalls).toBe(
      (await store.operation(x.op.id)).heldCalls,
    );
  });

  it("P3 releases an approved referral recovery reservation at the original deadline", async () => {
    const x = await onboardingSetup();
    await store.approve(x.op.id, x.op.payloadHash, 1);
    x.fetcher.mockImplementation(async (url, init) => {
      if (String(url).endsWith("/token")) return token();
      if (init?.method === "POST") throw new Error("PRIVATE_TIMEOUT");
      return Response.json({ name: "NOT_FOUND" }, { status: 404 });
    });
    await x.runner.resume(x.op.id);
    const proposal = await store.proposeReferralRecovery(x.op.id, "FAKE_REF");
    await store.approveReferralRecovery(proposal.id, proposal.approvalHash);
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(x.context.checkUntil) + 1);
    try {
      await expect(x.runner.resume(x.op.id)).rejects.toThrow("onboarding_recovery_limit");
      expect((await store.operation(x.op.id)).state).toBe("blocked");
      expect((await store.referralRecovery(proposal.id)).state).toBe("failed");
      expect((await store.report(x.runId)).allocation.heldCalls).toBe(0);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("P3 retains a referral ID when private-link storage fails and can refresh by counted GET", async () => {
    const x = await onboardingSetup(6);
    x.statusBody.primary_email_confirmed = false;
    const save = vi
      .spyOn(x.artifacts, "saveBrowserUrl")
      .mockRejectedValueOnce(new Error("disk_failure"));
    await store.approve(x.op.id, x.op.payloadHash, 1);
    await x.runner.resume(x.op.id);
    expect((await store.onboardingResource(x.op.id)).referralId).toBe("FAKE_REF");
    expect((await store.operation(x.op.id)).state).toBe("inconclusive");
    await x.runner.resume(x.op.id, { refreshConsent: true });
    expect(save).toHaveBeenCalledTimes(2);
    expect((await store.operation(x.op.id)).state).toBe("waiting_for_browser");
    expect(
      x.fetcher.mock.calls.filter(([url]) => String(url).endsWith("/partner-referrals/FAKE_REF")),
    ).toHaveLength(1);
  });

  it("P3 bounds polling across repeated resumes and preserves the shared money allocation", async () => {
    const x = await onboardingSetup(2);
    x.statusBody.primary_email_confirmed = false;
    await store.approve(x.op.id, x.op.payloadHash, 1);
    await x.runner.resume(x.op.id);
    await x.runner.resume(x.op.id);
    await x.runner.resume(x.op.id);
    const count = x.fetcher.mock.calls.length;
    await x.runner.resume(x.op.id);
    expect(x.fetcher).toHaveBeenCalledTimes(count);
    expect((await store.operation(x.op.id)).recoveryReads).toBe(2);
    expect((await store.operation(x.op.id)).state).toBe("blocked");
    expect((await store.inspect(x.runId)).browserWaits[0]?.resolved).toBe(true);
    expect((await store.report(x.runId)).allocation).toMatchObject({
      committedCents: 0,
      reservedCents: 0,
      heldCalls: 0,
    });
  });

  it("P3 stops before network access when its persistent deadline expires", async () => {
    const x = await onboardingSetup();
    await store.approve(x.op.id, x.op.payloadHash, 1);
    await x.runner.resume(x.op.id);
    expect((await store.report(x.runId)).allocation.heldCalls).toBeGreaterThan(0);
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(x.context.checkUntil) + 1);
    try {
      await expect(x.runner.resume(x.op.id)).rejects.toThrow("onboarding_recovery_limit");
      expect(x.fetcher).toHaveBeenCalledTimes(2);
      expect((await store.operation(x.op.id)).state).toBe("blocked");
      expect((await store.report(x.runId)).allocation.heldCalls).toBe(0);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it.each([404, 503, "network"] as const)(
    "P3 retains consent after a status-read failure: %s",
    async (failure) => {
      const x = await onboardingSetup();
      await store.approve(x.op.id, x.op.payloadHash, 1);
      await x.runner.resume(x.op.id);
      const original = (await store.onboardingResource(x.op.id)).artifactKey;
      x.fetcher.mockImplementation(async (url) => {
        if (String(url).endsWith("/token")) return token();
        if (failure === "network") throw new Error("PRIVATE_NETWORK");
        return Response.json({ name: "PRIVATE_ERROR" }, { status: failure });
      });
      await x.runner.resume(x.op.id);
      expect((await store.operation(x.op.id)).state).toBe("waiting_for_browser");
      expect((await store.onboardingResource(x.op.id)).artifactKey).toBe(original);
      expect(
        await sandboxCli(["consent-file", x.op.id], store, x.runner, x.artifacts),
      ).toMatchObject({
        privateFile: x.artifacts.filePath(original ?? ""),
      });
    },
  );

  it("P3 finds an older inconclusive consent file from either launch directory", async () => {
    const x = await onboardingSetup();
    await store.approve(x.op.id, x.op.payloadHash, 1);
    await x.runner.resume(x.op.id);
    await store.db.$client.unsafe(
      "UPDATE sandbox_operation SET state = 'inconclusive' WHERE id = $1",
      [x.op.id],
    );
    await store.db.$client.unsafe(
      "UPDATE sandbox_onboarding SET evidence = jsonb_set(evidence, '{reason}', '\"not_found\"'::jsonb) WHERE operation_id = $1",
      [x.op.id],
    );
    const before = x.fetcher.mock.calls.length;
    const current = process.cwd();
    try {
      process.chdir(resolve(current, "../.."));
      const root = await sandboxCli(["consent-file", x.op.id], store, x.runner, x.artifacts);
      process.chdir(current);
      const agents = await sandboxCli(["consent-file", x.op.id], store, x.runner, x.artifacts);
      expect(root).toEqual(agents);
      expect(root).toMatchObject({
        privateFile: x.artifacts.filePath(
          (await store.onboardingResource(x.op.id)).artifactKey ?? "",
        ),
      });
      expect(JSON.stringify(root)).not.toContain("PRIVATE_CONSENT");
      expect(x.fetcher).toHaveBeenCalledTimes(before);
    } finally {
      process.chdir(current);
    }
  });

  it("P3 preserves the existing consent artifact when a local recovery bound stops a read", async () => {
    const x = await onboardingSetup();
    await store.approve(x.op.id, x.op.payloadHash, 1);
    await x.runner.resume(x.op.id);
    const original = (await store.onboardingResource(x.op.id)).artifactKey;
    const outcome = await x.adapter.recover(await store.operation(x.op.id), async () => {
      throw new Error("recovery_bound");
    });
    expect(outcome).toMatchObject({ state: "waiting_for_browser", artifactKey: original });
  });

  it("P3 atomically rejects stale resource updates and false ready evidence", async () => {
    const x = await onboardingSetup();
    await store.approve(x.op.id, x.op.payloadHash, 1);
    const claim = await store.claim(x.op.id);
    const result = await x.adapter.interpret(x.referralBody, claim.operation);
    await expect(store.finish({ ...claim, token: randomUUID() }, result)).rejects.toThrow(
      "stale_claim",
    );
    expect((await store.onboardingResource(x.op.id)).referralId).toBeNull();
    await expect(
      store.finish(claim, {
        state: "succeeded",
        onboarding: {
          evidence: {
            status: "consent_verified",
            reason: "ready",
            merchantMatched: false,
            platformConnected: true,
            permissionsGranted: true,
            paymentsReceivable: true,
            primaryEmailConfirmed: true,
            productActive: true,
            missingScopes: [],
          },
        },
      }),
    ).rejects.toThrow("onboarding_not_verified");
    expect((await store.operation(x.op.id)).state).toBe("dispatching");
    await store.finish(claim, result);
    expect((await store.onboardingResource(x.op.id)).referralId).toBe("FAKE_REF");
  });

  it("P3 exposes private file locations only on explicit request and refreshes without another POST", async () => {
    const x = await onboardingSetup();
    const inputFile = join(x.directory, "input.json");
    await writeFile(
      inputFile,
      JSON.stringify({
        context: {
          ...x.context,
          seller: "seller-b",
          sellerMerchantId: "SELLERB000001",
          trackingId: randomUUID(),
        },
        recoveryCalls: 2,
      }),
    );
    const preparedResult = await sandboxCli(["onboard", inputFile], store, x.runner);
    expect(JSON.stringify(preparedResult)).not.toMatch(/SELLERB000001|FAKE_CLIENT|FAKE_BN/);
    expect(x.fetcher).not.toHaveBeenCalled();
    await expect(sandboxCli(["consent-file", x.op.id], store, x.runner)).rejects.toThrow(
      "consent_unavailable",
    );
    await store.approve(x.op.id, x.op.payloadHash, 1);
    await x.runner.resume(x.op.id);
    const oldKey = (await store.onboardingResource(x.op.id)).artifactKey;
    const location = await sandboxCli(["consent-file", x.op.id], store, x.runner, x.artifacts);
    expect(location).toEqual({
      seller: "seller-a",
      privateFile: x.artifacts.filePath(oldKey ?? ""),
    });
    expect(JSON.stringify(location)).not.toContain("PRIVATE_CONSENT");
    await sandboxCli(["refresh-consent", x.op.id], store, x.runner);
    const newKey = (await store.onboardingResource(x.op.id)).artifactKey;
    expect(newKey).not.toBe(oldKey);
    expect((await store.inspect(x.runId)).browserWaits[0]?.artifactKey).toBe(newKey);
    expect((await store.operation(x.op.id)).attempts).toBe(1);
  });

  it("P3 prevents concurrent duplicate dispatch and refuses exhausted shared request budgets", async () => {
    const x = await onboardingSetup(2);
    await store.approve(x.op.id, x.op.payloadHash, 1);
    await store.db.$client`UPDATE sandbox_allocation SET consumed_calls = 45`;
    await expect(x.runner.resume(x.op.id)).rejects.toThrow("call_limit");
    expect(x.fetcher).not.toHaveBeenCalled();
    await store.db.$client`UPDATE sandbox_allocation SET consumed_calls = 44`;
    const fetchResponse = x.fetcher.getMockImplementation();
    if (!fetchResponse) throw new Error("missing_fetch_fixture");
    let releaseDispatch!: () => void;
    let enteredDispatch!: () => void;
    const dispatchHeld = new Promise<void>((resolve) => {
      releaseDispatch = resolve;
    });
    const dispatchStarted = new Promise<void>((resolve) => {
      enteredDispatch = resolve;
    });
    x.fetcher.mockImplementation(async (url, init) => {
      if (String(init?.body).includes("tracking_id")) {
        enteredDispatch();
        await dispatchHeld;
      }
      return fetchResponse(url, init);
    });
    const first = x.runner.resume(x.op.id);
    await dispatchStarted;
    try {
      await Promise.allSettled([x.runner.resume(x.op.id)]);
    } finally {
      releaseDispatch();
      await first;
    }
    expect((await store.operation(x.op.id)).attempts).toBe(1);
    expect(
      x.fetcher.mock.calls.filter(([, init]) => String(init?.body).includes("tracking_id")),
    ).toHaveLength(1);
    const allocation = (await store.report(x.runId)).allocation;
    expect([
      [46, 4],
      [48, 0],
    ]).toContainEqual([allocation.consumedCalls, allocation.heldCalls]);
  });

  it("persists preparation, blocks unapproved dispatch and reports no private payload", async () => {
    const { runId, op } = await prepared();
    const fetcher = vi.fn<typeof fetch>();
    await new SandboxRunner(store, credentials, [adapter()], fetcher).resume(op.id);
    expect(fetcher).not.toHaveBeenCalled();
    const reopened = new SandboxStore(await openSandboxTestDb(testUrl));
    try {
      const report = await reopened.report(runId);
      expect(report.allocation.reservedCents).toBe(11);
      expect(report.allocation.consumedCalls).toBe(0);
      expect(JSON.stringify(report)).not.toMatch(
        /PRIVATE_PAYLOAD|FAKE_SECRET|resourceKey|requestId/,
      );
    } finally {
      await reopened.db.$client.end();
    }
  });

  it("only one competing runner dispatches and approval cannot be reused", async () => {
    const { runId, op } = await approved();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url).endsWith("/token") ? token() : Response.json({}),
      );
    const runner = new SandboxRunner(store, credentials, [adapter()], fetcher);
    await Promise.allSettled([runner.resume(op.id), runner.resume(op.id)]);
    expect(fetcher.mock.calls.filter(([url]) => !String(url).endsWith("/token"))).toHaveLength(1);
    await runner.resume(op.id);
    await expect(store.approve(op.id, op.payloadHash, 1)).rejects.toThrow("approval_mismatch");
    expect((await store.report(runId)).allocation).toMatchObject({
      committedCents: 11,
      reservedCents: 0,
      consumedCalls: 2,
      heldCalls: 0,
    });
  });

  it("rejects changed identities, stale approvals and duplicate semantic operations", async () => {
    const input = spec();
    const { runId, op } = await prepared(input);
    await expect(store.prepare(runId, op.id, { ...input, feeBoundCents: 2 })).rejects.toThrow(
      "identity_conflict",
    );
    expect((await store.prepare(runId, op.id, input)).requestId).toBe(op.requestId);
    await expect(store.approve(op.id, "0".repeat(64), 1)).rejects.toThrow("approval_mismatch");
    await expect(store.approve(op.id, op.payloadHash, 2)).rejects.toThrow("approval_mismatch");
    await expect(
      store.prepare(runId, randomUUID(), { ...input, commitmentId: randomUUID() }),
    ).rejects.toThrow();
    expect((await store.report(runId)).allocation.reservedCents).toBe(11);
  });

  it("enforces one money allowance across concurrent preparations and new runs", async () => {
    const runId = await store.start();
    const input = () => spec({ recipients: [{ alias: "seller-a", cents: 60 }], feeBoundCents: 0 });
    const results = await Promise.allSettled([
      store.prepare(runId, randomUUID(), input()),
      store.prepare(runId, randomUUID(), input()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const second = await store.start();
    expect((await store.report(second)).allocation.reservedCents).toBe(60);
    await expect(store.prepare(second, randomUUID(), input())).rejects.toThrow("money_limit");
  });

  it("counts principal once across order and capture, and charges each fee allowance", async () => {
    const input = spec();
    const { runId, op } = await approved(input);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url).endsWith("/token") ? token() : Response.json({}),
      );
    await new SandboxRunner(store, credentials, [adapter()], fetcher).resume(op.id);
    const capture = await store.prepare(runId, randomUUID(), {
      ...input,
      kind: "capture_order",
      resourceKey: randomUUID(),
      request: { method: "POST", path: "/v2/checkout/orders/FAKE/capture", body: {} },
    });
    expect((await store.report(runId)).allocation).toMatchObject({
      committedCents: 11,
      reservedCents: 1,
    });
    await store.approve(capture.id, capture.payloadHash, 1);
    await new SandboxRunner(
      store,
      credentials,
      [adapter({ kind: "capture_order" })],
      fetcher,
    ).resume(capture.id);
    expect((await store.report(runId)).allocation).toMatchObject({
      committedCents: 12,
      reservedCents: 0,
    });
    await expect(
      store.prepare(runId, randomUUID(), { ...input, kind: "payout", resourceKey: randomUUID() }),
    ).rejects.toThrow("new_payment_requires_new_commitment");
  });

  it("requires an existing successful prior stage for capture", async () => {
    const input = spec({ kind: "capture_order" });
    const runId = await store.start();
    await expect(store.prepare(runId, randomUUID(), input)).rejects.toThrow(
      "prior_commitment_required",
    );
    const original = spec();
    await store.prepare(runId, randomUUID(), original);
    await expect(
      store.prepare(runId, randomUUID(), { ...original, kind: "capture_order" }),
    ).rejects.toThrow("prior_stage_required");
  });

  it("keeps timed-out money reserved and recovers through reads without resending", async () => {
    const { runId, op } = await approved();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockRejectedValueOnce(new Error("FAKE_SECRET timeout"));
    await new SandboxRunner(store, credentials, [adapter()], fetcher).resume(op.id);
    expect((await store.operation(op.id)).state).toBe("inconclusive");
    expect((await store.report(runId)).allocation.reservedCents).toBe(11);
    const restarted = new SandboxStore(await openSandboxTestDb(testUrl));
    try {
      const recovery = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(token())
        .mockResolvedValue(Response.json({ status: "COMPLETED" }));
      await new SandboxRunner(restarted, credentials, [adapter()], recovery).resume(op.id);
      expect(recovery.mock.calls[1]?.[1]?.method).toBe("GET");
      expect((await restarted.operation(op.id)).attempts).toBe(1);
      expect((await restarted.report(runId)).allocation).toMatchObject({
        committedCents: 11,
        reservedCents: 0,
        consumedCalls: 4,
      });
    } finally {
      await restarted.db.$client.end();
    }
  });

  it("recovers a crash after dispatch without allowing stale completion or redispatch", async () => {
    const { runId, op } = await approved();
    const claim = await store.claim(op.id);
    await store.markDispatch(claim);
    await expect(store.markDispatch(claim)).rejects.toThrow("already_dispatched");
    await expect(store.beginRecovery(op.id)).rejects.toThrow("claim_active");
    await store.db
      .$client`UPDATE sandbox_operation SET claim_until = now() - interval '1 second' WHERE id = ${op.id}`;
    const recovery = await store.beginRecovery(op.id);
    await expect(store.finish(claim, { state: "succeeded" })).rejects.toThrow("stale_claim");
    await expect(store.markDispatch(claim)).rejects.toThrow("claim_expired");
    await store.finishRecovery(recovery, { state: "inconclusive" });
    expect((await store.report(runId)).allocation.reservedCents).toBe(11);
    await expect(store.claim(op.id)).rejects.toThrow("not_ready");
  });

  it("never reuses a consumed approval after a pre-dispatch crash", async () => {
    const { runId, op } = await approved();
    await store.claim(op.id);
    expect((await store.report(runId)).allocation.consumedCalls).toBe(1);
    await store.db
      .$client`UPDATE sandbox_operation SET claim_until = now() - interval '1 second' WHERE id = ${op.id}`;
    const recovery = await store.beginRecovery(op.id);
    await store.finishRecovery(recovery, { state: "inconclusive" });
    await expect(store.claim(op.id)).rejects.toThrow("not_ready");
    await expect(store.approve(op.id, op.payloadHash, 1)).rejects.toThrow("approval_mismatch");
  });

  it("persists browser waits and validates resumed status through a counted read", async () => {
    const { runId, op } = await approved();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValue(Response.json({}));
    await new SandboxRunner(
      store,
      credentials,
      [
        adapter({
          interpret: async () => ({
            state: "waiting_for_browser",
            expectedAlias: "buyer",
            artifactKey: randomUUID(),
          }),
        }),
      ],
      fetcher,
    ).resume(op.id);
    const waits = await store.db
      .$client`SELECT * FROM sandbox_browser_wait WHERE operation_id = ${op.id}`;
    expect(waits).toHaveLength(1);
    expect((await store.report(runId)).allocation.reservedCents).toBe(11);
    const resumed = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValue(Response.json({}));
    const reopened = new SandboxStore(await openSandboxTestDb(testUrl));
    try {
      await new SandboxRunner(reopened, credentials, [adapter()], resumed).resume(op.id);
      expect((await reopened.operation(op.id)).state).toBe("succeeded");
      expect((await reopened.report(runId)).allocation).toMatchObject({
        committedCents: 11,
        reservedCents: 0,
      });
    } finally {
      await reopened.db.$client.end();
    }
    expect(
      (
        await store.db
          .$client`SELECT resolved FROM sandbox_browser_wait WHERE operation_id = ${op.id}`
      )[0]?.resolved,
    ).toBe(1);
  });

  it("enforces the 50-call boundary atomically, including restarts", async () => {
    const runId = await store.start();
    const attempts = await Promise.allSettled(
      Array.from({ length: 55 }, () => store.reserveRequest(runId, "read")),
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(50);
    expect((await store.report(await store.start())).allocation.consumedCalls).toBe(50);
    await expect(store.reserveRequest(runId, "oauth")).rejects.toThrow("call_limit");
  });

  it("holds confirmation allowance against unrelated requests", async () => {
    const { runId, op } = await approved();
    const claim = await store.claim(op.id);
    expect((await store.report(runId)).allocation).toMatchObject({
      consumedCalls: 1,
      heldCalls: 4,
    });
    const attempts = await Promise.allSettled(
      Array.from({ length: 50 }, () => store.reserveRequest(runId, "read")),
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(45);
    await store.reserveClaimRequest(claim, "oauth");
    expect((await store.report(runId)).allocation).toMatchObject({
      consumedCalls: 47,
      heldCalls: 3,
    });
  });

  it("stops recovery at its persisted read limit without sending writes", async () => {
    const { op } = await approved();
    const claim = await store.claim(op.id);
    await store.finish(claim, { state: "inconclusive" });
    const recovery = await store.beginRecovery(op.id);
    await store.reserveClaimRequest(recovery, "recovery");
    await store.reserveClaimRequest(recovery, "recovery");
    await expect(store.reserveClaimRequest(recovery, "recovery")).rejects.toThrow("call_limit");
    await store.finishRecovery(recovery, { state: "inconclusive" });
    expect((await store.operation(op.id)).attempts).toBe(1);
  });

  it("fails closed when adapters are missing or change approved request bytes", async () => {
    const { op } = await approved();
    const fetcher = vi.fn<typeof fetch>();
    await expect(new SandboxRunner(store, credentials, [], fetcher).resume(op.id)).rejects.toThrow(
      "adapter_unavailable",
    );
    await expect(
      new SandboxRunner(
        store,
        credentials,
        [
          adapter({
            prepare: () => ({
              method: "POST",
              path: "/v2/checkout/orders",
              body: { altered: true },
            }),
          }),
        ],
        fetcher,
      ).resume(op.id),
    ).rejects.toThrow("request_changed");
    expect(fetcher).not.toHaveBeenCalled();
    expect((await store.operation(op.id)).attempts).toBe(0);
  });

  it("rejects database payload tampering before dispatch", async () => {
    const { op } = await approved();
    await store.db
      .$client`UPDATE sandbox_operation SET spec = jsonb_set(spec, '{feeBoundCents}', '2') WHERE id = ${op.id}`;
    await expect(store.claim(op.id)).rejects.toThrow("payload_changed");
  });

  it("records recovered browser waits and retains spending on denied consent", async () => {
    const { runId, op } = await approved();
    const claim = await store.claim(op.id);
    await store.finish(claim, { state: "inconclusive" });
    const recovery = await store.beginRecovery(op.id);
    await store.finishRecovery(recovery, {
      state: "waiting_for_browser",
      expectedAlias: "buyer",
      artifactKey: randomUUID(),
    });
    expect((await store.inspect(runId)).browserWaits).toHaveLength(1);
    const denied = await store.beginRecovery(op.id);
    await store.finishRecovery(denied, { state: "failed" });
    expect((await store.report(runId)).allocation).toMatchObject({
      reservedCents: 11,
      heldCalls: 0,
    });
    expect((await store.inspect(runId)).browserWaits[0]?.resolved).toBe(true);
  });

  it("supports counted read-only operations without a payment approval", async () => {
    const { runId, op } = await prepared(
      spec({
        kind: "read_status",
        recipients: [{ alias: "seller-a", cents: 0 }],
        feeBoundCents: 0,
        request: { method: "GET", path: "/v2/checkout/orders/FAKE" },
      }),
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValue(Response.json({}));
    await new SandboxRunner(store, credentials, [adapter({ kind: "read_status" })], fetcher).resume(
      op.id,
    );
    expect(fetcher.mock.calls[1]?.[1]?.method).toBe("GET");
    expect((await store.report(runId)).allocation).toMatchObject({
      consumedCalls: 2,
      committedCents: 0,
      reservedCents: 0,
    });
  });

  async function paymentSetup(withConsent = true) {
    const onboard = await onboardingSetup();
    if (withConsent) {
      await store.approve(onboard.op.id, onboard.op.payloadHash, 1);
      await onboard.runner.resume(onboard.op.id);
      await onboard.runner.resume(onboard.op.id);
    }
    const input = paymentSpec({
      checkout: {
        returnUrl: "http://localhost:3000/sandbox/checkout/return",
        cancelUrl: "http://localhost:3000/sandbox/checkout/cancel",
      },
      path: "authorization_capture",
      seller: onboard.context,
      buyerMerchantId: "BUYER00000001",
      buyerMappingVersion: 1,
      principalCents: 50,
      feeBounds: { create_order: 1, authorize_order: 2, capture_order: 3 },
      executeUntil: new Date(Date.now() + 3600000).toISOString(),
      recoverUntil: new Date(Date.now() + 7200000).toISOString(),
      recoveryCalls: 4,
    });
    const { runId, op } = await prepared(input);
    const p = input.payment;
    if (!p) throw new Error("payment_fixture");
    let status = "CREATED";
    let captureStatus = "COMPLETED";
    const authorization = {
      id: "AUTH1",
      status: "CREATED",
      amount: { currency_code: "USD", value: "0.50" },
      expiration_time: new Date(Date.now() + 86400000).toISOString(),
    };
    const capture = () => ({
      id: "CAPTURE1",
      status: captureStatus,
      amount: { currency_code: "USD", value: "0.50" },
      supplementary_data: { related_ids: { order_id: "ORDER1", authorization_id: "AUTH1" } },
    });
    const order = () => ({
      id: "ORDER1",
      status,
      intent: "AUTHORIZE",
      ...(status !== "CREATED" ? { payer: { payer_id: p.context.buyerMerchantId } } : {}),
      purchase_units: [
        {
          reference_id: input.commitmentId,
          amount: { currency_code: "USD", value: "0.50" },
          payee: { merchant_id: p.context.seller.sellerMerchantId },
          ...(status === "COMPLETED"
            ? { payments: { authorizations: [authorization], captures: [capture()] } }
            : {}),
        },
      ],
      links: [
        {
          rel: "payer-action",
          method: "GET",
          href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER1",
        },
      ],
    });
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/token")) return token();
      if (path.includes("/merchant-integrations/")) return Response.json(onboard.statusBody);
      if (path.endsWith("/authorize") && init?.method === "POST") {
        status = "COMPLETED";
        return Response.json(order());
      }
      if (path.endsWith("/capture") && init?.method === "POST") return Response.json(capture());
      if (path.includes("/authorizations/")) return Response.json(authorization);
      if (path.includes("/captures/")) return Response.json(capture());
      return Response.json(order());
    });
    const adapters = paymentAdapters(store, onboard.artifacts, credentials.clientId);
    const runner = new SandboxRunner(store, credentials, adapters, fetcher);
    async function dispatch(operation: typeof op) {
      await store.approve(operation.id, operation.payloadHash, 1);
      await runner.resume(operation.id);
    }
    async function next(previous: typeof op) {
      const result = (await sandboxCli(["payment-next", previous.id], store, runner)) as {
        operationId: string;
      };
      return store.operation(result.operationId);
    }
    return {
      ...onboard,
      input,
      runId,
      op,
      p,
      fetcher,
      adapters,
      runner,
      order,
      authorization,
      capture,
      dispatch,
      next,
      setStatus: (s: string) => {
        status = s;
      },
      setCaptureStatus: (s: string) => {
        captureStatus = s;
      },
    };
  }

  it("P4 sends explicit callbacks and blocks new orders without them before network dispatch", async () => {
    const x = await paymentSetup();
    const legacy = paymentSpec({ ...x.p.context, checkout: undefined });
    expect(() => x.adapters[0]?.prepare({ ...x.op, spec: legacy })).toThrow(
      "checkout_destinations_required",
    );
    const file = join(x.directory, "legacy-protect.json");
    await writeFile(file, JSON.stringify({ ...x.p.context, checkout: undefined }));
    const before = (await store.report(x.runId)).allocation;
    await expect(sandboxCli(["protect", file], store, x.runner)).rejects.toThrow(
      "checkout_destinations_required",
    );
    expect((await store.report(x.runId)).allocation).toEqual(before);
    expect(x.fetcher).not.toHaveBeenCalled();
    await x.dispatch(x.op);
    const creation = x.fetcher.mock.calls.find(
      ([url, init]) =>
        new URL(String(url)).pathname === "/v2/checkout/orders" && init?.method === "POST",
    );
    expect(
      JSON.parse(String(creation?.[1]?.body)).payment_source.paypal.experience_context,
    ).toEqual({
      shipping_preference: "NO_SHIPPING",
      user_action: "CONTINUE",
      return_url: "http://localhost:3000/sandbox/checkout/return",
      cancel_url: "http://localhost:3000/sandbox/checkout/cancel",
    });
  });

  it("P4 retires only an unapproved order and permanently blocks reuse of its commitment", async () => {
    const x = await paymentSetup();
    await x.dispatch(x.op);
    const original = await store.operation(x.op.id);
    const before = (await store.report(x.runId)).allocation;
    const file = join(x.directory, "retire-order.json");
    await writeFile(file, JSON.stringify({ kind: "retire_order" }));
    const summary = (await sandboxCli(["maintenance", x.op.id, file], store, x.runner)) as {
      id: string;
      approvalHash: string;
    };
    expect((await store.report(x.runId)).allocation).toEqual(before);
    await store.approveMaintenance(summary.id, summary.approvalHash);
    const calls = x.fetcher.mock.calls.length;
    await sandboxCli(["apply-maintenance", summary.id], store, x.runner);
    expect(x.fetcher.mock.calls.slice(calls).map(([url]) => new URL(String(url)).pathname)).toEqual(
      ["/v1/oauth2/token", "/v2/checkout/orders/ORDER1"],
    );
    expect((await store.operation(x.op.id)).state).toBe("blocked");
    expect((await store.operation(x.op.id)).spec).toEqual(original.spec);
    expect((await store.operation(x.op.id)).requestId).toBe(original.requestId);
    expect((await store.paymentResource(x.op.commitmentId)).result.orderId).toBe("ORDER1");
    expect((await store.inspect(x.runId)).browserWaits[0]?.resolved).toBe(true);
    expect((await store.report(x.runId)).allocation).toMatchObject({
      consumedCalls: before.consumedCalls + 2,
      heldCalls: 0,
      reservedCents: 0,
      committedCents: 0,
    });
    await x.runner.resume(x.op.id);
    await expect(x.next(x.op)).rejects.toThrow("payment_not_advanceable");
    await expect(
      store.prepare(
        x.runId,
        randomUUID(),
        paymentSpec(x.p.context, x.op.commitmentId, "authorize_order", { orderId: "ORDER1" }),
      ),
    ).rejects.toThrow("commitment_retired_or_amended");
    await expect(x.runner.maintain(summary.id)).rejects.toThrow();
    const replacement = await store.prepare(x.runId, randomUUID(), paymentSpec(x.p.context));
    expect(replacement.commitmentId).not.toBe(x.op.commitmentId);
    expect((await store.report(x.runId)).allocation.consumedCalls).toBe(before.consumedCalls + 2);
  });

  it.each(["APPROVED", "COMPLETED", "wrong_order", "wrong_amount", "wrong_seller", "network"])(
    "P4 keeps the old allocation reserved when retirement evidence is unsafe: %s",
    async (failure) => {
      const x = await paymentSetup();
      await x.dispatch(x.op);
      const summary = await store.proposeMaintenance(x.op.id, { kind: "retire_order" });
      await store.approveMaintenance(summary.id, summary.approvalHash);
      const reserved = (await store.report(x.runId)).allocation.reservedCents;
      const response = x.fetcher.getMockImplementation();
      if (!response) throw new Error("fixture");
      x.fetcher.mockImplementation(async (url, init) => {
        if (!String(url).endsWith("/orders/ORDER1")) return response(url, init);
        if (failure === "network") throw new Error("network");
        const body = x.order();
        const unit = body.purchase_units[0];
        if (!unit) throw new Error("fixture");
        if (failure === "wrong_order") body.id = "OTHER";
        else if (failure === "wrong_amount") unit.amount.value = "0.51";
        else if (failure === "wrong_seller") unit.payee.merchant_id = "SELLERB000001";
        else body.status = failure;
        return Response.json(body);
      });
      await expect(x.runner.maintain(summary.id)).rejects.toThrow();
      expect((await store.maintenanceRecord(summary.id)).state).toBe("failed");
      expect((await store.report(x.runId)).allocation.reservedCents).toBe(reserved);
      await expect(x.runner.resume(x.op.id)).rejects.toThrow(
        "maintenance_requires_dedicated_command",
      );
    },
  );

  it("P4 rejects retirement after an authorization stage is prepared", async () => {
    const x = await paymentSetup();
    await x.dispatch(x.op);
    x.setStatus("APPROVED");
    await x.runner.resume(x.op.id);
    await x.next(x.op);
    await expect(store.proposeMaintenance(x.op.id, { kind: "retire_order" })).rejects.toThrow();
  });

  it("P4 prepares a buyer change without creating a second order or spending budget", async () => {
    const x = await paymentSetup();
    await x.dispatch(x.op);
    const before = (await store.report(x.runId)).allocation;
    const file = join(x.directory, "buyer-change.json");
    await writeFile(
      file,
      JSON.stringify({ buyerMerchantId: "BUYER00000002", buyerMappingVersion: 2 }),
    );
    const change = await sandboxCli(["buyer-change", x.op.id, file], store, x.runner);
    expect(change).toMatchObject({
      state: "awaiting_approval",
      fromBuyerMappingVersion: 1,
      toBuyerMappingVersion: 2,
      additionalCalls: 4,
    });
    expect((await store.report(x.runId)).allocation).toEqual(before);
    expect((await store.operation(x.op.id)).payloadHash).toBe(x.op.payloadHash);
    await expect(x.runner.resume(x.op.id)).rejects.toThrow("buyer_change_pending");
    expect(
      x.fetcher.mock.calls.filter(
        ([, init]) =>
          init?.method === "POST" && String(init.body) !== "grant_type=client_credentials",
      ),
    ).toHaveLength(1);
  });

  const newBuyer = { buyerMerchantId: "BUYER00000002", buyerMappingVersion: 2 };

  it("P4 applies an approved buyer change after restart with counted GETs and no second POST", async () => {
    const x = await paymentSetup();
    await x.dispatch(x.op);
    const original = await store.operation(x.op.id);
    const resource = await store.paymentResource(x.op.commitmentId);
    const change = await store.proposeBuyerChange(x.op.id, newBuyer);
    const before = (await store.report(x.runId)).allocation;
    await expect(x.runner.changeBuyer(change.id)).rejects.toThrow("buyer_change_approval_required");
    await expect(store.approveBuyerChange(change.id, "0".repeat(64))).rejects.toThrow(
      "buyer_change_approval_mismatch",
    );
    await sandboxCli(["approve-buyer-change", change.id, change.approvalHash], store, x.runner);
    expect((await store.report(x.runId)).allocation).toEqual({
      ...before,
      heldCalls: before.heldCalls + 4,
    });
    await expect(store.approveBuyerChange(change.id, change.approvalHash)).rejects.toThrow(
      "buyer_change_approval_mismatch",
    );
    const reopened = new SandboxStore(await openSandboxTestDb(testUrl));
    try {
      const runner = new SandboxRunner(
        reopened,
        credentials,
        paymentAdapters(reopened, x.artifacts, credentials.clientId),
        x.fetcher,
      );
      await sandboxCli(["apply-buyer-change", change.id], reopened, runner);
    } finally {
      await reopened.db.$client.end();
    }
    const updated = await store.operation(x.op.id);
    expect(updated).toMatchObject({
      state: "waiting_for_browser",
      requestId: original.requestId,
      attempts: original.attempts,
      recoveryReads: original.recoveryReads + 1,
      spec: { payment: { context: newBuyer } },
    });
    expect(updated.payloadHash).not.toBe(original.payloadHash);
    expect(updated.spec.request).toEqual(original.spec.request);
    expect(await store.paymentResource(x.op.commitmentId)).toMatchObject({
      result: resource.result,
      readinessAt: null,
      context: { ...resource.context, ...newBuyer },
    });
    expect(await store.buyerChange(change.id)).toMatchObject({
      sourceSpec: original.spec,
      targetSpec: updated.spec,
      state: "applied",
    });
    expect((await store.report(x.runId)).allocation).toEqual({
      ...before,
      consumedCalls: before.consumedCalls + 2,
      heldCalls: before.heldCalls + 2,
    });
    expect(JSON.stringify(await store.inspect(x.runId))).not.toMatch(
      /BUYER00000001|BUYER00000002|ORDER1|FAKE_CLIENT/,
    );
    await expect(x.runner.changeBuyer(change.id)).rejects.toThrow("buyer_change_approval_required");
    x.setStatus("APPROVED");
    const provider = x.fetcher.getMockImplementation();
    x.fetcher.mockImplementation(async (url, init) => {
      if (new URL(String(url)).pathname.endsWith("/orders/ORDER1"))
        return Response.json({ ...x.order(), payer: { payer_id: newBuyer.buyerMerchantId } });
      if (!provider) throw new Error("fixture_missing");
      return provider(url, init);
    });
    await x.runner.resume(x.op.id);
    expect((await store.operation(x.op.id)).state).toBe("succeeded");
    expect((await x.next(x.op)).spec.payment?.context.buyerMerchantId).toBe(
      newBuyer.buyerMerchantId,
    );
    expect(
      x.fetcher.mock.calls.filter(
        ([, init]) =>
          init?.method === "POST" && String(init.body) !== "grant_type=client_credentials",
      ),
    ).toHaveLength(1);
  });

  it("P4 rejects the old buyer after applying a buyer change", async () => {
    const x = await paymentSetup();
    await x.dispatch(x.op);
    const change = await store.proposeBuyerChange(x.op.id, newBuyer);
    await store.approveBuyerChange(change.id, change.approvalHash);
    await x.runner.changeBuyer(change.id);
    x.setStatus("APPROVED");
    await x.runner.resume(x.op.id);
    expect((await store.operation(x.op.id)).state).toBe("inconclusive");
    await expect(x.next(x.op)).rejects.toThrow("payment_not_advanceable");
  });

  it("P4 refuses a buyer change when PayPal already records buyer approval", async () => {
    const x = await paymentSetup();
    await x.dispatch(x.op);
    const change = await store.proposeBuyerChange(x.op.id, newBuyer);
    await store.approveBuyerChange(change.id, change.approvalHash);
    x.setStatus("APPROVED");
    await expect(x.runner.changeBuyer(change.id)).rejects.toThrow(
      "buyer_change_order_not_unapproved",
    );
    expect((await store.operation(x.op.id)).payloadHash).toBe(x.op.payloadHash);
    expect((await store.buyerChange(change.id)).state).toBe("approved");
    await expect(x.runner.resume(x.op.id)).rejects.toThrow("buyer_change_pending");
  });

  it("P4 keeps buyer-change approval within the shared call cap", async () => {
    const x = await paymentSetup();
    await x.dispatch(x.op);
    const change = await store.proposeBuyerChange(x.op.id, newBuyer);
    await store.db.$client.unsafe("UPDATE sandbox_allocation SET consumed_calls = 50 - held_calls");
    const before = (await store.report(x.runId)).allocation;
    await expect(store.approveBuyerChange(change.id, change.approvalHash)).rejects.toThrow(
      "call_limit",
    );
    expect((await store.report(x.runId)).allocation).toEqual(before);
    expect((await store.buyerChange(change.id)).state).toBe("awaiting_approval");
  });

  it("P4 allows only one buyer change and rejects changes to the payment terms", async () => {
    const x = await paymentSetup();
    await x.dispatch(x.op);
    const change = await store.proposeBuyerChange(x.op.id, newBuyer);
    expect(await store.proposeBuyerChange(x.op.id, newBuyer)).toEqual(change);
    await expect(
      store.proposeBuyerChange(x.op.id, { ...newBuyer, principalCents: 1 }),
    ).rejects.toThrow();
    await expect(
      store.proposeBuyerChange(x.op.id, { ...newBuyer, buyerMerchantId: "BUYER00000003" }),
    ).rejects.toThrow("buyer_change_exists");
    await expect(
      store.proposeBuyerChange(x.op.id, { ...newBuyer, buyerMappingVersion: 1 }),
    ).rejects.toThrow("buyer_change_invalid");
  });

  it("P4 fences concurrent buyer-change workers and preserves stale claims", async () => {
    const x = await paymentSetup();
    await x.dispatch(x.op);
    const change = await store.proposeBuyerChange(x.op.id, newBuyer);
    await store.approveBuyerChange(change.id, change.approvalHash);
    const claim = await store.beginRecovery(x.op.id, change.id);
    await expect(x.runner.changeBuyer(change.id)).rejects.toThrow("claim_active");
    await store.db.$client.unsafe(
      "UPDATE sandbox_operation SET claim_until = now() - interval '1 second' WHERE id = $1",
      [x.op.id],
    );
    await expect(store.applyBuyerChange(claim, change.id, "ORDER1")).rejects.toThrow("stale_claim");
    const replacement = await store.beginRecovery(x.op.id, change.id);
    await expect(store.applyBuyerChange(claim, change.id, "ORDER1")).rejects.toThrow("stale_claim");
    await store.finishRecovery(replacement, { state: "inconclusive" });
    expect((await store.operation(x.op.id)).payloadHash).toBe(x.op.payloadHash);
  });

  it("P4 preserves used recovery counts and permits only two extra buyer-change reads", async () => {
    const x = await paymentSetup();
    await x.dispatch(x.op);
    await x.runner.resume(x.op.id);
    await x.runner.resume(x.op.id);
    await x.runner.resume(x.op.id);
    const change = await store.proposeBuyerChange(x.op.id, newBuyer);
    await store.approveBuyerChange(change.id, change.approvalHash);
    await x.runner.changeBuyer(change.id);
    expect((await store.operation(x.op.id)).recoveryReads).toBe(4);
    await x.runner.resume(x.op.id);
    await x.runner.resume(x.op.id);
    expect((await store.operation(x.op.id)).recoveryReads).toBe(6);
    await expect(x.runner.resume(x.op.id)).rejects.toThrow("payment_recovery_limit");
  });

  it("P4 refuses expired or already completed buyer changes", async () => {
    const x = await paymentSetup();
    await expect(store.proposeBuyerChange(x.op.id, newBuyer)).rejects.toThrow(
      "buyer_change_not_available",
    );
    await x.dispatch(x.op);
    const change = await store.proposeBuyerChange(x.op.id, newBuyer);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 86_400_000);
    try {
      await expect(store.approveBuyerChange(change.id, change.approvalHash)).rejects.toThrow(
        "buyer_change_not_available",
      );
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("P4 cannot reuse buyer-change approval after changing its recorded terms", async () => {
    const x = await paymentSetup();
    await x.dispatch(x.op);
    const change = await store.proposeBuyerChange(x.op.id, newBuyer);
    await store.db.$client.unsafe(
      "UPDATE sandbox_buyer_change SET target_spec = jsonb_set(target_spec, '{payment,context,principalCents}', '1'::jsonb) WHERE id = $1",
      [change.id],
    );
    await expect(store.approveBuyerChange(change.id, change.approvalHash)).rejects.toThrow();
    expect((await store.buyerChange(change.id)).state).toBe("awaiting_approval");
  });

  it("P4 never applies a buyer change when the authoritative read fails", async () => {
    const x = await paymentSetup();
    await x.dispatch(x.op);
    const change = await store.proposeBuyerChange(x.op.id, newBuyer);
    await store.approveBuyerChange(change.id, change.approvalHash);
    const before = (await store.report(x.runId)).allocation;
    x.fetcher.mockImplementation(async (url) => {
      if (String(url).endsWith("/token")) return token();
      throw new Error("lost-read");
    });
    await expect(x.runner.changeBuyer(change.id)).rejects.toThrow("sandbox_network");
    expect((await store.operation(x.op.id)).payloadHash).toBe(x.op.payloadHash);
    expect((await store.report(x.runId)).allocation).toEqual({
      ...before,
      consumedCalls: before.consumedCalls + 2,
      heldCalls: before.heldCalls - 2,
    });
    expect((await store.buyerChange(change.id)).state).toBe("approved");
  });

  it("P4 reserves the whole path and completes checkout, hold and confirmed capture after restart", async () => {
    const x = await paymentSetup();
    expect((await store.report(x.runId)).allocation).toMatchObject({
      reservedCents: 56,
      committedCents: 0,
      heldCalls: 38,
      consumedCalls: 4,
    });
    await x.runner.resume(x.op.id);
    expect(x.fetcher).not.toHaveBeenCalled();
    await x.dispatch(x.op);
    expect((await store.operation(x.op.id)).state).toBe("waiting_for_browser");
    const checkoutKey = (await store.paymentResource(x.op.commitmentId)).result.artifactKey;
    expect(
      await sandboxCli(["checkout-file", x.op.id], store, x.runner, x.artifacts),
    ).toMatchObject({
      buyer: "buyer",
      privateFile: x.artifacts.filePath(checkoutKey ?? ""),
    });
    x.setStatus("APPROVED");
    const reopened = new SandboxStore(await openSandboxTestDb(testUrl));
    try {
      await new SandboxRunner(
        reopened,
        credentials,
        paymentAdapters(reopened, x.artifacts, credentials.clientId),
        x.fetcher,
      ).resume(x.op.id);
    } finally {
      await reopened.db.$client.end();
    }
    const authorize = await x.next(x.op);
    await x.dispatch(authorize);
    expect((await store.operation(authorize.id)).state).toBe("succeeded");
    const capture = await x.next(authorize);
    await x.runner.resume(capture.id);
    expect((await store.operation(capture.id)).state).toBe("awaiting_approval");
    await x.dispatch(capture);
    expect((await store.operation(capture.id)).state).toBe("inconclusive");
    await x.runner.resume(capture.id);
    expect((await store.operation(capture.id)).state).toBe("succeeded");
    const report = await store.report(x.runId);
    expect(report.allocation).toMatchObject({
      committedCents: 56,
      reservedCents: 0,
      heldCalls: 0,
      consumedCalls: 21,
    });
    expect(report.payments?.[0]).toMatchObject({
      evidence: "captured_immediate",
      remainingCalls: 0,
    });
    expect(JSON.stringify(await store.inspect(x.runId))).not.toMatch(
      /ORDER1|AUTH1|CAPTURE1|BUYER00000001|SELLERA000001|FAKE_CLIENT|FAKE_BN/,
    );
    expect(
      x.fetcher.mock.calls.filter(
        ([, init]) =>
          init?.method === "POST" && String(init.body) !== "grant_type=client_credentials",
      ),
    ).toHaveLength(3);
  });

  it("P4 refuses writes without recorded successful P3 consent", async () => {
    const x = await paymentSetup(false);
    await x.dispatch(x.op);
    expect(x.fetcher).not.toHaveBeenCalled();
    expect((await store.operation(x.op.id)).state).toBe("inconclusive");
    expect((await store.report(x.runId)).allocation.reservedCents).toBe(56);
  });

  it("P4 blocks revoked seller permissions before the order write", async () => {
    const x = await paymentSetup();
    x.statusBody.payments_receivable = false;
    await x.dispatch(x.op);
    expect(
      x.fetcher.mock.calls.filter(
        ([, i]) => i?.method === "POST" && i.body !== "grant_type=client_credentials",
      ),
    ).toHaveLength(0);
    expect((await store.operation(x.op.id)).state).toBe("inconclusive");
  });

  it("P4 enforces global held calls against competing lifecycles", async () => {
    const x = await paymentSetup();
    await expect(
      prepared(
        paymentSpec({
          ...x.p.context,
          principalCents: 1,
          feeBounds: { create_order: 0, authorize_order: 0, capture_order: 0 },
        }),
      ),
    ).rejects.toThrow("call_limit");
    expect((await store.report(x.runId)).allocation.heldCalls).toBe(38);
  });

  it("P4 reserves all fees and rejects a second independent payment above the money cap", async () => {
    const x = await paymentSetup();
    await expect(prepared(paymentSpec({ ...x.p.context, principalCents: 50 }))).rejects.toThrow(
      "money_limit",
    );
    expect((await store.report(x.runId)).allocation.reservedCents).toBe(56);
  });

  it("P4 rejects capture before authorization and unrelated order references", async () => {
    const x = await paymentSetup();
    await x.dispatch(x.op);
    x.setStatus("APPROVED");
    await x.runner.resume(x.op.id);
    await expect(
      store.prepare(
        x.runId,
        randomUUID(),
        paymentSpec(x.p.context, x.input.commitmentId, "capture_order", {
          orderId: "ORDER1",
          authorizationId: "AUTH1",
        }),
      ),
    ).rejects.toThrow("payment_lineage");
    await expect(
      store.prepare(
        x.runId,
        randomUUID(),
        paymentSpec(x.p.context, x.input.commitmentId, "authorize_order", { orderId: "OTHER" }),
      ),
    ).rejects.toThrow("payment_lineage");
  });

  it("P4 rejects a changed request before authentication", async () => {
    const x = await paymentSetup();
    await store.db.$client.unsafe(
      "UPDATE sandbox_operation SET spec = jsonb_set(spec, '{request,body,intent}', '\"CAPTURE\"') WHERE id = $1",
      [x.op.id],
    );
    await store.approve(x.op.id, x.op.payloadHash, 1);
    await expect(x.runner.resume(x.op.id)).rejects.toThrow("payment_configuration");
    expect(x.fetcher).not.toHaveBeenCalled();
  });

  it("P4 browser polling consumes persisted recovery limits without another write", async () => {
    const x = await paymentSetup();
    await x.dispatch(x.op);
    for (let i = 0; i < 4; i++) await x.runner.resume(x.op.id);
    await expect(x.runner.resume(x.op.id)).rejects.toThrow("payment_recovery_limit");
    expect(
      x.fetcher.mock.calls.filter(
        ([, init]) => init?.method === "POST" && init.body !== "grant_type=client_credentials",
      ),
    ).toHaveLength(1);
  });

  it("P4 preserves an order reference when private checkout storage fails", async () => {
    const x = await paymentSetup();
    vi.spyOn(x.artifacts, "saveBrowserUrl").mockRejectedValueOnce(new Error("disk failure"));
    await x.dispatch(x.op);
    expect((await store.paymentResource(x.input.commitmentId)).result.orderId).toBe("ORDER1");
    x.setStatus("APPROVED");
    await x.runner.resume(x.op.id);
    expect((await store.operation(x.op.id)).state).toBe("succeeded");
    expect(
      x.fetcher.mock.calls.filter(
        ([, init]) => init?.method === "POST" && init.body !== "grant_type=client_credentials",
      ),
    ).toHaveLength(1);
  });

  it("P4 records a lost create response as inconclusive and never repeats the POST", async () => {
    const x = await paymentSetup();
    const original = x.fetcher.getMockImplementation();
    if (!original) throw new Error("missing_mock");
    x.fetcher.mockImplementation(async (url, init) => {
      if (String(url).endsWith("/v2/checkout/orders") && init?.method === "POST")
        throw new Error("PRIVATE_PROVIDER_DETAIL");
      return original(url, init);
    });
    await x.dispatch(x.op);
    await x.runner.resume(x.op.id);
    expect((await store.operation(x.op.id)).state).toBe("inconclusive");
    expect(
      x.fetcher.mock.calls.filter(
        ([url, init]) => String(url).endsWith("/v2/checkout/orders") && init?.method === "POST",
      ),
    ).toHaveLength(1);
    expect(JSON.stringify(await store.report(x.runId))).not.toContain("PRIVATE_PROVIDER_DETAIL");
  });

  it("P4 expires new writes without resetting calls or money reservations", async () => {
    const x = await paymentSetup();
    await store.approve(x.op.id, x.op.payloadHash, 1);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 3600001);
      await expect(x.runner.resume(x.op.id)).rejects.toThrow("payment_deadline");
      expect(x.fetcher).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
    expect((await store.report(x.runId)).allocation).toMatchObject({
      reservedCents: 56,
      heldCalls: 38,
    });
  });

  it("P4 pending capture remains pending and bounded recovery cannot reset", async () => {
    const x = await paymentSetup();
    await x.dispatch(x.op);
    x.setStatus("APPROVED");
    await x.runner.resume(x.op.id);
    const authorize = await x.next(x.op);
    await x.dispatch(authorize);
    const capture = await x.next(authorize);
    x.setCaptureStatus("PENDING");
    await x.dispatch(capture);
    await x.runner.resume(capture.id);
    await x.runner.resume(capture.id);
    await expect(x.runner.resume(capture.id)).rejects.toThrow("payment_recovery_limit");
    expect((await store.operation(capture.id)).state).toBe("inconclusive");
    expect((await store.paymentResource(x.input.commitmentId)).result.evidence).toBe("pending");
  });

  it("P4 concurrent workers cannot send the same payment write twice", async () => {
    const x = await paymentSetup();
    await store.approve(x.op.id, x.op.payloadHash, 1);
    await Promise.allSettled([x.runner.resume(x.op.id), x.runner.resume(x.op.id)]);
    expect(
      x.fetcher.mock.calls.filter(
        ([url, init]) => String(url).endsWith("/v2/checkout/orders") && init?.method === "POST",
      ),
    ).toHaveLength(1);
  });

  it("P4 prevents duplicate stages even with a changed resource key", async () => {
    const x = await paymentSetup();
    await x.dispatch(x.op);
    x.setStatus("APPROVED");
    await x.runner.resume(x.op.id);
    const authorize = await x.next(x.op);
    await expect(
      store.prepare(x.runId, randomUUID(), { ...authorize.spec, resourceKey: randomUUID() }),
    ).rejects.toThrow();
  });

  it("P4 recovers a lost authorization response with GETs and never reauthorizes", async () => {
    const x = await paymentSetup();
    await x.dispatch(x.op);
    x.setStatus("APPROVED");
    await x.runner.resume(x.op.id);
    const authorize = await x.next(x.op);
    const original = x.fetcher.getMockImplementation();
    if (!original) throw new Error("missing_mock");
    x.fetcher.mockImplementation(async (url, init) => {
      const response = await original(url, init);
      if (String(url).endsWith("/authorize") && init?.method === "POST")
        throw new Error("lost response");
      return response;
    });
    await x.dispatch(authorize);
    expect((await store.operation(authorize.id)).state).toBe("inconclusive");
    await x.runner.resume(authorize.id);
    expect((await store.operation(authorize.id)).state).toBe("succeeded");
    expect(
      x.fetcher.mock.calls.filter(
        ([url, init]) => String(url).endsWith("/authorize") && init?.method === "POST",
      ),
    ).toHaveLength(1);
  });

  it("P4 recovers capture from its order after losing the capture response", async () => {
    const x = await paymentSetup();
    await x.dispatch(x.op);
    x.setStatus("APPROVED");
    await x.runner.resume(x.op.id);
    const authorize = await x.next(x.op);
    await x.dispatch(authorize);
    const capture = await x.next(authorize);
    const original = x.fetcher.getMockImplementation();
    if (!original) throw new Error("missing_mock");
    x.fetcher.mockImplementation(async (url, init) => {
      if (String(url).endsWith("/capture") && init?.method === "POST")
        throw new Error("lost response");
      return original(url, init);
    });
    await x.dispatch(capture);
    await x.runner.resume(capture.id);
    expect((await store.operation(capture.id)).state).toBe("succeeded");
    expect(
      x.fetcher.mock.calls.filter(
        ([url, init]) => String(url).endsWith("/capture") && init?.method === "POST",
      ),
    ).toHaveLength(1);
  });

  it("P4 rechecks revoked grants after buyer consent before authorization", async () => {
    const x = await paymentSetup();
    await x.dispatch(x.op);
    x.setStatus("APPROVED");
    await x.runner.resume(x.op.id);
    const authorize = await x.next(x.op);
    x.statusBody.payments_receivable = false;
    await x.dispatch(authorize);
    expect((await store.operation(authorize.id)).state).toBe("inconclusive");
    expect(
      x.fetcher.mock.calls.some(
        ([url, init]) => String(url).endsWith("/authorize") && init?.method === "POST",
      ),
    ).toBe(false);
  });

  it("P4 blocks an expired provider authorization before capture", async () => {
    const x = await paymentSetup();
    await x.dispatch(x.op);
    x.setStatus("APPROVED");
    await x.runner.resume(x.op.id);
    const authorize = await x.next(x.op);
    await x.dispatch(authorize);
    const capture = await x.next(authorize);
    x.authorization.expiration_time = new Date(Date.now() - 1).toISOString();
    await x.dispatch(capture);
    expect(
      x.fetcher.mock.calls.some(
        ([url, init]) => String(url).endsWith("/capture") && init?.method === "POST",
      ),
    ).toBe(false);
    expect((await store.operation(capture.id)).state).toBe("inconclusive");
  });

  it("P4 rejects changed mapping and fee context for a later stage", async () => {
    const x = await paymentSetup();
    await x.dispatch(x.op);
    x.setStatus("APPROVED");
    await x.runner.resume(x.op.id);
    for (const change of [
      { buyerMappingVersion: 2 },
      { feeBounds: { ...x.p.context.feeBounds, authorize_order: 0 } },
    ]) {
      await expect(
        store.prepare(
          x.runId,
          randomUUID(),
          paymentSpec({ ...x.p.context, ...change }, x.input.commitmentId, "authorize_order", {
            orderId: "ORDER1",
          }),
        ),
      ).rejects.toThrow("payment_lineage");
    }
  });

  it("P4 enforces freshness again at the dispatch boundary", async () => {
    const x = await paymentSetup();
    await store.approve(x.op.id, x.op.payloadHash, 1);
    const claim = await store.claim(x.op.id);
    await expect(store.markDispatch(claim)).rejects.toThrow("payment_not_ready");
    await store.recordPaymentReadiness(claim);
    await store.db.$client.unsafe(
      "UPDATE sandbox_payment SET readiness_at = now() - interval '16 minutes' WHERE commitment_id = $1",
      [x.input.commitmentId],
    );
    await expect(store.markDispatch(claim)).rejects.toThrow("payment_not_ready");
    expect(x.fetcher).not.toHaveBeenCalled();
  });

  it.each(["oauth", "status", "readiness"])(
    "F0 retries undispatched payment: %s",
    async (failure) => {
      const x = await paymentSetup();
      const original = x.fetcher.getMockImplementation();
      if (!original) throw new Error("missing_mock");
      x.fetcher.mockImplementation(async (url, init) => {
        if (failure === "oauth" && String(url).endsWith("/token"))
          return new Response(null, { status: 503 });
        if (failure === "status" && String(url).includes("/merchant-integrations/"))
          return new Response(null, { status: 503 });
        return original(url, init);
      });
      if (failure === "readiness") x.statusBody.payments_receivable = false;
      await x.dispatch(x.op);
      const before = (await store.report(x.runId)).allocation;
      await sandboxCli(["retry-undispatched", x.op.id], store, x.runner);
      expect(await store.operation(x.op.id)).toMatchObject({
        state: "awaiting_approval",
        requestId: x.op.requestId,
        payloadHash: x.op.payloadHash,
      });
      expect((await store.report(x.runId)).allocation).toEqual(before);
      await expect(store.approve(x.op.id, x.op.payloadHash, 1)).rejects.toThrow(
        "approval_mismatch",
      );
      x.fetcher.mockImplementation(original);
      x.statusBody.payments_receivable = true;
      await x.runner.resume(x.op.id);
      expect((await store.operation(x.op.id)).state).toBe("awaiting_approval");
      await store.approve(x.op.id, x.op.payloadHash, 2);
      await x.runner.resume(x.op.id);
      expect((await store.operation(x.op.id)).state).toBe("waiting_for_browser");
      expect(
        x.fetcher.mock.calls.filter(
          ([, init]) => init?.method === "POST" && init.body !== "grant_type=client_credentials",
        ),
      ).toHaveLength(1);
    },
  );

  it.each([0, 1, 2])("F0 reclaims referral recovery after %i issued reads", async (issued) => {
    const x = await onboardingSetup(6);
    await store.approve(x.op.id, x.op.payloadHash, 1);
    x.fetcher.mockImplementation(async (url, init) => {
      if (String(url).endsWith("/token")) return token();
      if (init?.method === "POST") throw new Error("lost response");
      return Response.json({
        ...x.referralBody,
        partner_referral_id: "FAKE_REF",
        submitter_client_id: x.context.platformClientId,
        referral_data: { tracking_id: x.context.trackingId },
      });
    });
    await x.runner.resume(x.op.id);
    const proposal = await store.proposeReferralRecovery(x.op.id, "FAKE_REF");
    await store.approveReferralRecovery(proposal.id, proposal.approvalHash);
    const stale = await store.beginReferralRecovery(proposal.id);
    for (const kind of (["oauth", "recovery"] as const).slice(0, issued)) {
      const id = await store.reserveClaimRequest(stale, kind);
      await store.finishRequest(id, true);
    }
    await store.db
      .$client`UPDATE sandbox_operation SET claim_until = now() - interval '1 second' WHERE id = ${x.op.id}`;
    const before = (await store.report(x.runId)).allocation;
    if (issued > 0) {
      await expect(
        sandboxCli(["apply-referral-recovery", proposal.id], store, x.runner),
      ).rejects.toThrow("referral_recovery_reapproval_required");
      expect((await store.report(x.runId)).allocation.consumedCalls).toBe(before.consumedCalls);
      await store.approveReferralRecovery(proposal.id, proposal.approvalHash);
    }
    await sandboxCli(["apply-referral-recovery", proposal.id], store, x.runner);
    expect((await store.operation(x.op.id)).state).toBe("waiting_for_browser");
    await expect(store.failReferralRecovery(stale, proposal.id)).rejects.toThrow("stale_claim");
    await expect(store.reserveClaimRequest(stale, "oauth")).rejects.toThrow("stale_claim");
    await expect(
      store.finishReferralRecovery(stale, proposal.id, { state: "inconclusive" }),
    ).rejects.toThrow("stale_claim");
    expect((await store.report(x.runId)).allocation.consumedCalls).toBe(before.consumedCalls + 2);
    expect(
      x.fetcher.mock.calls.filter(
        ([, init]) => init?.method === "POST" && String(init.body).includes("tracking_id"),
      ),
    ).toHaveLength(1);
  });

  it.each([false, true])(
    "review F0 offers replayable void cleanup, lost response: %s",
    async (lost) => {
      const x = await paymentSetup();
      await x.dispatch(x.op);
      x.setStatus("APPROVED");
      await x.runner.resume(x.op.id);
      const authorize = await x.next(x.op);
      await x.dispatch(authorize);
      const capture = await x.next(authorize);
      x.statusBody.payments_receivable = false;
      await x.dispatch(capture);
      await sandboxCli(["retry-undispatched", capture.id], store, x.runner);
      const input = join(x.directory, "void.json");
      await writeFile(input, JSON.stringify({ feeBoundCents: 0 }));
      const [prepared, concurrent] = (await Promise.all([
        sandboxCli(["prepare-void", authorize.id, input], store, x.runner),
        sandboxCli(["prepare-void", authorize.id, input], store, x.runner),
      ])) as { operationId: string }[];
      if (!prepared) throw new Error("missing_cleanup");
      expect(concurrent?.operationId).toBe(prepared.operationId);
      const cleanup = await store.operation(prepared.operationId);
      expect(cleanup.state).toBe("awaiting_approval");
      expect(
        (await store.inspect(x.runId)).approvals.find((a) => a.operationId === cleanup.id)?.payment,
      ).toMatchObject({ cleanupCalls: 12, cleanupFeeBoundCents: 0 });
      const beforeReplay = await store.report(x.runId);
      const replay = (await sandboxCli(["prepare-void", authorize.id, input], store, x.runner)) as {
        operationId: string;
      };
      expect(replay.operationId).toBe(cleanup.id);
      expect(await store.report(x.runId)).toEqual(beforeReplay);
      await writeFile(input, JSON.stringify({ feeBoundCents: 1 }));
      await expect(
        sandboxCli(["prepare-void", authorize.id, input], store, x.runner),
      ).rejects.toThrow("cleanup_identity_conflict");
      await writeFile(input, JSON.stringify({ feeBoundCents: 0 }));
      const original = x.fetcher.getMockImplementation();
      if (!original) throw new Error("missing_mock");
      x.fetcher.mockImplementation(async (url, init) => {
        if (String(url).endsWith("/void") && init?.method === "POST") {
          x.authorization.status = "VOIDED";
          if (lost) throw new Error("lost void response");
          return new Response(null, { status: 204 });
        }
        if (String(url).endsWith("/checkout/orders/ORDER1") && init?.method === "GET") {
          const order = x.order();
          const unit = order.purchase_units[0];
          if (unit?.payments) unit.payments.captures = [];
          return Response.json(order);
        }
        return original(url, init);
      });
      await x.runner.resume(cleanup.id);
      expect(x.authorization.status).toBe("CREATED");
      await x.dispatch(cleanup);
      expect((await store.operation(cleanup.id)).state).toBe("inconclusive");
      await x.runner.resume(cleanup.id);
      expect((await store.operation(cleanup.id)).state).toBe("succeeded");
      expect((await store.paymentResource(x.op.commitmentId)).result.evidence).toBe("voided");
      const terminalReplay = (await sandboxCli(
        ["prepare-void", authorize.id, input],
        store,
        x.runner,
      )) as { operationId: string };
      expect(terminalReplay.operationId).toBe(cleanup.id);
      expect((await store.operation(cleanup.id)).state).toBe("succeeded");
      expect((await store.report(x.runId)).allocation).toMatchObject({
        reservedCents: 3,
        committedCents: 53,
        heldCalls: 0,
      });
      await expect(store.approve(capture.id, capture.payloadHash, 2)).rejects.toThrow(
        "payment_cleanup_pending",
      );
      expect(
        x.fetcher.mock.calls.filter(
          ([url, init]) => String(url).endsWith("/void") && init?.method === "POST",
        ),
      ).toHaveLength(1);
      expect(
        x.fetcher.mock.calls.some(
          ([url, init]) => String(url).endsWith("/capture") && init?.method === "POST",
        ),
      ).toBe(false);
    },
  );

  it("F0 fences a crashed undispatched worker and never reuses its approval", async () => {
    const { runId, op } = await approved();
    const stale = await store.claim(op.id);
    await expect(
      sandboxCli(
        ["retry-undispatched", op.id],
        store,
        new SandboxRunner(store, credentials, [adapter()]),
      ),
    ).rejects.toThrow("undispatched_retry_not_available");
    await store.db
      .$client`UPDATE sandbox_operation SET claim_until = now() - interval '1 second' WHERE id = ${op.id}`;
    await store.retryUndispatched(op.id);
    await expect(store.markDispatch(stale)).rejects.toThrow("claim_expired");
    await expect(store.finish(stale, { state: "succeeded" })).rejects.toThrow("stale_claim");
    await expect(store.approve(op.id, op.payloadHash, 1)).rejects.toThrow("approval_mismatch");
    expect((await store.report(runId)).allocation).toMatchObject({
      consumedCalls: 1,
      heldCalls: 0,
      reservedCents: 11,
    });
    await store.approve(op.id, op.payloadHash, 2);
    const current = await store.claim(op.id);
    expect(current.token).not.toBe(stale.token);
    expect(current.operation.requestId).toBe(stale.operation.requestId);
  });

  it("F0 only one referral worker can reclaim an unused expired lease", async () => {
    const x = await onboardingSetup(6);
    await store.approve(x.op.id, x.op.payloadHash, 1);
    x.fetcher.mockImplementation(async (url) =>
      String(url).endsWith("/token") ? token() : new Response(null, { status: 503 }),
    );
    await x.runner.resume(x.op.id);
    const proposal = await store.proposeReferralRecovery(x.op.id, "FAKE_REF");
    await store.approveReferralRecovery(proposal.id, proposal.approvalHash);
    const stale = await store.beginReferralRecovery(proposal.id);
    await expect(store.beginReferralRecovery(proposal.id)).rejects.toThrow("claim_active");
    await store.db
      .$client`UPDATE sandbox_operation SET claim_until = now() - interval '1 second' WHERE id = ${x.op.id}`;
    const before = (await store.report(x.runId)).allocation;
    const claims = await Promise.allSettled([
      store.beginReferralRecovery(proposal.id),
      store.beginReferralRecovery(proposal.id),
    ]);
    expect(claims.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await store.report(x.runId)).allocation).toEqual(before);
    await expect(store.failReferralRecovery(stale, proposal.id)).rejects.toThrow("stale_claim");
  });

  it("F0 referral reclaim rejects altered approval identity without releasing reservations", async () => {
    const x = await onboardingSetup(6);
    await store.approve(x.op.id, x.op.payloadHash, 1);
    x.fetcher.mockImplementation(async (url) =>
      String(url).endsWith("/token") ? token() : new Response(null, { status: 503 }),
    );
    await x.runner.resume(x.op.id);
    const proposal = await store.proposeReferralRecovery(x.op.id, "FAKE_REF");
    await store.approveReferralRecovery(proposal.id, proposal.approvalHash);
    const stale = await store.beginReferralRecovery(proposal.id);
    const issued = await store.reserveClaimRequest(stale, "oauth");
    await store.finishRequest(issued, true);
    await store.db
      .$client`UPDATE sandbox_operation SET claim_until = now() - interval '1 second' WHERE id = ${x.op.id}`;
    await store.db
      .$client`UPDATE sandbox_referral_recovery SET referral_id = 'OTHER' WHERE id = ${proposal.id}`;
    const before = (await store.report(x.runId)).allocation;
    await expect(x.runner.recoverReferral(proposal.id)).rejects.toThrow("referral_recovery_stale");
    expect((await store.report(x.runId)).allocation).toEqual(before);
  });

  it("F0 fresh referral approval cannot replenish the exhausted global allowance", async () => {
    const x = await onboardingSetup(6);
    await store.approve(x.op.id, x.op.payloadHash, 1);
    x.fetcher.mockImplementation(async (url) =>
      String(url).endsWith("/token") ? token() : new Response(null, { status: 503 }),
    );
    await x.runner.resume(x.op.id);
    const proposal = await store.proposeReferralRecovery(x.op.id, "FAKE_REF");
    await store.approveReferralRecovery(proposal.id, proposal.approvalHash);
    const stale = await store.beginReferralRecovery(proposal.id);
    await store.reserveClaimRequest(stale, "oauth");
    await store.db
      .$client`UPDATE sandbox_operation SET claim_until = now() - interval '1 second' WHERE id = ${x.op.id}`;
    await expect(x.runner.recoverReferral(proposal.id)).rejects.toThrow(
      "referral_recovery_reapproval_required",
    );
    await store.db
      .$client`UPDATE sandbox_allocation SET consumed_calls = 50 - held_calls WHERE id = 1`;
    const before = (await store.report(x.runId)).allocation;
    await expect(store.approveReferralRecovery(proposal.id, proposal.approvalHash)).rejects.toThrow(
      "call_limit",
    );
    expect((await store.report(x.runId)).allocation).toEqual(before);
  });

  it("F0 refuses retry after any business dispatch, even after a lost response", async () => {
    const x = await paymentSetup();
    const original = x.fetcher.getMockImplementation();
    if (!original) throw new Error("missing_mock");
    x.fetcher.mockImplementation(async (url, init) => {
      if (String(url).endsWith("/checkout/orders") && init?.method === "POST")
        throw new Error("lost response");
      return original(url, init);
    });
    await x.dispatch(x.op);
    const before = await store.report(x.runId);
    await expect(sandboxCli(["retry-undispatched", x.op.id], store, x.runner)).rejects.toThrow(
      "operation_may_have_dispatched",
    );
    expect(await store.report(x.runId)).toEqual(before);
  });

  it("F0 rejects tampered requests and cannot reset the shared retry call cap", async () => {
    const { runId, op } = await approved();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
    const runner = new SandboxRunner(store, credentials, [adapter()], fetcher);
    await runner.resume(op.id);
    await store.db
      .$client`UPDATE sandbox_operation SET spec = jsonb_set(spec, '{request,body}', '{"changed":true}') WHERE id = ${op.id}`;
    await expect(store.retryUndispatched(op.id)).rejects.toThrow("payload_changed");
    await store.db.$client.unsafe("UPDATE sandbox_operation SET spec = $1 WHERE id = $2", [
      JSON.stringify(op.spec),
      op.id,
    ]);
    await store.db.$client`UPDATE sandbox_allocation SET consumed_calls = 47 WHERE id = 1`;
    await store.retryUndispatched(op.id);
    await store.approve(op.id, op.payloadHash, 2);
    await expect(runner.resume(op.id)).rejects.toThrow("call_limit");
    expect((await store.report(runId)).allocation.consumedCalls).toBe(47);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("F0 reapproves a dispatch-boundary readiness failure without dispatching a write", async () => {
    const x = await paymentSetup();
    const record = store.recordPaymentReadiness.bind(store);
    const spy = vi.spyOn(store, "recordPaymentReadiness").mockImplementation(async (claim) => {
      await record(claim);
      await store.db
        .$client`UPDATE sandbox_payment SET readiness_at = now() - interval '16 minutes' WHERE commitment_id = ${x.op.commitmentId}`;
    });
    try {
      await x.dispatch(x.op);
    } finally {
      spy.mockRestore();
    }
    await sandboxCli(["retry-undispatched", x.op.id], store, x.runner);
    await store.approve(x.op.id, x.op.payloadHash, 2);
    await x.runner.resume(x.op.id);
    expect((await store.operation(x.op.id)).state).toBe("waiting_for_browser");
    expect(
      x.fetcher.mock.calls.filter(
        ([, init]) => init?.method === "POST" && init.body !== "grant_type=client_credentials",
      ),
    ).toHaveLength(1);
  });

  it("F0 blocks cleanup after an ambiguous capture and never creates a replacement", async () => {
    const x = await paymentSetup();
    await x.dispatch(x.op);
    x.setStatus("APPROVED");
    await x.runner.resume(x.op.id);
    const authorize = await x.next(x.op);
    await x.dispatch(authorize);
    const capture = await x.next(authorize);
    const original = x.fetcher.getMockImplementation();
    if (!original) throw new Error("missing_mock");
    x.fetcher.mockImplementation(async (url, init) => {
      const response = await original(url, init);
      if (String(url).endsWith("/capture") && init?.method === "POST")
        throw new Error("lost capture response");
      return response;
    });
    await x.dispatch(capture);
    const input = join(x.directory, "void.json");
    await writeFile(input, JSON.stringify({ feeBoundCents: 0 }));
    const before = await store.report(x.runId);
    await expect(
      sandboxCli(["prepare-void", authorize.id, input], store, x.runner),
    ).rejects.toThrow("cleanup_not_available");
    expect(await store.report(x.runId)).toEqual(before);
    expect(x.fetcher.mock.calls.some(([url]) => String(url).endsWith("/void"))).toBe(false);
  });

  it("F0 permits cleanup within recovery time without extending an expired capture deadline", async () => {
    const x = await paymentSetup();
    await x.dispatch(x.op);
    x.setStatus("APPROVED");
    await x.runner.resume(x.op.id);
    const authorize = await x.next(x.op);
    await x.dispatch(authorize);
    const capture = await x.next(authorize);
    x.statusBody.payments_receivable = false;
    await x.dispatch(capture);
    const input = join(x.directory, "void.json");
    await writeFile(input, JSON.stringify({ feeBoundCents: 0 }));
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse(x.p.context.executeUntil) + 1);
    try {
      await sandboxCli(["retry-undispatched", capture.id], store, x.runner);
      await store.approve(capture.id, capture.payloadHash, 2);
      await expect(x.runner.resume(capture.id)).rejects.toThrow("payment_deadline");
      const prepared = (await sandboxCli(
        ["prepare-void", authorize.id, input],
        store,
        x.runner,
      )) as { operationId: string };
      const cleanup = await store.operation(prepared.operationId);
      expect(cleanup.spec.payment?.context.executeUntil).toBe(x.p.context.executeUntil);
      expect(cleanup.state).toBe("awaiting_approval");
    } finally {
      clock.mockRestore();
    }
  });

  it("review active leases ignore an application clock running ahead", async () => {
    const { op } = await approved();
    await store.claim(op.id);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 120_000);
    try {
      await expect(store.retryUndispatched(op.id)).rejects.toThrow(
        "undispatched_retry_not_available",
      );
    } finally {
      clock.mockRestore();
    }
    expect((await store.operation(op.id)).state).toBe("dispatching");
  });

  it("review expired leases ignore an application clock running behind", async () => {
    const { op } = await approved();
    await store.claim(op.id);
    await store.db
      .$client`UPDATE sandbox_operation SET claim_until = now() - interval '1 second' WHERE id = ${op.id}`;
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() - 120_000);
    try {
      await store.retryUndispatched(op.id);
    } finally {
      clock.mockRestore();
    }
    expect((await store.operation(op.id)).state).toBe("awaiting_approval");
  });

  it("review referral settlement uses the database lease clock", async () => {
    const x = await onboardingSetup(6);
    await store.approve(x.op.id, x.op.payloadHash, 1);
    x.fetcher.mockImplementation(async (url, init) => {
      if (String(url).endsWith("/token")) return token();
      if (init?.method === "POST") throw new Error("lost response");
      return Response.json({
        ...x.referralBody,
        partner_referral_id: "FAKE_REF",
        submitter_client_id: x.context.platformClientId,
        referral_data: { tracking_id: x.context.trackingId },
      });
    });
    await x.runner.resume(x.op.id);
    const proposal = await store.proposeReferralRecovery(x.op.id, "FAKE_REF");
    await store.approveReferralRecovery(proposal.id, proposal.approvalHash);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 120_000);
    try {
      await x.runner.recoverReferral(proposal.id);
    } finally {
      clock.mockRestore();
    }
    expect((await store.operation(x.op.id)).state).toBe("waiting_for_browser");
  });

  it("CLI prepare, inspect, approve and report remain offline", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tranche-p2-cli-"));
    try {
      const input = join(directory, "spec.json");
      await writeFile(input, JSON.stringify(spec()));
      const fetcher = vi.fn<typeof fetch>();
      const runner = new SandboxRunner(store, credentials, [], fetcher);
      const result = (await sandboxCli(["start", input], store, runner)) as {
        runId: string;
        approval: { operationId: string; payloadHash: string; nextAttempt: number };
      };
      await sandboxCli(["inspect", result.runId], store, runner);
      await sandboxCli(
        [
          "approve",
          result.approval.operationId,
          result.approval.payloadHash,
          String(result.approval.nextAttempt),
        ],
        store,
        runner,
      );
      const report = await sandboxCli(["report", result.runId], store, runner);
      expect(JSON.stringify(report)).not.toContain("PRIVATE_PAYLOAD");
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await removeTestDirectory(directory);
    }
  });
});
