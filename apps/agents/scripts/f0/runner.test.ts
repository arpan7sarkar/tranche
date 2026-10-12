import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { SandboxOperationSpec } from "@tranche/contracts";
import { createSandboxStore, type SandboxStore } from "@tranche/db";
import { onboardingSpec } from "@tranche/paypal";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { onboardingAdapter } from "./adapters";
import { sandboxCli } from "./index";
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
if (testUrl) {
  const url = new URL(testUrl);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.port !== "55432" ||
    url.pathname !== "/tranche_p2_test"
  ) {
    throw new Error("Use only the disposable local tranche_p2_test database on port 55432");
  }
}

describe.skipIf(!testUrl)("P2 disposable PostgreSQL runner integration", () => {
  let store: SandboxStore;
  const onboardingDirectories: string[] = [];
  beforeAll(() => {
    store = createSandboxStore(testUrl);
  });
  beforeEach(async () => {
    await store.db.$client.unsafe(
      "TRUNCATE sandbox_browser_wait, sandbox_attempt, sandbox_approval, sandbox_operation, sandbox_commitment, sandbox_run, sandbox_allocation CASCADE",
    );
  });
  afterAll(async () => {
    await store.db.$client.end();
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

  async function onboardingSetup(recoveryCalls = 4) {
    const context = {
      seller: "seller-a",
      platformMerchantId: "PLATFORM00001",
      sellerMerchantId: "SELLERA000001",
      platformClientId: credentials.clientId,
      mappingVersion: 1,
      trackingId: randomUUID(),
      partner: { attributionId: "FAKE_BN" },
      product: "EXPRESS_CHECKOUT",
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
      products: [{ name: context.product, status: "ACTIVE" }],
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
    const reopened = createSandboxStore(testUrl);
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

  it("P3 prevents duplicate sellers or tracking IDs across runs and mapping changes", async () => {
    const x = await onboardingSetup();
    const runId = await store.start();
    for (const context of [
      { ...x.context, trackingId: randomUUID(), mappingVersion: 2 },
      { ...x.context, seller: "seller-b", sellerMerchantId: "SELLERB000001" },
    ])
      await expect(
        store.prepare(runId, randomUUID(), onboardingSpec({ context, recoveryCalls: 4 })),
      ).rejects.toThrow();
    expect((await store.report(runId)).operations).toHaveLength(0);
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
    await Promise.allSettled([x.runner.resume(x.op.id), x.runner.resume(x.op.id)]);
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
    const reopened = createSandboxStore(testUrl);
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
    const restarted = createSandboxStore(testUrl);
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
    const reopened = createSandboxStore(testUrl);
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
