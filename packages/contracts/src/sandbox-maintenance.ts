import { z } from "zod";

export const SandboxMaintenanceInput = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("onboarding_product"),
    product: z.literal("PPCP"),
    mappingVersion: z.number().int().positive(),
  }),
  z.strictObject({ kind: z.literal("retire_order") }),
]);
export type SandboxMaintenanceInput = z.infer<typeof SandboxMaintenanceInput>;
export const SandboxRetirementOrder = z.object({
  id: z.string().min(1).max(127),
  intent: z.literal("AUTHORIZE"),
  status: z.enum(["CREATED", "PAYER_ACTION_REQUIRED"]),
  payer: z.object({ payer_id: z.never().optional() }).optional(),
  payment_source: z
    .object({ paypal: z.object({ account_id: z.never().optional() }).optional() })
    .optional(),
  purchase_units: z
    .array(
      z.object({
        reference_id: z.string(),
        amount: z.object({ currency_code: z.literal("USD"), value: z.string() }),
        payee: z.object({ merchant_id: z.string() }),
        payments: z
          .object({
            authorizations: z.array(z.unknown()).max(0).optional(),
            captures: z.array(z.unknown()).max(0).optional(),
          })
          .optional(),
      }),
    )
    .length(1),
});
export const SandboxMaintenanceSummary = z.strictObject({
  id: z.uuid(),
  operationId: z.uuid(),
  kind: z.enum(["onboarding_product", "retire_order"]),
  state: z.enum(["awaiting_approval", "approved", "applied", "failed"]),
  approvalHash: z.string().regex(/^[a-f0-9]{64}$/),
  additionalCalls: z.literal(2),
  product: z.literal("PPCP").optional(),
  mappingVersion: z.number().int().positive().optional(),
});
