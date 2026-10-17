import { type SandboxOperationSpec, SandboxOutcome } from "@tranche/contracts";
import {
  type DispatchClaim,
  type SandboxStore,
  type StoredOperation,
  sandboxPayloadHash,
} from "@tranche/db";
import {
  onboardingStatusRequest,
  paymentRead,
  SandboxClient,
  type SandboxRequest,
  verifyBuyerChangeOrder,
  verifyOnboarding,
} from "@tranche/paypal";

export interface SandboxAdapter {
  kind: SandboxOperationSpec["kind"];
  validate(spec: SandboxOperationSpec): void;
  prepare(operation: StoredOperation): SandboxRequest;
  beforeWrite?(
    operation: StoredOperation,
    read: (request: SandboxRequest) => Promise<unknown>,
    claim: DispatchClaim,
  ): Promise<void>;
  interpret(body: unknown, operation: StoredOperation): Promise<unknown>;
  recoverReferral?(body: unknown, operation: StoredOperation, expectedId: string): Promise<unknown>;
  failure?(error: unknown): unknown;
  recover(
    operation: StoredOperation,
    read: (request: SandboxRequest) => Promise<unknown>,
    options?: { refreshConsent?: boolean },
  ): Promise<unknown>;
}

async function bounded<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  let abort: (() => void) | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error("execution_deadline"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    signal.throwIfAborted();
    return await Promise.race([work(), expired]);
  } finally {
    if (abort) signal.removeEventListener("abort", abort);
  }
}

