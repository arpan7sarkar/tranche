import { createHash, randomUUID } from "node:crypto";
import {
  onboardingApprovalSummary,
  PayPalReferralId,
  SandboxAllocation,
  SandboxBuyerChangeSummary,
  SandboxInspection,
  SandboxMaintenanceInput,
  SandboxMaintenanceSummary,
  SandboxOnboardingResult,
  SandboxOperationSpec,
  SandboxOutcome,
  SandboxPaymentResult,
  SandboxReport,
} from "@tranche/contracts";
import {
  needsSandboxApproval,
  paymentApproval,
  paymentStageCalls,
  paymentTotalCalls,
  sandboxApprovalMatches,
  sandboxBuyerChangeSpec,
  sandboxEligibility,
  sandboxPaymentPredecessor,
  sandboxProductContext,
  sandboxRequestAllowance,
  sandboxRetirementOrder,
} from "@tranche/core";
import { and, eq, sql } from "drizzle-orm";
import { createDb, type Db } from "./index";
import {
  sandboxAllocation as allocations,
  sandboxApproval as approvals,
  sandboxAttempt as attempts,
  sandboxBuyerChange as buyerChanges,
  sandboxCommitment as commitments,
  sandboxMaintenance as maintenance,
  sandboxOnboarding as onboarding,
  sandboxOperation as operations,
  sandboxPayment as payments,
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

  private async leaseActive(tx: Tx, operationId: string): Promise<boolean> {
    const [row] = await tx
      .select({ active: sql<boolean>`${operations.claimUntil} > now()` })
      .from(operations)
      .where(eq(operations.id, operationId));
    return row?.active === true;
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
    const semanticKey = sandboxPayloadHash({
      kind: spec.kind,
      resourceKey: spec.payment ? spec.commitmentId : spec.resourceKey,
    });
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
      if (spec.kind === "void_authorization") {
        const [cleanup] = await tx
          .select()
          .from(operations)
          .where(eq(operations.semanticKey, semanticKey))
          .for("update");
        if (cleanup) {
          if (cleanup.runId !== runId || cleanup.payloadHash !== payloadHash)
            throw new Error("cleanup_identity_conflict");
          return cleanup;
        }
      }
      if (spec.payment) await this.requireNoCleanup(tx, spec);
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
      const retired = await tx
        .select({ id: maintenance.id })
        .from(maintenance)
        .innerJoin(operations, eq(operations.id, maintenance.operationId))
        .where(
          and(eq(operations.commitmentId, spec.commitmentId), eq(maintenance.state, "applied")),
        );
      if (retired.length && spec.kind !== "read_status")
        throw new Error("commitment_retired_or_amended");
      if (commitment && commitment.fingerprint !== fingerprint)
        throw new Error("commitment_conflict");
      if ((spec.kind === "payout" || spec.kind === "create_order") && commitment) {
        throw new Error("new_payment_requires_new_commitment");
      }
      if (
        ["authorize_order", "capture_order", "release_payment", "void_authorization"].includes(
          spec.kind,
        ) &&
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
      let paymentResource: typeof payments.$inferSelect | undefined;
      if (spec.payment) {
        const p = spec.payment;
        const c = p.context;
        if (
          Date.parse(p.stage === "void_authorization" ? c.recoverUntil : c.executeUntil) <=
            Date.now() ||
          Date.parse(c.executeUntil) > Date.now() + 86_400_000 ||
          Date.parse(c.recoverUntil) > Date.now() + 172_800_000
        )
          throw new Error("payment_deadline");
        [paymentResource] = await tx
          .select()
          .from(payments)
          .where(eq(payments.commitmentId, spec.commitmentId));
        if (p.stage === "create_order") {
          if (paymentResource || p.orderId || p.authorizationId) throw new Error("payment_exists");
        } else {
          if (
            !paymentResource ||
            paymentResource.runId !== runId ||
            sandboxPayloadHash(paymentResource.context) !== sandboxPayloadHash(c) ||
            !sandboxPaymentPredecessor(p, paymentResource.result)
          )
            throw new Error("payment_lineage");
        }
        if (p.stage === "void_authorization") {
          const prior = await tx
            .select()
            .from(operations)
            .where(eq(operations.commitmentId, spec.commitmentId));
          const dispatched = await tx
            .select({ id: attempts.id })
            .from(attempts)
            .innerJoin(operations, eq(operations.id, attempts.operationId))
            .where(
              and(
                eq(operations.commitmentId, spec.commitmentId),
                eq(attempts.kind, "business"),
                eq(attempts.dispatched, 1),
                sql`${operations.spec}->>'kind' = 'capture_order'`,
              ),
            );
          if (
            dispatched.length ||
            prior.some((op) => op.claimToken || op.heldCalls > 0) ||
            !prior.some((op) => op.spec.kind === "authorize_order" && op.state === "succeeded")
          )
            throw new Error("cleanup_not_available");
          if (
            !paymentResource ||
            paymentResource.remainingCalls < paymentStageCalls(p.stage, spec.recoveryCalls)
          )
            throw new Error("payment_allowance");
        }
      } else if (commitment) {
        const [paymentResource] = await tx
          .select()
          .from(payments)
          .where(eq(payments.commitmentId, spec.commitmentId));
        if (paymentResource) throw new Error("payment_context_required");
      }
      const reservedExtra = spec.payment
        ? spec.payment.stage === "void_authorization"
          ? spec.feeBoundCents
          : commitment
            ? 0
            : principal + Object.values(spec.payment.context.feeBounds).reduce((a, b) => a + b, 0)
        : extra;
      const requiredCalls = spec.payment
        ? paymentResource
          ? 0
          : paymentTotalCalls(spec.payment.context)
        : sandboxRequestAllowance(spec);
      const decision = sandboxEligibility({
        allocation,
        spec,
        additionalCents: reservedExtra,
        requiredCalls,
      });
      if (decision !== "allowed") throw new Error(decision);
      if (!commitment)
        await tx
          .insert(commitments)
          .values({ id: spec.commitmentId, allocationId: 1, fingerprint, cents: principal });
      await tx
        .update(allocations)
        .set({
          reservedCents: allocation.reservedCents + reservedExtra,
          ...(spec.payment && !paymentResource
            ? { heldCalls: allocation.heldCalls + requiredCalls }
            : {}),
        })
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
          semanticKey,
          state: needsSandboxApproval(spec) ? "awaiting_approval" : "ready",
        })
        .returning();
      if (!operation) throw new Error("prepare_failed");
      if (spec.payment && !paymentResource)
        await tx.insert(payments).values({
          commitmentId: spec.commitmentId,
          runId,
          context: spec.payment.context,
          remainingCalls: requiredCalls,
          result: { evidence: "inconclusive" },
        });
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
      if (op?.spec.payment) await this.requireNoCleanup(tx, op.spec);
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

  async buyerChange(id: string) {
    const [row] = await this.db.select().from(buyerChanges).where(eq(buyerChanges.id, id));
    if (!row) throw new Error("buyer_change_missing");
    return row;
  }

  async maintenanceRecord(id: string) {
    const [row] = await this.db.select().from(maintenance).where(eq(maintenance.id, id));
    if (!row) throw new Error("maintenance_missing");
    return row;
  }

  maintenanceSummary(row: typeof maintenance.$inferSelect) {
    return SandboxMaintenanceSummary.parse({
      id: row.id,
      operationId: row.operationId,
      kind: row.input.kind,
      state: row.state,
      approvalHash: row.approvalHash,
      additionalCalls: 2,
      ...(row.targetContext
        ? { product: row.targetContext.product, mappingVersion: row.targetContext.mappingVersion }
        : {}),
    });
  }

  private maintenanceHash(
    row: Pick<
      typeof maintenance.$inferSelect,
      "id" | "operationId" | "input" | "sourceSpec" | "targetContext" | "orderId"
    >,
  ) {
    return sandboxPayloadHash({ ...row, additionalCalls: 2 });
  }

  private async maintenanceCandidate(
    tx: Tx,
    operationId: string,
    recovering = false,
    kind?: SandboxMaintenanceInput["kind"],
  ) {
    const [op] = await tx
      .select()
      .from(operations)
      .where(eq(operations.id, operationId))
      .for("update");
    if (
      !op ||
      (recovering
        ? op.state !== "recovering"
        : !["waiting_for_browser", "inconclusive"].includes(op.state) &&
          !(kind === "onboarding_product" && op.state === "blocked")) ||
      (!recovering && op.claimToken) ||
      op.payloadHash !== sandboxPayloadHash(SandboxOperationSpec.parse(op.spec))
    )
      throw new Error("maintenance_not_available");
    const [buyerChange] = await tx
      .select()
      .from(buyerChanges)
      .where(eq(buyerChanges.operationId, op.id));
    if (buyerChange && buyerChange.state !== "applied") throw new Error("buyer_change_pending");
    if (op.spec.onboarding) {
      const [resource] = await tx
        .select()
        .from(onboarding)
        .where(eq(onboarding.operationId, op.id));
      if (
        !resource?.referralId ||
        resource.evidence?.reason !== "product_inactive" ||
        Date.parse(op.spec.onboarding.checkUntil) <= Date.now()
      )
        throw new Error("product_change_not_available");
    } else {
      const p = await this.paymentWithin(tx, op.commitmentId);
      const stages = await tx
        .select()
        .from(operations)
        .where(eq(operations.commitmentId, op.commitmentId));
      const [c] = await tx.select().from(commitments).where(eq(commitments.id, op.commitmentId));
      if (
        !op.spec.payment ||
        op.spec.kind !== "create_order" ||
        stages.length !== 1 ||
        !c ||
        c.committed ||
        op.feeCommitted ||
        p.result.evidence !== "order_created" ||
        !p.result.orderId ||
        p.result.authorizationId ||
        p.result.captureId ||
        sandboxPayloadHash(p.context) !== sandboxPayloadHash(op.spec.payment.context)
      )
        throw new Error("retirement_not_available");
    }
    return op;
  }

  private validateMaintenance(row: typeof maintenance.$inferSelect, op: StoredOperation) {
    const binding = {
      id: row.id,
      operationId: row.operationId,
      input: row.input,
      sourceSpec: row.sourceSpec,
      targetContext: row.targetContext,
      orderId: row.orderId,
    };
    if (
      row.operationId !== op.id ||
      sandboxPayloadHash(row.sourceSpec) !== op.payloadHash ||
      this.maintenanceHash(binding) !== row.approvalHash ||
      (row.input.kind === "onboarding_product" &&
        sandboxPayloadHash(sandboxProductContext(op.spec, row.input)) !==
          sandboxPayloadHash(row.targetContext))
    )
      throw new Error("maintenance_stale");
  }

  async proposeMaintenance(operationId: string, input: unknown) {
    const change = SandboxMaintenanceInput.parse(input);
    return this.db.transaction(async (tx) => {
      await this.allocation(tx);
      const op = await this.maintenanceCandidate(tx, operationId, false, change.kind);
      if ((change.kind === "onboarding_product") !== Boolean(op.spec.onboarding))
        throw new Error("maintenance_kind");
      const targetContext =
        change.kind === "onboarding_product" ? sandboxProductContext(op.spec, change) : null;
      const orderId =
        change.kind === "retire_order"
          ? ((await this.paymentWithin(tx, op.commitmentId)).result.orderId ?? null)
          : null;
      const [prior] = await tx.select().from(maintenance).where(eq(maintenance.operationId, op.id));
      if (prior) {
        if (sandboxPayloadHash(prior.input) !== sandboxPayloadHash(change))
          throw new Error("maintenance_exists");
        return this.maintenanceSummary(prior);
      }
      const values = {
        id: randomUUID(),
        operationId,
        input: change,
        sourceSpec: op.spec,
        targetContext,
        orderId,
      };
      const [row] = await tx
        .insert(maintenance)
        .values({
          ...values,
          approvalHash: this.maintenanceHash(values),
          state: "awaiting_approval",
        })
        .returning();
      if (!row) throw new Error("maintenance_prepare_failed");
      return this.maintenanceSummary(row);
    });
  }

  async approveMaintenance(id: string, approvalHash: string) {
    await this.db.transaction(async (tx) => {
      const a = await this.allocation(tx);
      const [row] = await tx.select().from(maintenance).where(eq(maintenance.id, id)).for("update");
      if (row?.state !== "awaiting_approval" || row.approvalHash !== approvalHash)
        throw new Error("maintenance_approval_mismatch");
      const op = await this.maintenanceCandidate(tx, row.operationId, false, row.input.kind);
      this.validateMaintenance(row, op);
      if (a.consumedCalls + a.heldCalls + 2 > 50) throw new Error("call_limit");
      await tx
        .update(allocations)
        .set({ heldCalls: a.heldCalls + 2 })
        .where(eq(allocations.id, 1));
      await tx
        .update(operations)
        .set({ heldCalls: op.heldCalls + 2 })
        .where(eq(operations.id, op.id));
      await tx
        .update(maintenance)
        .set({ state: "approved", approvedAt: new Date() })
        .where(eq(maintenance.id, id));
    });
  }

  async beginMaintenance(id: string): Promise<DispatchClaim> {
    return this.db.transaction(async (tx) => {
      await this.allocation(tx);
      const [row] = await tx.select().from(maintenance).where(eq(maintenance.id, id)).for("update");
      if (row?.state !== "approved" || row.claimToken)
        throw new Error("maintenance_approval_required");
      const op = await this.maintenanceCandidate(tx, row.operationId, false, row.input.kind);
      this.validateMaintenance(row, op);
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
      await tx.update(maintenance).set({ claimToken: token }).where(eq(maintenance.id, id));
      return { operation: claimed, token, attemptId: randomUUID() };
    });
  }

  async finishMaintenance(claim: DispatchClaim, id: string, evidence?: unknown) {
    await this.db.transaction(async (tx) => {
      const a = await this.allocation(tx);
      const op = await this.maintenanceCandidate(tx, claim.operation.id, true);
      const [row] = await tx.select().from(maintenance).where(eq(maintenance.id, id)).for("update");
      if (
        row?.state !== "approved" ||
        row.claimToken !== claim.token ||
        op.claimToken !== claim.token ||
        !op.claimUntil ||
        !(await this.leaseActive(tx, op.id))
      )
        throw new Error("stale_claim");
      this.validateMaintenance(row, op);
      const requestRows = await tx
        .select()
        .from(attempts)
        .where(and(eq(attempts.operationId, op.id), eq(attempts.claimToken, claim.token)));
      if (requestRows.length !== 2 || requestRows.some((r) => r.outcome !== "completed"))
        throw new Error("maintenance_read_required");
      let calls = op.heldCalls;
      let cents = 0;
      if (row.input.kind === "onboarding_product") {
        await this.persistOnboarding(
          tx,
          op,
          SandboxOutcome.parse({
            state: "succeeded",
            onboarding: { evidence },
          }),
        );
      } else {
        const p = await this.paymentWithin(tx, op.commitmentId);
        if (row.orderId !== p.result.orderId) throw new Error("maintenance_stale");
        sandboxRetirementOrder(op.spec, row.orderId ?? "", evidence);
        calls += p.remainingCalls;
        cents =
          p.context.principalCents +
          Object.values(p.context.feeBounds).reduce((sum, c) => sum + c, 0);
        await tx
          .update(payments)
          .set({ remainingCalls: 0, readinessAt: null })
          .where(eq(payments.commitmentId, op.commitmentId));
      }
      await tx
        .update(allocations)
        .set({ heldCalls: a.heldCalls - calls, reservedCents: a.reservedCents - cents })
        .where(eq(allocations.id, 1));
      await tx
        .update(operations)
        .set({
          state: row.input.kind === "retire_order" ? "blocked" : "succeeded",
          heldCalls: 0,
          claimToken: null,
          claimUntil: null,
        })
        .where(eq(operations.id, op.id));
      await tx.update(waits).set({ resolved: 1 }).where(eq(waits.operationId, op.id));
      await tx
        .update(maintenance)
        .set({ state: "applied", appliedAt: new Date() })
        .where(eq(maintenance.id, id));
    });
  }

  async failMaintenance(claim: DispatchClaim, id: string) {
    await this.db.transaction(async (tx) => {
      await this.allocation(tx);
      const [row] = await tx
        .select()
        .from(maintenance)
        .where(
          and(
            eq(maintenance.id, id),
            eq(maintenance.claimToken, claim.token),
            eq(maintenance.state, "approved"),
          ),
        )
        .for("update");
      if (!row) throw new Error("stale_claim");
      await tx
        .update(operations)
        .set({ state: "inconclusive", claimToken: null, claimUntil: null })
        .where(and(eq(operations.id, row.operationId), eq(operations.claimToken, claim.token)));
      await tx.update(maintenance).set({ state: "failed" }).where(eq(maintenance.id, id));
    });
  }

  buyerChangeSummary(row: typeof buyerChanges.$inferSelect) {
    const before = row.sourceSpec.payment?.context;
    const after = row.targetSpec.payment?.context;
    if (!before || !after) throw new Error("buyer_change_invalid");
    return SandboxBuyerChangeSummary.parse({
      id: row.id,
      operationId: row.operationId,
      approvalHash: row.approvalHash,
      state: row.state,
      fromBuyerMappingVersion: before.buyerMappingVersion,
      toBuyerMappingVersion: after.buyerMappingVersion,
      principalCents: after.principalCents,
      additionalCalls: 4,
      executeUntil: after.executeUntil,
      recoverUntil: after.recoverUntil,
    });
  }

  private async buyerChangeCandidate(
    tx: Tx,
    operationId: string,
    state: "waiting_for_browser" | "recovering",
  ) {
    const [op] = await tx
      .select()
      .from(operations)
      .where(eq(operations.id, operationId))
      .for("update");
    if (
      !op ||
      op.state !== state ||
      op.spec.kind !== "create_order" ||
      !op.spec.payment ||
      op.payloadHash !== sandboxPayloadHash(SandboxOperationSpec.parse(op.spec))
    )
      throw new Error("buyer_change_not_available");
    const [maintenanceRow] = await tx
      .select()
      .from(maintenance)
      .where(eq(maintenance.operationId, op.id));
    if (maintenanceRow) throw new Error("maintenance_exists");
    const p = await this.paymentWithin(tx, op.commitmentId);
    const stages = await tx
      .select()
      .from(operations)
      .where(eq(operations.commitmentId, op.commitmentId));
    if (
      stages.length !== 1 ||
      p.result.evidence !== "order_created" ||
      !p.result.orderId ||
      !p.result.artifactKey ||
      p.result.authorizationId ||
      p.result.captureId ||
      sandboxPayloadHash(p.context) !== sandboxPayloadHash(op.spec.payment.context) ||
      Date.parse(p.context.executeUntil) <= Date.now() ||
      Date.parse(p.context.recoverUntil) <= Date.now() ||
      (state === "waiting_for_browser" && op.claimToken)
    )
      throw new Error("buyer_change_not_available");
    return { op, p };
  }

  async proposeBuyerChange(operationId: string, input: unknown) {
    return this.db.transaction(async (tx) => {
      await this.allocation(tx);
      const { op, p } = await this.buyerChangeCandidate(tx, operationId, "waiting_for_browser");
      const targetSpec = sandboxBuyerChangeSpec(op.spec, input);
      const [prior] = await tx
        .select()
        .from(buyerChanges)
        .where(eq(buyerChanges.operationId, op.id));
      if (prior) {
        if (sandboxPayloadHash(prior.targetSpec) !== sandboxPayloadHash(targetSpec))
          throw new Error("buyer_change_exists");
        return this.buyerChangeSummary(prior);
      }
      const id = randomUUID();
      const approvalHash = sandboxPayloadHash({
        id,
        operationId,
        sourceSpec: op.spec,
        targetSpec,
        orderId: p.result.orderId,
        additionalCalls: 4,
      });
      const [change] = await tx
        .insert(buyerChanges)
        .values({
          id,
          operationId,
          orderId: p.result.orderId as string,
          sourceSpec: op.spec,
          targetSpec,
          approvalHash,
          state: "awaiting_approval",
        })
        .returning();
      if (!change) throw new Error("buyer_change_failed");
      return this.buyerChangeSummary(change);
    });
  }

  async approveBuyerChange(id: string, approvalHash: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const allocation = await this.allocation(tx);
      const [change] = await tx
        .select()
        .from(buyerChanges)
        .where(eq(buyerChanges.id, id))
        .for("update");
      if (change?.state !== "awaiting_approval" || change.approvalHash !== approvalHash)
        throw new Error("buyer_change_approval_mismatch");
      const { op, p } = await this.buyerChangeCandidate(
        tx,
        change.operationId,
        "waiting_for_browser",
      );
      this.validateBuyerChange(change, op, p.result.orderId);
      if (allocation.consumedCalls + allocation.heldCalls + 4 > 50) throw new Error("call_limit");
      await tx
        .update(allocations)
        .set({ heldCalls: allocation.heldCalls + 4 })
        .where(eq(allocations.id, 1));
      await tx
        .update(operations)
        .set({ heldCalls: op.heldCalls + 4 })
        .where(eq(operations.id, op.id));
      await tx
        .update(buyerChanges)
        .set({ state: "approved", approvedAt: new Date() })
        .where(eq(buyerChanges.id, id));
    });
  }

  private validateBuyerChange(
    change: typeof buyerChanges.$inferSelect,
    op: StoredOperation,
    orderId?: string,
  ) {
    const target = change.targetSpec.payment?.context;
    if (
      !target ||
      change.orderId !== orderId ||
      sandboxPayloadHash(change.sourceSpec) !== op.payloadHash ||
      sandboxPayloadHash(
        sandboxBuyerChangeSpec(op.spec, {
          buyerMerchantId: target.buyerMerchantId,
          buyerMappingVersion: target.buyerMappingVersion,
        }),
      ) !== sandboxPayloadHash(change.targetSpec) ||
      change.approvalHash !==
        sandboxPayloadHash({
          id: change.id,
          operationId: change.operationId,
          sourceSpec: change.sourceSpec,
          targetSpec: change.targetSpec,
          orderId: change.orderId,
          additionalCalls: 4,
        })
    )
      throw new Error("buyer_change_stale");
  }

  async applyBuyerChange(claim: DispatchClaim, id: string, orderId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.allocation(tx);
      const { op, p } = await this.buyerChangeCandidate(tx, claim.operation.id, "recovering");
      if (op.claimToken !== claim.token || !op.claimUntil || !(await this.leaseActive(tx, op.id)))
        throw new Error("stale_claim");
      const [change] = await tx
        .select()
        .from(buyerChanges)
        .where(eq(buyerChanges.id, id))
        .for("update");
      if (
        !change ||
        change.operationId !== op.id ||
        change.state !== "approved" ||
        change.orderId !== orderId
      )
        throw new Error("buyer_change_approval_required");
      this.validateBuyerChange(change, op, p.result.orderId);
      const context = change.targetSpec.payment?.context;
      if (!context) throw new Error("buyer_change_invalid");
      await tx
        .update(operations)
        .set({
          spec: change.targetSpec,
          payloadHash: sandboxPayloadHash(change.targetSpec),
          state: "waiting_for_browser",
          claimToken: null,
          claimUntil: null,
        })
        .where(eq(operations.id, op.id));
      await tx
        .update(payments)
        .set({ context, readinessAt: null })
        .where(eq(payments.commitmentId, op.commitmentId));
      await tx
        .update(buyerChanges)
        .set({ state: "applied", appliedAt: new Date() })
        .where(eq(buyerChanges.id, id));
    });
  }

  private async buyerChangeRecoveryLimit(tx: Tx, op: StoredOperation) {
    const [change] = await tx
      .select()
      .from(buyerChanges)
      .where(eq(buyerChanges.operationId, op.id));
    return op.spec.recoveryCalls + (change && change.state !== "awaiting_approval" ? 2 : 0);
  }

  async retryUndispatched(operationId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const allocation = await this.allocation(tx);
      const [op] = await tx
        .select()
        .from(operations)
        .where(eq(operations.id, operationId))
        .for("update");
      if (
        !op ||
        !["inconclusive", "failed", "dispatching", "recovering"].includes(op.state) ||
        (await this.leaseActive(tx, op.id))
      )
        throw new Error("undispatched_retry_not_available");
      if (op.payloadHash !== sandboxPayloadHash(SandboxOperationSpec.parse(op.spec)))
        throw new Error("payload_changed");
      const writes = await tx
        .select()
        .from(attempts)
        .where(and(eq(attempts.operationId, op.id), eq(attempts.kind, "business")));
      if (!writes.length || writes.some((attempt) => attempt.dispatched !== 0))
        throw new Error("operation_may_have_dispatched");
      if (op.spec.payment) {
        await this.requireNoCleanup(tx, op.spec);
        const p = await this.paymentWithin(tx, op.commitmentId);
        if (Date.parse(p.context.recoverUntil) <= Date.now()) throw new Error("payment_deadline");
        await tx
          .update(payments)
          .set({ remainingCalls: p.remainingCalls + op.heldCalls, readinessAt: null })
          .where(eq(payments.commitmentId, op.commitmentId));
      } else {
        if (op.spec.onboarding && Date.parse(op.spec.onboarding.checkUntil) <= Date.now())
          throw new Error("onboarding_deadline");
        await tx
          .update(allocations)
          .set({ heldCalls: allocation.heldCalls - op.heldCalls })
          .where(eq(allocations.id, 1));
      }
      await tx
        .update(operations)
        .set({ state: "awaiting_approval", heldCalls: 0, claimToken: null, claimUntil: null })
        .where(eq(operations.id, op.id));
      await tx
        .update(attempts)
        .set({ outcome: "inconclusive" })
        .where(and(eq(attempts.operationId, op.id), eq(attempts.dispatched, 0)));
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
      if (op.spec.payment) await this.requireNoCleanup(tx, op.spec);
      if (op.payloadHash !== sandboxPayloadHash(SandboxOperationSpec.parse(op.spec)))
        throw new Error("payload_changed");
      const allowance = sandboxRequestAllowance(op.spec);
      const stageAllowance = op.spec.payment
        ? paymentStageCalls(op.spec.payment.stage, op.spec.recoveryCalls)
        : allowance;
      if (op.spec.payment) {
        const [p] = await tx
          .select()
          .from(payments)
          .where(eq(payments.commitmentId, op.commitmentId));
        if (
          !p ||
          p.remainingCalls < stageAllowance ||
          Date.parse(
            op.spec.payment.stage === "void_authorization"
              ? p.context.recoverUntil
              : p.context.executeUntil,
          ) <= Date.now()
        )
          throw new Error("payment_allowance");
        if (!sandboxPaymentPredecessor(op.spec.payment, p.result))
          throw new Error("payment_lineage");
        await tx
          .update(payments)
          .set({ remainingCalls: p.remainingCalls - stageAllowance, readinessAt: null })
          .where(eq(payments.commitmentId, op.commitmentId));
      } else if (allocation.consumedCalls + allocation.heldCalls + allowance > 50)
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
          heldCalls: stageAllowance - 1,
          claimUntil: sql`now() + interval '60 seconds'`,
        })
        .where(eq(operations.id, operationId))
        .returning();
      await tx
        .update(allocations)
        .set({
          consumedCalls: allocation.consumedCalls + 1,
          heldCalls: op.spec.payment
            ? allocation.heldCalls - 1
            : allocation.heldCalls + allowance - 1,
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
      if (op.spec.payment) {
        const p = await this.paymentWithin(tx, op.commitmentId);
        if (
          Date.parse(
            op.spec.payment.stage === "void_authorization"
              ? p.context.recoverUntil
              : p.context.executeUntil,
          ) <= Date.now() ||
          !p.readinessAt ||
          Date.now() - p.readinessAt.getTime() > 900_000 ||
          (p.result.providerExpiresAt && Date.parse(p.result.providerExpiresAt) <= Date.now())
        )
          throw new Error("payment_not_ready");
      }
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
      const [maintenanceRow] = await tx
        .select()
        .from(maintenance)
        .where(
          and(
            eq(maintenance.operationId, op.id),
            eq(maintenance.claimToken, claim.token),
            eq(maintenance.state, "approved"),
          ),
        );
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
      if (maintenanceRow || referralClaim) {
        const issued = await tx
          .select()
          .from(attempts)
          .where(and(eq(attempts.operationId, op.id), eq(attempts.claimToken, claim.token)));
        if (
          !["oauth", "recovery"].includes(kind) ||
          issued.length >= 2 ||
          issued.some((attempt) => attempt.kind === kind)
        )
          throw new Error(
            maintenanceRow ? "maintenance_call_limit" : "referral_recovery_call_limit",
          );
      }
      if (
        op.heldCalls <= 0 ||
        allocation.consumedCalls >= 50 ||
        (kind === "recovery" &&
          !maintenanceRow &&
          !referralClaim &&
          op.recoveryReads >= (await this.buyerChangeRecoveryLimit(tx, op)))
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
      await this.persistPayment(tx, op, outcome);
      if (outcome.state === "succeeded") await this.commitMoney(tx, allocation, op);
      if (outcome.state === "succeeded" || outcome.state === "failed") {
        await tx
          .update(allocations)
          .set({
            heldCalls: op.spec.payment
              ? allocation.heldCalls - (await this.releasePaymentCalls(tx, op, outcome))
              : allocation.heldCalls - op.heldCalls,
          })
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
    const claim = await this.db.transaction(async (tx) => {
      const allocation = await this.allocation(tx);
      const [row] = await tx
        .select()
        .from(referralRecoveries)
        .where(eq(referralRecoveries.id, id))
        .for("update");
      if (row?.state !== "approved") throw new Error("referral_recovery_approval_required");
      const op = await this.referralCandidate(tx, row.operationId, Boolean(row.claimToken));
      if (this.referralRecoveryHash(op, row.referralId) !== row.approvalHash)
        throw new Error("referral_recovery_stale");
      if (row.claimToken) {
        if (
          op.claimToken !== row.claimToken ||
          !op.claimUntil ||
          (await this.leaseActive(tx, op.id))
        )
          throw new Error("claim_active");
        const issued = await tx
          .select()
          .from(attempts)
          .where(and(eq(attempts.operationId, op.id), eq(attempts.claimToken, row.claimToken)));
        if (issued.length > 2) throw new Error("referral_recovery_call_limit");
        if (issued.length > 0) {
          const unused = 2 - issued.length;
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
          return null;
        }
      }
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
    if (!claim) throw new Error("referral_recovery_reapproval_required");
    return claim;
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
        !(await this.leaseActive(tx, op.id)) ||
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
        op?.claimToken !== claim.token ||
        op.state !== "recovering" ||
        !op.claimUntil ||
        !(await this.leaseActive(tx, op.id))
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

  async beginRecovery(
    operationId: string,
    buyerChangeId?: string,
    adoptionHash?: string,
  ): Promise<DispatchClaim> {
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
      if (adoptionHash !== undefined) {
        if (op.spec.payment?.stage !== "create_order" || op.payloadHash !== adoptionHash)
          throw new Error("order_adoption_identity_mismatch");
        const resource = await this.paymentWithin(tx, op.commitmentId);
        if (resource.result.orderId) throw new Error("order_already_known");
        const [sent] = await tx
          .select()
          .from(attempts)
          .where(
            and(
              eq(attempts.operationId, op.id),
              eq(attempts.kind, "business"),
              eq(attempts.dispatched, 1),
            ),
          );
        if (!sent) throw new Error("order_not_dispatched");
      }
      const [maintenanceRow] = await tx
        .select()
        .from(maintenance)
        .where(eq(maintenance.operationId, op.id));
      if (maintenanceRow) throw new Error("maintenance_requires_dedicated_command");
      const [change] = await tx
        .select()
        .from(buyerChanges)
        .where(eq(buyerChanges.operationId, op.id));
      if (buyerChangeId) {
        if (!change || change.id !== buyerChangeId || change.state !== "approved")
          throw new Error("buyer_change_approval_required");
      } else if (change && change.state !== "applied") throw new Error("buyer_change_pending");
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
        if (await this.leaseActive(tx, op.id)) throw new Error("claim_active");
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
      if (op.spec.payment) {
        const p = await this.paymentWithin(tx, op.commitmentId);
        if (
          Date.parse(p.context.recoverUntil) <= Date.now() ||
          op.recoveryReads >= (await this.buyerChangeRecoveryLimit(tx, op)) ||
          op.heldCalls <= 1
        )
          throw new Error("payment_recovery_limit");
      }
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
      await this.persistPayment(tx, op, outcome);
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
          .set({
            heldCalls: op.spec.payment
              ? allocation.heldCalls - (await this.releasePaymentCalls(tx, op, outcome))
              : allocation.heldCalls - op.heldCalls,
          })
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

  private async requireNoCleanup(tx: Tx, spec: SandboxOperationSpec) {
    if (spec.kind === "void_authorization") return;
    const [cleanup] = await tx
      .select({ id: operations.id })
      .from(operations)
      .where(
        and(
          eq(operations.commitmentId, spec.commitmentId),
          sql`${operations.spec}->>'kind' = 'void_authorization'`,
        ),
      )
      .limit(1);
    if (cleanup) throw new Error("payment_cleanup_pending");
  }

  private async paymentWithin(tx: Tx, commitmentId: string) {
    const [p] = await tx.select().from(payments).where(eq(payments.commitmentId, commitmentId));
    if (!p) throw new Error("payment_missing");
    return p;
  }

  async paymentResource(commitmentId: string) {
    const [p] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.commitmentId, commitmentId));
    if (!p) throw new Error("payment_missing");
    return p;
  }

  async recordPaymentReadiness(claim: DispatchClaim): Promise<void> {
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
        );
      if (!op?.spec.payment) throw new Error("stale_claim");
      await tx
        .update(payments)
        .set({ readinessAt: new Date() })
        .where(eq(payments.commitmentId, op.commitmentId));
    });
  }

  async requirePaymentConsent(spec: SandboxOperationSpec): Promise<void> {
    const c = spec.payment?.context.seller;
    if (!c) throw new Error("payment_context_required");
    const rows = await this.db
      .select({
        id: operations.id,
        spec: operations.spec,
        state: operations.state,
        evidence: onboarding.evidence,
      })
      .from(onboarding)
      .innerJoin(operations, eq(operations.id, onboarding.operationId))
      .where(
        eq(
          onboarding.sellerKey,
          sandboxPayloadHash({ platform: c.platformMerchantId, seller: c.sellerMerchantId }),
        ),
      );
    const productChanges = await this.db
      .select()
      .from(maintenance)
      .where(eq(maintenance.state, "applied"));
    const valid = rows.some((row) => {
      const amendment = productChanges.find(
        (change) => change.operationId === row.id && change.input.kind === "onboarding_product",
      );
      const prior = amendment?.targetContext ?? row.spec.onboarding;
      return (
        row.state === "succeeded" &&
        row.evidence?.status === "consent_verified" &&
        prior &&
        prior.seller === c.seller &&
        prior.platformClientId === c.platformClientId &&
        prior.mappingVersion === c.mappingVersion &&
        prior.trackingId === c.trackingId &&
        prior.product === c.product &&
        prior.partner.attributionId === c.partner.attributionId &&
        c.requiredScopes.every((s) => prior.requiredScopes.includes(s)) &&
        c.features.every((f) => prior.features.includes(f))
      );
    });
    if (!valid) throw new Error("p3_consent_required");
  }

  private async releasePaymentCalls(
    tx: Tx,
    op: StoredOperation,
    outcome: SandboxOutcome,
  ): Promise<number> {
    const p = await this.paymentWithin(tx, op.commitmentId);
    if (
      outcome.payment?.evidence === "captured_immediate" ||
      outcome.payment?.evidence === "voided"
    ) {
      await tx
        .update(payments)
        .set({ remainingCalls: 0 })
        .where(eq(payments.commitmentId, op.commitmentId));
      return op.heldCalls + p.remainingCalls;
    }
    await tx
      .update(payments)
      .set({ remainingCalls: p.remainingCalls + op.heldCalls })
      .where(eq(payments.commitmentId, op.commitmentId));
    return 0;
  }

  private async persistPayment(
    tx: Tx,
    op: StoredOperation,
    outcome: SandboxOutcome,
  ): Promise<void> {
    if (!op.spec.payment) {
      if (outcome.payment) throw new Error("unexpected_payment_result");
      return;
    }
    if (!outcome.payment) {
      if (outcome.state !== "inconclusive") throw new Error("payment_evidence_required");
      return;
    }
    const result = SandboxPaymentResult.parse(outcome.payment);
    const p = await this.paymentWithin(tx, op.commitmentId);
    const prev = p.result;
    if (
      (prev.orderId && result.orderId && prev.orderId !== result.orderId) ||
      (prev.authorizationId &&
        result.authorizationId &&
        prev.authorizationId !== result.authorizationId) ||
      (prev.captureId && result.captureId && prev.captureId !== result.captureId)
    )
      throw new Error("payment_resource_changed");
    const expected = {
      create_order: "buyer_approved",
      authorize_order: "authorized",
      capture_order: "captured_immediate",
      void_authorization: "voided",
    }[op.spec.payment.stage];
    if (
      outcome.state === "succeeded" &&
      (result.evidence !== expected ||
        !result.orderId ||
        (op.spec.payment.stage !== "create_order" &&
          (!result.authorizationId ||
            (op.spec.payment.stage === "authorize_order" && !result.providerExpiresAt))) ||
        (op.spec.payment.stage === "capture_order" && !result.captureId))
    )
      throw new Error("payment_not_verified");
    if (
      outcome.state === "waiting_for_browser" &&
      (op.spec.payment.stage !== "create_order" ||
        outcome.expectedAlias !== "buyer" ||
        result.artifactKey !== outcome.artifactKey ||
        !result.orderId)
    )
      throw new Error("payment_browser_mismatch");
    await tx
      .update(payments)
      .set({ result: { ...prev, ...result } })
      .where(eq(payments.commitmentId, op.commitmentId));
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
      if (await this.leaseActive(tx, op.id)) throw new Error("claim_active");
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
      await tx
        .update(maintenance)
        .set({ state: "failed", claimToken: null })
        .where(and(eq(maintenance.operationId, op.id), sql`${maintenance.state} <> 'applied'`));
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
      const paymentRows = await tx.select().from(payments).where(eq(payments.runId, runId));
      return SandboxReport.parse({
        runId,
        capability: "not_tested",
        allocation,
        ...(paymentRows.length
          ? {
              payments: paymentRows.map((p) => ({
                commitmentId: p.commitmentId,
                path: p.context.path,
                evidence: p.result.evidence,
                remainingCalls:
                  p.remainingCalls +
                  rows
                    .filter((op) => op.commitmentId === p.commitmentId)
                    .reduce((sum, op) => sum + op.heldCalls, 0),
              })),
            }
          : {}),
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
    const changes = await this.db
      .select({ change: buyerChanges })
      .from(buyerChanges)
      .innerJoin(operations, eq(operations.id, buyerChanges.operationId))
      .where(eq(operations.runId, runId));
    const maintenanceRows = await this.db
      .select({ row: maintenance })
      .from(maintenance)
      .innerJoin(operations, eq(operations.id, maintenance.operationId))
      .where(eq(operations.runId, runId));
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
      maintenance: maintenanceRows.map(({ row }) => this.maintenanceSummary(row)),
      buyerChanges: changes.map(({ change }) => this.buyerChangeSummary(change)),
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
          ...(op.spec.payment
            ? { payment: paymentApproval(op.spec.payment.context, op.spec.payment) }
            : {}),
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
