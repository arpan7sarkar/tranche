import { createHash, randomUUID } from "node:crypto";
import {
  SandboxAllocation,
  SandboxInspection,
  SandboxOperationSpec,
  SandboxOutcome,
  SandboxReport,
} from "@tranche/contracts";
import { needsSandboxApproval, sandboxApprovalMatches, sandboxEligibility } from "@tranche/core";
import { and, eq, sql } from "drizzle-orm";
import { createDb, type Db } from "./index";
import {
  sandboxAllocation as allocations,
  sandboxApproval as approvals,
  sandboxAttempt as attempts,
  sandboxCommitment as commitments,
  sandboxOperation as operations,
  sandboxRun as runs,
  sandboxBrowserWait as waits,
} from "./sandbox-schema";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type StoredOperation = typeof operations.$inferSelect;
export type DispatchClaim = { operation: StoredOperation; token: string; attemptId: string };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
export function sandboxPayloadHash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export class SandboxStore {
  constructor(readonly db: Db) {}

  private async allocation(tx: Tx) {
    const [row] = await tx.select().from(allocations).where(eq(allocations.id, 1)).for("update");
    if (!row) throw new Error("allocation_missing");
    return SandboxAllocation.parse({ ...row, currency: "USD", limitCents: 100, callLimit: 50 });
  }

  async start(): Promise<string> {
    return this.db.transaction(async (tx) => {
      await tx.insert(allocations).values({ id: 1 }).onConflictDoNothing();
      const id = randomUUID();
      await tx.insert(runs).values({ id, allocationId: 1 });
      return id;
    });
  }

  async prepare(runId: string, operationId: string, input: unknown): Promise<StoredOperation> {
    const spec = SandboxOperationSpec.parse(input);
    const payloadHash = sandboxPayloadHash(spec);
    return this.db.transaction(async (tx) => {
      const allocation = await this.allocation(tx);
      const [run] = await tx.select().from(runs).where(eq(runs.id, runId));
      if (!run) throw new Error("run_missing");
      const [existing] = await tx.select().from(operations).where(eq(operations.id, operationId));
      if (existing) {
        if (existing.runId !== runId || existing.payloadHash !== payloadHash)
          throw new Error("identity_conflict");
        return existing;
      }
      const principal = spec.recipients.reduce((sum, r) => sum + r.cents, 0);
      const fingerprint = sandboxPayloadHash({
        sender: spec.sender,
        recipients: spec.recipients,
        currency: spec.currency,
      });
      const [commitment] = await tx
        .select()
        .from(commitments)
        .where(eq(commitments.id, spec.commitmentId));
      if (commitment && commitment.fingerprint !== fingerprint)
        throw new Error("commitment_conflict");
      if ((spec.kind === "payout" || spec.kind === "create_order") && commitment) {
        throw new Error("new_payment_requires_new_commitment");
      }
      if (
        ["authorize_order", "capture_order", "release_payment"].includes(spec.kind) &&
        !commitment
      ) {
        throw new Error("prior_commitment_required");
      }
      if (
        spec.kind === "authorize_order" ||
        spec.kind === "capture_order" ||
        spec.kind === "release_payment"
      ) {
        const prior = await tx
          .select()
          .from(operations)
          .where(eq(operations.commitmentId, spec.commitmentId));
        const kind = spec.kind === "release_payment" ? "capture_order" : "create_order";
        if (!prior.some((op) => op.spec.kind === kind && op.state === "succeeded"))
          throw new Error("prior_stage_required");
      }
      if (
        ["read_status", "onboard_seller"].includes(spec.kind) &&
        (principal !== 0 || spec.feeBoundCents !== 0)
      ) {
        throw new Error("nonpayment_amount");
      }
      const extra = (commitment ? 0 : principal) + spec.feeBoundCents;
      const decision = sandboxEligibility({
        allocation,
        spec,
        additionalCents: extra,
        requiredCalls: 3 + spec.recoveryCalls,
      });
      if (decision !== "allowed") throw new Error(decision);
      if (!commitment)
        await tx
          .insert(commitments)
          .values({ id: spec.commitmentId, allocationId: 1, fingerprint, cents: principal });
      await tx
        .update(allocations)
        .set({ reservedCents: allocation.reservedCents + extra })
        .where(eq(allocations.id, 1));
      const [operation] = await tx
        .insert(operations)
        .values({
          id: operationId,
          runId,
          commitmentId: spec.commitmentId,
          requestId: randomUUID(),
          payloadHash,
          spec,
          semanticKey: sandboxPayloadHash({ kind: spec.kind, resourceKey: spec.resourceKey }),
          state: needsSandboxApproval(spec) ? "awaiting_approval" : "ready",
        })
        .returning();
      if (!operation) throw new Error("prepare_failed");
      return operation;
    });
  }

  async approve(operationId: string, payloadHash: string, nextAttempt: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.allocation(tx);
      const [op] = await tx
        .select()
        .from(operations)
        .where(eq(operations.id, operationId))
        .for("update");
      if (
        !op ||
        !sandboxApprovalMatches({
          payloadHash: op.payloadHash,
          nextAttempt: op.attempts + 1,
          approval: { payloadHash, attempt: nextAttempt, consumed: false },
        }) ||
        op.state !== "awaiting_approval"
      ) {
        throw new Error("approval_mismatch");
      }
      await tx
        .insert(approvals)
        .values({ id: randomUUID(), operationId, payloadHash, attempt: nextAttempt });
      await tx.update(operations).set({ state: "ready" }).where(eq(operations.id, operationId));
    });
  }

  async claim(operationId: string): Promise<DispatchClaim> {
    return this.db.transaction(async (tx) => {
      const allocation = await this.allocation(tx);
      const [op] = await tx
        .select()
        .from(operations)
        .where(eq(operations.id, operationId))
        .for("update");
      if (op?.state !== "ready") throw new Error("not_ready");
      if (op.payloadHash !== sandboxPayloadHash(SandboxOperationSpec.parse(op.spec)))
        throw new Error("payload_changed");
      if (allocation.consumedCalls + allocation.heldCalls + 3 + op.spec.recoveryCalls > 50)
        throw new Error("call_limit");
      if (needsSandboxApproval(op.spec)) {
        const [approval] = await tx
          .update(approvals)
          .set({ consumed: 1 })
          .where(
            and(
              eq(approvals.operationId, operationId),
              eq(approvals.payloadHash, op.payloadHash),
              eq(approvals.attempt, op.attempts + 1),
              eq(approvals.consumed, 0),
            ),
          )
          .returning();
        if (!approval) throw new Error("approval_required");
      }
      const token = randomUUID();
      const attemptId = randomUUID();
      const [claimed] = await tx
        .update(operations)
        .set({
          state: "dispatching",
          attempts: op.attempts + 1,
          claimToken: token,
          heldCalls: 2 + op.spec.recoveryCalls,
          claimUntil: sql`now() + interval '60 seconds'`,
        })
        .where(eq(operations.id, operationId))
        .returning();
      await tx
        .update(allocations)
        .set({
          consumedCalls: allocation.consumedCalls + 1,
          heldCalls: allocation.heldCalls + 2 + op.spec.recoveryCalls,
        })
        .where(eq(allocations.id, 1));
      await tx.insert(attempts).values({
        id: attemptId,
        runId: op.runId,
        operationId,
        kind: op.spec.kind === "read_status" ? "read" : "business",
        claimToken: token,
      });
      if (!claimed) throw new Error("claim_failed");
      return { operation: claimed, token, attemptId };
    });
  }

  async markDispatch(claim: DispatchClaim): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.allocation(tx);
      const [op] = await tx
        .select()
        .from(operations)
        .where(
          and(
            eq(operations.id, claim.operation.id),
            eq(operations.claimToken, claim.token),
            eq(operations.state, "dispatching"),
            sql`${operations.claimUntil} > now()`,
          ),
        )
        .for("update");
      if (!op) throw new Error("claim_expired");
      const [attempt] = await tx
        .update(attempts)
        .set({ dispatched: 1 })
        .where(
          and(
            eq(attempts.id, claim.attemptId),
            eq(attempts.claimToken, claim.token),
            eq(attempts.dispatched, 0),
          ),
        )
        .returning();
      if (!attempt) throw new Error("already_dispatched");
    });
  }

  async reserveRequest(runId: string, kind: "oauth" | "read" | "recovery"): Promise<string> {
    return this.db.transaction(async (tx) => {
      const allocation = await this.allocation(tx);
      if (allocation.consumedCalls + allocation.heldCalls >= 50) throw new Error("call_limit");
      const id = randomUUID();
      await tx.insert(attempts).values({ id, runId, kind, dispatched: 1 });
      await tx
        .update(allocations)
        .set({ consumedCalls: allocation.consumedCalls + 1 })
        .where(eq(allocations.id, 1));
      return id;
    });
  }

  async finishRequest(id: string, success: boolean): Promise<void> {
    await this.db
      .update(attempts)
      .set({ outcome: success ? "completed" : "inconclusive" })
      .where(eq(attempts.id, id));
  }

  async reserveClaimRequest(
    claim: DispatchClaim,
    kind: "oauth" | "read" | "recovery",
  ): Promise<string> {
    return this.db.transaction(async (tx) => {
      const allocation = await this.allocation(tx);
      const [op] = await tx
        .select()
        .from(operations)
        .where(
          and(
            eq(operations.id, claim.operation.id),
            eq(operations.claimToken, claim.token),
            sql`${operations.claimUntil} > now()`,
          ),
        )
        .for("update");
      if (!op || !["dispatching", "recovering"].includes(op.state)) throw new Error("stale_claim");
      if (
        op.heldCalls <= 0 ||
        allocation.consumedCalls >= 50 ||
        (kind === "recovery" && op.recoveryReads >= op.spec.recoveryCalls)
      )
        throw new Error("call_limit");
      const id = randomUUID();
      await tx.insert(attempts).values({
        id,
        runId: op.runId,
        operationId: op.id,
        kind,
        claimToken: claim.token,
        dispatched: 1,
      });
      await tx
        .update(allocations)
        .set({ consumedCalls: allocation.consumedCalls + 1, heldCalls: allocation.heldCalls - 1 })
        .where(eq(allocations.id, 1));
      await tx
        .update(operations)
        .set({
          heldCalls: op.heldCalls - 1,
          recoveryReads: op.recoveryReads + (kind === "recovery" ? 1 : 0),
        })
        .where(eq(operations.id, op.id));
      return id;
    });
  }

  async finish(claim: DispatchClaim, input: unknown): Promise<void> {
    const outcome = SandboxOutcome.parse(input);
    await this.db.transaction(async (tx) => {
      const allocation = await this.allocation(tx);
      const [op] = await tx
        .select()
        .from(operations)
        .where(
          and(
            eq(operations.id, claim.operation.id),
            eq(operations.claimToken, claim.token),
            eq(operations.state, "dispatching"),
          ),
        )
        .for("update");
      if (!op) throw new Error("stale_claim");
      if (outcome.state === "succeeded") await this.commitMoney(tx, allocation, op);
      if (outcome.state === "succeeded" || outcome.state === "failed") {
        await tx
          .update(allocations)
          .set({ heldCalls: allocation.heldCalls - op.heldCalls })
          .where(eq(allocations.id, 1));
        await tx.update(operations).set({ heldCalls: 0 }).where(eq(operations.id, op.id));
      }
      if (outcome.state === "waiting_for_browser")
        await tx
          .insert(waits)
          .values({
            operationId: op.id,
            expectedAlias: outcome.expectedAlias,
            artifactKey: outcome.artifactKey,
          })
          .onConflictDoNothing();
      await tx
        .update(operations)
        .set({ state: outcome.state, claimToken: null, claimUntil: null })
        .where(eq(operations.id, op.id));
      await tx
        .update(attempts)
        .set({ outcome: outcome.state })
        .where(eq(attempts.id, claim.attemptId));
    });
  }

  private async commitMoney(tx: Tx, allocation: SandboxAllocation, op: StoredOperation) {
    const [commitment] = await tx
      .select()
      .from(commitments)
      .where(eq(commitments.id, op.commitmentId));
    if (!commitment) throw new Error("commitment_missing");
    const cents =
      (commitment.committed ? 0 : commitment.cents) + (op.feeCommitted ? 0 : op.spec.feeBoundCents);
    await tx
      .update(allocations)
      .set({
        reservedCents: allocation.reservedCents - cents,
        committedCents: allocation.committedCents + cents,
      })
      .where(eq(allocations.id, 1));
    await tx.update(commitments).set({ committed: 1 }).where(eq(commitments.id, commitment.id));
    await tx.update(operations).set({ feeCommitted: 1 }).where(eq(operations.id, op.id));
  }

  async beginRecovery(operationId: string): Promise<DispatchClaim> {
    return this.db.transaction(async (tx) => {
      await this.allocation(tx);
      const [op] = await tx
        .select()
        .from(operations)
        .where(eq(operations.id, operationId))
        .for("update");
      if (
        !op ||
        !["dispatching", "inconclusive", "waiting_for_browser", "recovering"].includes(op.state)
      )
        throw new Error("not_recoverable");
      if (op.payloadHash !== sandboxPayloadHash(SandboxOperationSpec.parse(op.spec)))
        throw new Error("payload_changed");
      const [claimed] = await tx
        .update(operations)
        .set({
          state: "recovering",
          claimToken: randomUUID(),
          claimUntil: sql`now() + interval '60 seconds'`,
        })
        .where(
          and(
            eq(operations.id, operationId),
            sql`(${operations.claimUntil} IS NULL OR ${operations.claimUntil} <= now())`,
          ),
        )
        .returning();
      if (!claimed?.claimToken) throw new Error("claim_active");
      return { operation: claimed, token: claimed.claimToken, attemptId: randomUUID() };
    });
  }

  async finishRecovery(claim: DispatchClaim, input: unknown): Promise<void> {
    const outcome = SandboxOutcome.parse(input);
    await this.db.transaction(async (tx) => {
      const allocation = await this.allocation(tx);
      const [op] = await tx
        .select()
        .from(operations)
        .where(
          and(
            eq(operations.id, claim.operation.id),
            eq(operations.claimToken, claim.token),
            eq(operations.state, "recovering"),
          ),
        )
        .for("update");
      if (!op) throw new Error("stale_claim");
      if (outcome.state === "succeeded") await this.commitMoney(tx, allocation, op);
      if (outcome.state === "succeeded" || outcome.state === "failed") {
        await tx
          .update(allocations)
          .set({ heldCalls: allocation.heldCalls - op.heldCalls })
          .where(eq(allocations.id, 1));
        await tx.update(operations).set({ heldCalls: 0 }).where(eq(operations.id, op.id));
      }
      await tx
        .update(operations)
        .set({ state: outcome.state, claimToken: null, claimUntil: null })
        .where(eq(operations.id, op.id));
      if (outcome.state === "succeeded" || outcome.state === "failed") {
        await tx.update(waits).set({ resolved: 1 }).where(eq(waits.operationId, op.id));
      }
      if (outcome.state === "waiting_for_browser") {
        await tx
          .insert(waits)
          .values({
            operationId: op.id,
            expectedAlias: outcome.expectedAlias,
            artifactKey: outcome.artifactKey,
          })
          .onConflictDoUpdate({
            target: waits.operationId,
            set: {
              expectedAlias: outcome.expectedAlias,
              artifactKey: outcome.artifactKey,
              resolved: 0,
            },
          });
      }
    });
  }

  async operation(id: string): Promise<StoredOperation> {
    const [op] = await this.db.select().from(operations).where(eq(operations.id, id));
    if (!op) throw new Error("operation_missing");
    return op;
  }

  async report(runId: string): Promise<SandboxReport> {
    return this.db.transaction(async (tx) => {
      const allocation = await this.allocation(tx);
      const [run] = await tx.select().from(runs).where(eq(runs.id, runId));
      if (!run) throw new Error("run_missing");
      const rows = await tx.select().from(operations).where(eq(operations.runId, runId));
      return SandboxReport.parse({
        runId,
        capability: "not_tested",
        allocation,
        operations: rows.map((op) => ({
          id: op.id,
          kind: op.spec.kind,
          state: op.state,
          attempts: op.attempts,
        })),
      });
    });
  }

  async inspect(runId: string) {
    const report = await this.report(runId);
    const rows = await this.db.select().from(operations).where(eq(operations.runId, runId));
    const browserWaits = await this.db
      .select({
        operationId: waits.operationId,
        expectedAlias: waits.expectedAlias,
        artifactKey: waits.artifactKey,
        resolved: waits.resolved,
      })
      .from(waits)
      .innerJoin(operations, eq(operations.id, waits.operationId))
      .where(eq(operations.runId, runId));
    return SandboxInspection.parse({
      report,
      approvals: rows
        .filter((op) => op.state === "awaiting_approval")
        .map((op) => ({
          operationId: op.id,
          payloadHash: op.payloadHash,
          nextAttempt: op.attempts + 1,
          purpose: op.spec.kind,
          sender: op.spec.sender,
          recipients: op.spec.recipients,
          feeBoundCents: op.spec.feeBoundCents,
        })),
      browserWaits: browserWaits.map((wait) => ({ ...wait, resolved: wait.resolved === 1 })),
    });
  }
}

export function createSandboxStore(url?: string): SandboxStore {
  return new SandboxStore(createDb(url));
}
