import { z } from "zod";
import { SandboxMaintenanceSummary } from "./sandbox-maintenance";
import {
  SandboxOnboardingApproval,
  SandboxOnboardingContext,
  SandboxOnboardingEvidence,
  SandboxOnboardingResult,
  SandboxPartnerContext,
  SandboxSeller,
} from "./sandbox-onboarding";
import {
  SandboxAssertionContext,
  SandboxBuyerChangeSummary,
  SandboxPaymentApproval,
  SandboxPaymentResult,
  SandboxPaymentSpec,
} from "./sandbox-protection";

export const SandboxAlias = z.enum(["platform", "buyer", "seller-a", "seller-b"]);
export const SandboxCents = z.number().int().min(0).max(100);
export const SandboxState = z.enum([
  "awaiting_approval",
  "ready",
  "dispatching",
  "waiting_for_browser",
  "recovering",
  "succeeded",
  "failed",
  "blocked",
  "inconclusive",
]);
export const SandboxOperationKind = z.enum([
  "onboard_seller",
  "create_order",
  "authorize_order",
  "capture_order",
  "void_authorization",
  "release_payment",
  "payout",
  "read_status",
]);
export const SandboxOperationSpec = z
  .strictObject({
    version: z.literal(1),
    kind: SandboxOperationKind,
    currency: z.literal("USD"),
    sender: SandboxAlias,
    recipients: z
      .array(z.strictObject({ alias: SandboxAlias, cents: SandboxCents }))
      .min(1)
      .max(2),
    feeBoundCents: SandboxCents,
    commitmentId: z.uuid(),
    resourceKey: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
    request: z.strictObject({
      method: z.enum(["GET", "POST"]),
      path: z.string().regex(/^\/v[12]\/[A-Za-z0-9/_-]+$/),
      body: z.json().optional(),
      partner: SandboxPartnerContext.optional(),
      assertion: SandboxAssertionContext.optional(),
      representation: z.literal(true).optional(),
    }),
    onboarding: SandboxOnboardingContext.optional(),
    payment: SandboxPaymentSpec.optional(),
    recoveryCalls: z.number().int().min(1).max(10),
  })
  .superRefine((spec, ctx) => {
    if (spec.kind === "void_authorization" && !spec.payment)
      ctx.addIssue({ code: "custom", message: "Cleanup payment context required" });
    if (
      spec.payment &&
      (spec.kind !== spec.payment.stage ||
        spec.sender !== "buyer" ||
        spec.recipients.length !== 1 ||
        spec.recipients[0]?.alias !== spec.payment.context.seller.seller ||
        spec.recipients[0]?.cents !== spec.payment.context.principalCents ||
        spec.feeBoundCents !==
          (spec.payment.stage === "void_authorization"
            ? spec.payment.cleanupFeeBoundCents
            : spec.payment.context.feeBounds[spec.payment.stage]) ||
        (spec.payment.stage !== "void_authorization" &&
          spec.payment.cleanupFeeBoundCents !== undefined) ||
        spec.recoveryCalls !== spec.payment.context.recoveryCalls ||
        spec.onboarding)
    )
      ctx.addIssue({ code: "custom", message: "Invalid payment mapping" });
    if (spec.kind === "onboard_seller" && !spec.onboarding)
      ctx.addIssue({ code: "custom", message: "Onboarding configuration required" });
    if (
      spec.onboarding &&
      (spec.kind !== "onboard_seller" ||
        spec.sender !== "platform" ||
        spec.recipients.length !== 1 ||
        spec.recipients[0]?.alias !== spec.onboarding.seller ||
        spec.recipients[0]?.cents !== 0 ||
        spec.feeBoundCents !== 0)
    ) {
      ctx.addIssue({ code: "custom", message: "Invalid onboarding mapping" });
    }
    if (new Set(spec.recipients.map((r) => r.alias)).size !== spec.recipients.length) {
      ctx.addIssue({ code: "custom", message: "Duplicate recipient" });
    }
    if (spec.recipients.some((r) => r.alias === spec.sender)) {
      ctx.addIssue({ code: "custom", message: "Sender cannot be recipient" });
    }
    if (spec.recipients.reduce((sum, r) => sum + r.cents, 0) + spec.feeBoundCents > 100) {
      ctx.addIssue({ code: "custom", message: "Allocation exceeded" });
    }
    if (
      spec.request.method !== (spec.kind === "read_status" ? "GET" : "POST") ||
      spec.request.path.includes("//") ||
      spec.request.path === "/v1/oauth2/token" ||
      (spec.request.method === "GET" && spec.request.body !== undefined)
    ) {
      ctx.addIssue({ code: "custom", message: "Invalid operation request" });
    }
  });