export class SandboxRunner {
  constructor(
    private readonly store: SandboxStore,
    private readonly credentials: { environment: string; clientId: string; clientSecret: string },
    private readonly adapters: readonly SandboxAdapter[],
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private adapter(op: StoredOperation): SandboxAdapter {
    const adapter = this.adapters.find((a) => a.kind === op.spec.kind);
    if (!adapter) throw new Error("adapter_unavailable");
    adapter.validate(op.spec);
    return adapter;
  }

  private client(claim: DispatchClaim): SandboxClient {
    return new SandboxClient(
      this.credentials,
      {
        reserve: (kind) => this.store.reserveClaimRequest(claim, kind),
        finish: (id, success) => this.store.finishRequest(id, success),
      },
      this.fetcher,
    );
  }

  async changeBuyer(id: string): Promise<void> {
    const change = await this.store.buyerChange(id);
    if (change.state !== "approved") throw new Error("buyer_change_approval_required");
    const op = await this.store.operation(change.operationId);
    this.adapter(op);
    const claim = await this.store.beginRecovery(op.id, id);
    try {
      const p = claim.operation.spec.payment;
      if (!p) throw new Error("payment_context_required");
      const signal = AbortSignal.timeout(30_000);
      const body = await this.client(claim).request(
        paymentRead({ ...p, orderId: change.orderId }, "order"),
        { recovery: true, signal },
      );
      const order = verifyBuyerChangeOrder(
        body,
        { ...p, orderId: change.orderId },
        op.commitmentId,
      );
      await this.store.applyBuyerChange(claim, id, order.id);
    } catch (error) {
      await this.store.finishRecovery(claim, { state: "inconclusive" });
      throw error;
    }
  }

  async maintain(id: string): Promise<void> {
    const row = await this.store.maintenanceRecord(id);
    const op = await this.store.operation(row.operationId);
    this.adapter(op);
    const claim = await this.store.beginMaintenance(id);
    try {
      const signal = AbortSignal.timeout(30_000);
      if (row.input.kind === "onboarding_product") {
        const context = row.targetContext;
        if (!context) throw new Error("product_change_invalid");
        const body = await this.client(claim).request(onboardingStatusRequest(context), {
          recovery: true,
          signal,
        });
        const evidence = verifyOnboarding(body, context);
        if (evidence.status !== "consent_verified") throw new Error("product_not_ready");
        await this.store.finishMaintenance(claim, id, evidence);
      } else {
        const p = op.spec.payment;
        if (!p || !row.orderId) throw new Error("retirement_not_available");
        const body = await this.client(claim).request(
          paymentRead({ ...p, orderId: row.orderId }, "order"),
          { recovery: true, signal },
        );
        verifyBuyerChangeOrder(body, { ...p, orderId: row.orderId }, op.commitmentId);
        await this.store.finishMaintenance(claim, id, body);
      }
    } catch (error) {
      await this.store.failMaintenance(claim, id);
      throw error;
    }
  }

  async recoverReferral(id: string): Promise<void> {
    const row = await this.store.referralRecovery(id);
    const op = await this.store.operation(row.operationId);
    const recover = this.adapter(op).recoverReferral;
    if (!recover || !op.spec.onboarding) throw new Error("referral_recovery_unavailable");
    if (await this.store.finalizeOnboardingExpiry(op.id))
      throw new Error("onboarding_recovery_limit");
    const claim = await this.store.beginReferralRecovery(id);
    try {
      const body = await this.client(claim).request(
        {
          method: "GET",
          partner: op.spec.onboarding.partner,
          path: `/v2/customer/partner-referrals/${encodeURIComponent(row.referralId)}`,
        },
        { recovery: true, signal: AbortSignal.timeout(30_000) },
      );
      const outcome = await recover(body, op, row.referralId);
      await this.store.finishReferralRecovery(claim, id, outcome);
    } catch (error) {
      await this.store.failReferralRecovery(claim, id);
      throw error;
    }
  }

  async resume(operationId: string, options: { refreshConsent?: boolean } = {}): Promise<void> {
    if (await this.store.finalizeOnboardingExpiry(operationId))
      throw new Error("onboarding_recovery_limit");
    const op = await this.store.operation(operationId);
    if (["succeeded", "failed", "blocked", "awaiting_approval"].includes(op.state)) return;
    const adapter = this.adapter(op);
    if (op.state === "ready") {
      if (options.refreshConsent) throw new Error("not_recoverable");
      const request = adapter.prepare(op);
      if (sandboxPayloadHash(request) !== sandboxPayloadHash(op.spec.request))
        throw new Error("request_changed");
      if (request.method !== (op.spec.kind === "read_status" ? "GET" : "POST"))
        throw new Error("adapter_method");
      const claim = await this.store.claim(op.id);
      const client = this.client(claim);
      let outcome: unknown;
      try {
        const signal = AbortSignal.timeout(45_000);
        const beforeWrite = adapter.beforeWrite;
        if (beforeWrite)
          await bounded(signal, () =>
            beforeWrite(
              claim.operation,
              (request) => {
                if (request.method !== "GET") throw new Error("preflight_read_only");
                return client.request(request, { signal });
              },
              claim,
            ),
          );
        const body = await client.request(request, {
          permit: {
            requestId: claim.operation.requestId,
            beforeDispatch: () => this.store.markDispatch(claim),
          },
          signal,
        });
        outcome = SandboxOutcome.parse(
          await bounded(signal, () => adapter.interpret(body, claim.operation)),
        );
      } catch (error) {
        outcome = SandboxOutcome.parse(adapter.failure?.(error) ?? { state: "inconclusive" });
      }
      await this.store.finish(claim, outcome);
      return;
    }
    const claim: DispatchClaim = await this.store.beginRecovery(op.id);
    const client = this.client(claim);
    const deadline = Date.now() + 30_000;
    const signal = AbortSignal.timeout(30_000);
    let remaining = op.spec.recoveryCalls;
    let outcome: unknown;
    try {
      outcome = SandboxOutcome.parse(
        await bounded(signal, () =>
          adapter.recover(
            claim.operation,
            async (request) => {
              if (request.method !== "GET" || remaining-- <= 0 || Date.now() >= deadline)
                throw new Error("recovery_bound");
              return client.request(request, { recovery: true, signal });
            },
            options,
          ),
        ),
      );
    } catch (error) {
      outcome = SandboxOutcome.parse(adapter.failure?.(error) ?? { state: "inconclusive" });
    }
    await this.store.finishRecovery(claim, outcome);
  }
}
