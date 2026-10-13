import type {
  SandboxMaintenanceInput,
  SandboxOnboardingContext,
  SandboxOnboardingEvidence,
  SandboxOperationSpec,
  SandboxPaymentContext,
  SandboxPaymentResult,
  SandboxState,
} from "@tranche/contracts";
import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const sandboxAllocation = pgTable(
  "sandbox_allocation",
  {
    id: integer().primaryKey(),
    reservedCents: integer("reserved_cents").notNull().default(0),
    committedCents: integer("committed_cents").notNull().default(0),
    consumedCalls: integer("consumed_calls").notNull().default(0),
    heldCalls: integer("held_calls").notNull().default(0),
  },
  (t) => [
    check("sandbox_single_allocation", sql`${t.id} = 1`),
    check(
      "sandbox_money_limit",
      sql`${t.reservedCents} >= 0 AND ${t.committedCents} >= 0 AND ${t.reservedCents} + ${t.committedCents} <= 100`,
    ),
    check(
      "sandbox_call_limit",
      sql`${t.consumedCalls} >= 0 AND ${t.heldCalls} >= 0 AND ${t.consumedCalls} + ${t.heldCalls} <= 50`,
    ),
  ],
);

export const sandboxRun = pgTable("sandbox_run", {
  id: uuid().primaryKey(),
  allocationId: integer("allocation_id")
    .notNull()
    .references(() => sandboxAllocation.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sandboxCommitment = pgTable(
  "sandbox_commitment",
  {
    id: uuid().primaryKey(),
    allocationId: integer("allocation_id")
      .notNull()
      .references(() => sandboxAllocation.id),
    fingerprint: text().notNull(),
    cents: integer().notNull(),
    committed: integer().notNull().default(0),
  },
  (t) => [
    check("sandbox_principal", sql`${t.cents} BETWEEN 0 AND 100 AND ${t.committed} IN (0, 1)`),
  ],
);

export const sandboxOperation = pgTable("sandbox_operation", {
  id: uuid().primaryKey(),
  runId: uuid("run_id")
    .notNull()
    .references(() => sandboxRun.id),
  commitmentId: uuid("commitment_id")
    .notNull()
    .references(() => sandboxCommitment.id),
  requestId: uuid("request_id").notNull().unique(),
  payloadHash: text("payload_hash").notNull(),
  semanticKey: text("semantic_key").notNull().unique(),
  spec: jsonb().$type<SandboxOperationSpec>().notNull(),
  state: text().$type<SandboxState>().notNull(),
  attempts: integer().notNull().default(0),
  claimToken: uuid("claim_token"),
  claimUntil: timestamp("claim_until", { withTimezone: true }),
  feeCommitted: integer("fee_committed").notNull().default(0),
  heldCalls: integer("held_calls").notNull().default(0),
  recoveryReads: integer("recovery_reads").notNull().default(0),
});

export const sandboxApproval = pgTable(
  "sandbox_approval",
  {
    id: uuid().primaryKey(),
    operationId: uuid("operation_id")
      .notNull()
      .references(() => sandboxOperation.id),
    payloadHash: text("payload_hash").notNull(),
    attempt: integer().notNull(),
    consumed: integer().notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("sandbox_approval_attempt").on(t.operationId, t.attempt)],
);

export const sandboxAttempt = pgTable("sandbox_attempt", {
  id: uuid().primaryKey(),
  runId: uuid("run_id")
    .notNull()
    .references(() => sandboxRun.id),
  operationId: uuid("operation_id").references(() => sandboxOperation.id),
  kind: text().notNull(),
  claimToken: uuid("claim_token"),
  dispatched: integer().notNull().default(0),
  outcome: text().notNull().default("reserved"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sandboxBrowserWait = pgTable("sandbox_browser_wait", {
  operationId: uuid("operation_id")
    .primaryKey()
    .references(() => sandboxOperation.id),
  expectedAlias: text("expected_alias").notNull(),
  artifactKey: uuid("artifact_key").notNull(),
  resolved: integer().notNull().default(0),
});

export const sandboxOnboarding = pgTable("sandbox_onboarding", {
  operationId: uuid("operation_id")
    .primaryKey()
    .references(() => sandboxOperation.id),
  sellerKey: text("seller_key").notNull().unique(),
  trackingKey: text("tracking_key").notNull().unique(),
  referralId: text("referral_id"),
  artifactKey: uuid("artifact_key"),
  evidence: jsonb().$type<SandboxOnboardingEvidence>(),
  checkUntil: timestamp("check_until", { withTimezone: true }).notNull(),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
});

export const sandboxPayment = pgTable(
  "sandbox_payment",
  {
    commitmentId: uuid("commitment_id")
      .primaryKey()
      .references(() => sandboxCommitment.id),
    runId: uuid("run_id")
      .notNull()
      .references(() => sandboxRun.id),
    context: jsonb().$type<SandboxPaymentContext>().notNull(),
    remainingCalls: integer("remaining_calls").notNull(),
    result: jsonb().$type<SandboxPaymentResult>().notNull(),
    readinessAt: timestamp("readiness_at", { withTimezone: true }),
  },
  (t) => [check("sandbox_payment_calls", sql`${t.remainingCalls} BETWEEN 0 AND 50`)],
);

export const sandboxBuyerChange = pgTable("sandbox_buyer_change", {
  id: uuid().primaryKey(),
  operationId: uuid("operation_id")
    .notNull()
    .unique()
    .references(() => sandboxOperation.id),
  orderId: text("order_id").notNull(),
  sourceSpec: jsonb("source_spec").$type<SandboxOperationSpec>().notNull(),
  targetSpec: jsonb("target_spec").$type<SandboxOperationSpec>().notNull(),
  approvalHash: text("approval_hash").notNull(),
  state: text().$type<"awaiting_approval" | "approved" | "applied">().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
});

export const sandboxMaintenance = pgTable("sandbox_maintenance", {
  id: uuid().primaryKey(),
  operationId: uuid("operation_id")
    .notNull()
    .unique()
    .references(() => sandboxOperation.id),
  input: jsonb().$type<SandboxMaintenanceInput>().notNull(),
  sourceSpec: jsonb("source_spec").$type<SandboxOperationSpec>().notNull(),
  targetContext: jsonb("target_context").$type<SandboxOnboardingContext>(),
  orderId: text("order_id"),
  approvalHash: text("approval_hash").notNull(),
  state: text().$type<"awaiting_approval" | "approved" | "applied" | "failed">().notNull(),
  claimToken: uuid("claim_token"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
});

export const sandboxReferralRecovery = pgTable("sandbox_referral_recovery", {
  id: uuid().primaryKey(),
  operationId: uuid("operation_id")
    .notNull()
    .unique()
    .references(() => sandboxOperation.id),
  referralId: text("referral_id").notNull(),
  approvalHash: text("approval_hash").notNull(),
  state: text().$type<"awaiting_approval" | "approved" | "applied" | "failed">().notNull(),
  claimToken: uuid("claim_token"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
});
