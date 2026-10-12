import { type SandboxOperationSpec, SandboxOutcome } from "@tranche/contracts";
import {
  type DispatchClaim,
  type SandboxStore,
  type StoredOperation,
  sandboxPayloadHash,
} from "@tranche/db";
import { SandboxClient, type SandboxRequest } from "@tranche/paypal";

export interface SandboxAdapter {
  kind: SandboxOperationSpec["kind"];
  validate(spec: SandboxOperationSpec): void;
  prepare(operation: StoredOperation): SandboxRequest;
  interpret(body: unknown, operation: StoredOperation): Promise<unknown>;
  recover(
    operation: StoredOperation,
    read: (request: SandboxRequest) => Promise<unknown>,
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

  async resume(operationId: string): Promise<void> {
    const op = await this.store.operation(operationId);
    if (["succeeded", "failed", "blocked", "awaiting_approval"].includes(op.state)) return;
    const adapter = this.adapter(op);
    if (op.state === "ready") {
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
      } catch {
        outcome = { state: "inconclusive" };
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
          adapter.recover(claim.operation, async (request) => {
            if (request.method !== "GET" || remaining-- <= 0 || Date.now() >= deadline)
              throw new Error("recovery_bound");
            return client.request(request, { recovery: true, signal });
          }),
        ),
      );
    } catch {
      outcome = { state: "inconclusive" };
    }
    await this.store.finishRecovery(claim, outcome);
  }
}
