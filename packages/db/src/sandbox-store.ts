import { createHash, randomUUID } from "node:crypto";
import {
  onboardingApprovalSummary,
  PayPalReferralId,
  SandboxAllocation,
  SandboxInspection,
  SandboxOnboardingResult,
  SandboxOperationSpec,
  SandboxOutcome,
  SandboxReport,
} from "@tranche/contracts";
import {
  needsSandboxApproval,
  sandboxApprovalMatches,
  sandboxEligibility,
  sandboxRequestAllowance,
} from "@tranche/core";
import { and, eq, sql } from "drizzle-orm";
import { createDb, type Db } from "./index";
import {
  sandboxAllocation as allocations,
  sandboxApproval as approvals,
  sandboxAttempt as attempts,
  sandboxCommitment as commitments,
  sandboxOnboarding as onboarding,
  sandboxOperation as operations,
  sandboxReferralRecovery as referralRecoveries,
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
        requiredCalls: sandboxRequestAllowance(spec),
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
      if (spec.kind === "onboard_seller") {
        const c = spec.onboarding;
        const until = c ? new Date(c.checkUntil) : new Date(0);
        if (!c || until.getTime() <= Date.now() || until.getTime() > Date.now() + 86_400_000)
          throw new Error("onboarding_prerequisites");
        await tx.insert(onboarding).values({
          operationId,
          checkUntil: until,
          sellerKey: sandboxPayloadHash({
            platform: c.platformMerchantId,
            seller: c.sellerMerchantId,
          }),
          trackingKey: sandboxPayloadHash({
            platform: c.platformMerchantId,
            tracking: c.trackingId,
          }),
        });
      }
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
      const allowance = sandboxRequestAllowance(op.spec);
      if (allocation.consumedCalls + allocation.heldCalls + allowance > 50)
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
          heldCalls: allowance - 1,
          claimUntil: sql`now() + interval '60 seconds'`,
        })
        .where(eq(operations.id, operationId))
        .returning();
      await tx
        .update(allocations)
        .set({
          consumedCalls: allocation.consumedCalls + 1,
          heldCalls: allocation.heldCalls + allowance - 1,
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
      const [referralClaim] = await tx
        .select()
        .from(referralRecoveries)
        .where(
          and(
            eq(referralRecoveries.operationId, op.id),
            eq(referralRecoveries.claimToken, claim.token),
            eq(referralRecoveries.state, "approved"),
          ),
        );
      if (referralClaim) {
        const issued = await tx
          .select()
          .from(attempts)
          .where(and(eq(attempts.operationId, op.id), eq(attempts.claimToken, claim.token)));
        if (
          !["oauth", "recovery"].includes(kind) ||
          issued.length >= 2 ||
          issued.some((attempt) => attempt.kind === kind)
        )
          throw new Error("referral_recovery_call_limit");
      }
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
      await this.persistOnboarding(tx, op, outcome);
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

  private async referralCandidate(tx: Tx, operationId: string, recovering = false) {
    const [op] = await tx
      .select()
      .from(operations)
      .where(eq(operations.id, operationId))
      .for("update");
    if (
      !op?.spec.onboarding ||
      op.state !== (recovering ? "recovering" : "inconclusive") ||
      (!recovering && op.claimToken) ||
      op.payloadHash !== sandboxPayloadHash(SandboxOperationSpec.parse(op.spec)) ||
      Date.parse(op.spec.onboarding.checkUntil) <= Date.now() ||
      op.recoveryReads >= op.spec.recoveryCalls ||
      op.heldCalls <= 1
    )
      throw new Error("referral_recovery_not_available");
    const [resource] = await tx.select().from(onboarding).where(eq(onboarding.operationId, op.id));
    const dispatched = await tx
      .select({ id: attempts.id })
      .from(attempts)
      .where(
        and(
          eq(attempts.operationId, op.id),
          eq(attempts.kind, "business"),
          eq(attempts.dispatched, 1),
        ),
      );
    if (!resource || resource.referralId || resource.artifactKey || dispatched.length !== 1)
      throw new Error("referral_recovery_not_available");
    return op;
  }

  private referralRecoverySummary(row: typeof referralRecoveries.$inferSelect) {
    return {
      id: row.id,
      operationId: row.operationId,
      state: row.state,
      approvalHash: row.approvalHash,
      additionalCalls: 2 as const,
    };
  }

  private referralRecoveryHash(op: StoredOperation, referralId: string) {
    return sandboxPayloadHash({
      operationId: op.id,
      referralId,
      payloadHash: op.payloadHash,
      requestId: op.requestId,
      additionalCalls: 2,
    });
  }

  async referralRecovery(id: string) {
    const [row] = await this.db
      .select()
      .from(referralRecoveries)
      .where(eq(referralRecoveries.id, id));
    if (!row) throw new Error("referral_recovery_missing");
    return row;
  }

  async proposeReferralRecovery(operationId: string, input: unknown) {
    const referralId = PayPalReferralId.parse(input);
    return this.db.transaction(async (tx) => {
      await this.allocation(tx);
      const op = await this.referralCandidate(tx, operationId);
      const approvalHash = this.referralRecoveryHash(op, referralId);
      const [prior] = await tx
        .select()
        .from(referralRecoveries)
        .where(eq(referralRecoveries.operationId, operationId));
      if (prior) {
        if (prior.referralId !== referralId || prior.approvalHash !== approvalHash)
          throw new Error("referral_recovery_exists");
        return this.referralRecoverySummary(prior);
      }
      const [row] = await tx
        .insert(referralRecoveries)
        .values({
          id: randomUUID(),
          operationId,
          referralId,
          approvalHash,
          state: "awaiting_approval",
        })
        .returning();
      if (!row) throw new Error("referral_recovery_prepare_failed");
      return this.referralRecoverySummary(row);
    });
  }

  async approveReferralRecovery(id: string, approvalHash: string) {
    await this.db.transaction(async (tx) => {
      const allocation = await this.allocation(tx);
      const [row] = await tx
        .select()
        .from(referralRecoveries)
        .where(eq(referralRecoveries.id, id))
        .for("update");
      if (row?.state !== "awaiting_approval" || row.approvalHash !== approvalHash)
        throw new Error("referral_recovery_approval_mismatch");
      const op = await this.referralCandidate(tx, row.operationId);
      if (this.referralRecoveryHash(op, row.referralId) !== row.approvalHash)
        throw new Error("referral_recovery_stale");
      if (allocation.consumedCalls + allocation.heldCalls + 2 > 50) throw new Error("call_limit");
      await tx
        .update(allocations)
        .set({ heldCalls: allocation.heldCalls + 2 })
        .where(eq(allocations.id, 1));
      await tx
        .update(operations)
        .set({ heldCalls: op.heldCalls + 2 })
        .where(eq(operations.id, op.id));
      await tx
        .update(referralRecoveries)
        .set({ state: "approved", approvedAt: new Date() })
        .where(eq(referralRecoveries.id, id));
    });
  }

  async beginReferralRecovery(id: string): Promise<DispatchClaim> {
    return this.db.transaction(async (tx) => {
      await this.allocation(tx);
      const [row] = await tx
        .select()
        .from(referralRecoveries)
        .where(eq(referralRecoveries.id, id))
        .for("update");
      if (row?.state !== "approved" || row.claimToken)
        throw new Error("referral_recovery_approval_required");
      const op = await this.referralCandidate(tx, row.operationId);
      if (this.referralRecoveryHash(op, row.referralId) !== row.approvalHash)
        throw new Error("referral_recovery_stale");
      if (op.heldCalls < 2) throw new Error("call_limit");
      const token = randomUUID();
      const [claimed] = await tx
        .update(operations)
        .set({
          state: "recovering",
          claimToken: token,
          claimUntil: sql`now() + interval '60 seconds'`,
        })
        .where(eq(operations.id, op.id))
        .returning();
      if (!claimed) throw new Error("claim_failed");
      await tx
        .update(referralRecoveries)
        .set({ claimToken: token })
        .where(eq(referralRecoveries.id, id));
      return { operation: claimed, token, attemptId: randomUUID() };
    });
  }

  async finishReferralRecovery(claim: DispatchClaim, id: string, input: unknown) {
    const outcome = SandboxOutcome.parse(input);
    await this.db.transaction(async (tx) => {
      await this.allocation(tx);
      const [row] = await tx
        .select()
        .from(referralRecoveries)
        .where(eq(referralRecoveries.id, id))
        .for("update");
      const [op] = await tx
        .select()
        .from(operations)
        .where(eq(operations.id, claim.operation.id))
        .for("update");
      if (
        row?.state !== "approved" ||
        row.claimToken !== claim.token ||
        op?.claimToken !== claim.token ||
        op.state !== "recovering" ||
        !op.claimUntil ||
        op.claimUntil.getTime() <= Date.now() ||
        row.operationId !== op.id ||
        !op.spec.onboarding ||
        Date.parse(op.spec.onboarding.checkUntil) <= Date.now()
      )
        throw new Error("stale_claim");
      if (
        this.referralRecoveryHash(op, row.referralId) !== row.approvalHash ||
        op.payloadHash !== sandboxPayloadHash(SandboxOperationSpec.parse(op.spec))
      )
        throw new Error("referral_recovery_stale");
      if (
        outcome.state !== "waiting_for_browser" ||
        outcome.onboarding?.referralId !== row.referralId ||
        !outcome.artifactKey
      )
        throw new Error("referral_recovery_mismatch");
      const requestRows = await tx
        .select()
        .from(attempts)
        .where(and(eq(attempts.operationId, op.id), eq(attempts.claimToken, claim.token)));
      if (
        requestRows.length !== 2 ||
        requestRows.some((attempt) => attempt.outcome !== "completed")
      )
        throw new Error("referral_recovery_read_required");
      await this.persistOnboarding(tx, op, outcome);
      await tx
        .insert(waits)
        .values({
          operationId: op.id,
          expectedAlias: op.spec.onboarding.seller,
          artifactKey: outcome.artifactKey,
        })
        .onConflictDoUpdate({
          target: waits.operationId,
          set: {
            expectedAlias: op.spec.onboarding.seller,
            artifactKey: outcome.artifactKey,
            resolved: 0,
          },
        });
      await tx
        .update(operations)
        .set({ state: "waiting_for_browser", claimToken: null, claimUntil: null })
        .where(eq(operations.id, op.id));
      await tx
        .update(referralRecoveries)
        .set({ state: "applied", appliedAt: new Date() })
        .where(eq(referralRecoveries.id, id));
    });
  }

  async failReferralRecovery(claim: DispatchClaim, id: string) {
    await this.db.transaction(async (tx) => {
      const allocation = await this.allocation(tx);
      const [row] = await tx
        .select()
        .from(referralRecoveries)
        .where(eq(referralRecoveries.id, id))
        .for("update");
      const [op] = await tx
        .select()
        .from(operations)
        .where(eq(operations.id, claim.operation.id))
        .for("update");
      if (
        row?.state !== "approved" ||
        row.claimToken !== claim.token ||
        op?.claimToken !== claim.token
      )
        throw new Error("stale_claim");
      const issued = await tx
        .select({ id: attempts.id })
        .from(attempts)
        .where(and(eq(attempts.operationId, op.id), eq(attempts.claimToken, claim.token)));
      const unused = 2 - issued.length;
      if (unused < 0) throw new Error("referral_recovery_call_limit");
      await tx
        .update(allocations)
        .set({ heldCalls: allocation.heldCalls - unused })
        .where(eq(allocations.id, 1));
      await tx
        .update(operations)
        .set({
          state: "inconclusive",
          heldCalls: op.heldCalls - unused,
          claimToken: null,
          claimUntil: null,
        })
        .where(eq(operations.id, op.id));
      await tx
        .update(referralRecoveries)
        .set({ state: "awaiting_approval", claimToken: null, approvedAt: null })
        .where(eq(referralRecoveries.id, id));
    });
  }

  async beginRecovery(operationId: string): Promise<DispatchClaim> {
    const claim = await this.db.transaction(async (tx) => {
      const allocation = await this.allocation(tx);
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
      const [referralRow] = await tx
        .select()
        .from(referralRecoveries)
        .where(eq(referralRecoveries.operationId, op.id));
      if (
        op.spec.onboarding &&
        (Date.parse(op.spec.onboarding.checkUntil) <= Date.now() ||
          op.recoveryReads >= op.spec.recoveryCalls ||
          op.heldCalls <= 1)
      ) {
        if (op.claimUntil && op.claimUntil.getTime() > Date.now()) throw new Error("claim_active");
        await tx
          .update(allocations)
          .set({ heldCalls: allocation.heldCalls - op.heldCalls })
          .where(eq(allocations.id, 1));
        await tx
          .update(operations)
          .set({ state: "blocked", heldCalls: 0, claimToken: null, claimUntil: null })
          .where(eq(operations.id, op.id));
        await tx.update(waits).set({ resolved: 1 }).where(eq(waits.operationId, op.id));
        if (referralRow && referralRow.state !== "applied")
          await tx
            .update(referralRecoveries)
            .set({ state: "failed", claimToken: null })
            .where(eq(referralRecoveries.id, referralRow.id));
        return null;
      }
      if (referralRow && referralRow.state !== "applied")
        throw new Error("referral_recovery_requires_dedicated_command");
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
    if (!claim) throw new Error("onboarding_recovery_limit");
    return claim;
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
      await this.persistOnboarding(tx, op, outcome);
      const exhausted = Boolean(
        op.spec.onboarding &&
          !["succeeded", "failed"].includes(outcome.state) &&
          (Date.parse(op.spec.onboarding.checkUntil) <= Date.now() ||
            op.recoveryReads >= op.spec.recoveryCalls ||
            op.heldCalls <= 1),
      );
      if (outcome.state === "succeeded") await this.commitMoney(tx, allocation, op);
      if (outcome.state === "succeeded" || outcome.state === "failed" || exhausted) {
        await tx
          .update(allocations)
          .set({ heldCalls: allocation.heldCalls - op.heldCalls })
          .where(eq(allocations.id, 1));
        await tx.update(operations).set({ heldCalls: 0 }).where(eq(operations.id, op.id));
      }
      await tx
        .update(operations)
        .set({ state: exhausted ? "blocked" : outcome.state, claimToken: null, claimUntil: null })
        .where(eq(operations.id, op.id));
      if (outcome.state === "succeeded" || outcome.state === "failed" || exhausted) {
        await tx.update(waits).set({ resolved: 1 }).where(eq(waits.operationId, op.id));
      }
      if (outcome.state === "waiting_for_browser" && !exhausted) {
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

  async finalizeOnboardingExpiry(operationId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const allocation = await this.allocation(tx);
      const [op] = await tx
        .select()
        .from(operations)
        .where(eq(operations.id, operationId))
        .for("update");
      if (
        !op?.spec.onboarding ||
        Date.parse(op.spec.onboarding.checkUntil) > Date.now() ||
        ["succeeded", "failed"].includes(op.state)
      )
        return false;
      if (op.claimUntil && op.claimUntil.getTime() > Date.now()) throw new Error("claim_active");
      if (op.state === "blocked" && op.heldCalls === 0) return false;
      await tx
        .update(allocations)
        .set({ heldCalls: allocation.heldCalls - op.heldCalls })
        .where(eq(allocations.id, 1));
      await tx
        .update(operations)
        .set({ state: "blocked", heldCalls: 0, claimToken: null, claimUntil: null })
        .where(eq(operations.id, op.id));
      await tx.update(waits).set({ resolved: 1 }).where(eq(waits.operationId, op.id));
      await tx
        .update(referralRecoveries)
        .set({ state: "failed", claimToken: null })
        .where(
          and(
            eq(referralRecoveries.operationId, op.id),
            sql`${referralRecoveries.state} <> 'applied'`,
          ),
        );
      return true;
    });
  }

  async onboardingResource(operationId: string) {
    const [row] = await this.db
      .select()
      .from(onboarding)
      .where(eq(onboarding.operationId, operationId));
    if (!row) throw new Error("onboarding_missing");
    return row;
  }

  async consentArtifact(operationId: string) {
    const op = await this.operation(operationId);
    const resource = await this.onboardingResource(operationId);
    const [wait] = await this.db.select().from(waits).where(eq(waits.operationId, operationId));
    if (
      !op.spec.onboarding ||
      !["waiting_for_browser", "inconclusive"].includes(op.state) ||
      (op.state === "inconclusive" &&
        !["not_found", "provider_unavailable"].includes(resource.evidence?.reason ?? "")) ||
      Date.parse(op.spec.onboarding.checkUntil) <= Date.now() ||
      !resource.referralId ||
      !resource.artifactKey ||
      !wait ||
      wait.resolved !== 0 ||
      wait.expectedAlias !== op.spec.onboarding.seller ||
      wait.artifactKey !== resource.artifactKey
    )
      throw new Error("consent_unavailable");
    return { seller: op.spec.onboarding.seller, artifactKey: resource.artifactKey };
  }

  private async persistOnboarding(tx: Tx, op: StoredOperation, outcome: SandboxOutcome) {
    if (!op.spec.onboarding) {
      if (outcome.onboarding) throw new Error("unexpected_onboarding_result");
      return;
    }
    if (!outcome.onboarding) {
      if (outcome.state !== "inconclusive") throw new Error("onboarding_evidence_required");
      return;
    }
    const result = SandboxOnboardingResult.parse(outcome.onboarding);
    if (
      outcome.state === "succeeded" &&
      (result.evidence.status !== "consent_verified" ||
        result.evidence.reason !== "ready" ||
        !result.evidence.merchantMatched ||
        !result.evidence.platformConnected ||
        !result.evidence.permissionsGranted ||
        !result.evidence.paymentsReceivable ||
        !result.evidence.primaryEmailConfirmed ||
        !result.evidence.productActive ||
        result.evidence.missingScopes.length)
    )
      throw new Error("onboarding_not_verified");
    if (
      outcome.state === "waiting_for_browser" &&
      (outcome.expectedAlias !== op.spec.onboarding.seller ||
        outcome.artifactKey !== result.artifactKey)
    )
      throw new Error("onboarding_browser_mismatch");
    const [row] = await tx.select().from(onboarding).where(eq(onboarding.operationId, op.id));
    if (!row || (row.referralId && result.referralId && row.referralId !== result.referralId))
      throw new Error("onboarding_resource_mismatch");
    await tx
      .update(onboarding)
      .set({
        referralId: result.referralId ?? row.referralId,
        artifactKey: result.artifactKey ?? row.artifactKey,
        evidence: result.evidence,
        checkedAt: sql`now()`,
      })
      .where(eq(onboarding.operationId, op.id));
  }

  async report(runId: string): Promise<SandboxReport> {
    return this.db.transaction(async (tx) => {
      const allocation = await this.allocation(tx);
      const [run] = await tx.select().from(runs).where(eq(runs.id, runId));
      if (!run) throw new Error("run_missing");
      const rows = await tx.select().from(operations).where(eq(operations.runId, runId));
      const observations = await tx
        .select({ operationId: onboarding.operationId, evidence: onboarding.evidence })
        .from(onboarding)
        .innerJoin(operations, eq(operations.id, onboarding.operationId))
        .where(eq(operations.runId, runId));
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
        ...(observations.length
          ? {
              onboarding: observations
                .filter((o) => o.evidence)
                .map((o) => ({
                  operationId: o.operationId,
                  seller: rows.find((op) => op.id === o.operationId)?.spec.onboarding?.seller,
                  evidence: o.evidence,
                })),
            }
          : {}),
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
          ...(op.spec.onboarding
            ? { onboarding: onboardingApprovalSummary(op.spec.onboarding) }
            : {}),
        })),
      browserWaits: browserWaits.map((wait) => ({ ...wait, resolved: wait.resolved === 1 })),
    });
  }
}

export function createSandboxStore(url?: string): SandboxStore {
  return new SandboxStore(createDb(url));
}