export type SandboxOperationSpec = z.infer<typeof SandboxOperationSpec>;
export type SandboxState = z.infer<typeof SandboxState>;

export const SandboxAllocation = z.strictObject({
  id: z.literal(1),
  currency: z.literal("USD"),
  limitCents: z.literal(100),
  callLimit: z.literal(50),
  reservedCents: SandboxCents,
  committedCents: SandboxCents,
  consumedCalls: z.number().int().min(0).max(50),
  heldCalls: z.number().int().min(0).max(50),
});
export type SandboxAllocation = z.infer<typeof SandboxAllocation>;

export const SandboxRun = z.strictObject({ id: z.uuid(), allocationId: z.literal(1) });
export const SandboxBrowserWait = z.strictObject({
  operationId: z.uuid(),
  expectedAlias: SandboxAlias,
  artifactKey: z.uuid(),
  resolved: z.boolean(),
});
export const SandboxAttempt = z.strictObject({
  id: z.uuid(),
  runId: z.uuid(),
  operationId: z.uuid().nullable(),
  kind: z.enum(["business", "oauth", "read", "recovery"]),
  dispatched: z.boolean(),
  outcome: z.enum([
    "reserved",
    "completed",
    "inconclusive",
    "succeeded",
    "failed",
    "waiting_for_browser",
  ]),
});

export const SandboxApprovalSummary = z.strictObject({
  operationId: z.uuid(),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  nextAttempt: z.number().int().positive(),
  purpose: SandboxOperationKind,
  sender: SandboxAlias,
  recipients: z.array(z.strictObject({ alias: SandboxAlias, cents: SandboxCents })),
  feeBoundCents: SandboxCents,
  onboarding: SandboxOnboardingApproval.optional(),
  payment: SandboxPaymentApproval.optional(),
});

export const SandboxOutcome = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("succeeded"),
    onboarding: SandboxOnboardingResult.optional(),
    payment: SandboxPaymentResult.optional(),
  }),
  z.strictObject({
    state: z.literal("failed"),
    onboarding: SandboxOnboardingResult.optional(),
    payment: SandboxPaymentResult.optional(),
  }),
  z.strictObject({
    state: z.literal("inconclusive"),
    payment: SandboxPaymentResult.optional(),
    onboarding: SandboxOnboardingResult.optional(),
  }),
  z.strictObject({
    state: z.literal("waiting_for_browser"),
    payment: SandboxPaymentResult.optional(),
    expectedAlias: SandboxAlias,
    artifactKey: z.uuid(),
    onboarding: SandboxOnboardingResult.optional(),
  }),
]);
export type SandboxOutcome = z.infer<typeof SandboxOutcome>;

export const SandboxReport = z.strictObject({
  runId: z.uuid(),
  capability: z.literal("not_tested"),
  payments: z
    .array(
      z.strictObject({
        commitmentId: z.uuid(),
        path: z.literal("authorization_capture"),
        evidence: SandboxPaymentResult.shape.evidence,
        remainingCalls: z.number().int().min(0).max(50),
      }),
    )
    .optional(),
  allocation: SandboxAllocation,
  operations: z.array(
    z.strictObject({
      id: z.uuid(),
      kind: SandboxOperationKind,
      state: SandboxState,
      attempts: z.number().int().nonnegative(),
    }),
  ),
  onboarding: z
    .array(
      z.strictObject({
        operationId: z.uuid(),
        seller: SandboxSeller,
        evidence: SandboxOnboardingEvidence,
      }),
    )
    .optional(),
});
export type SandboxReport = z.infer<typeof SandboxReport>;

export const SandboxInspection = z.strictObject({
  maintenance: z.array(SandboxMaintenanceSummary).optional(),
  buyerChanges: z.array(SandboxBuyerChangeSummary).optional(),
  report: SandboxReport,
  approvals: z.array(SandboxApprovalSummary),
  browserWaits: z.array(SandboxBrowserWait),
});
