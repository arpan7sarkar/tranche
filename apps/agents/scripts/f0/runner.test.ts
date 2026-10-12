import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { SandboxOperationSpec } from "@tranche/contracts";
import { createSandboxStore, type SandboxStore } from "@tranche/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
