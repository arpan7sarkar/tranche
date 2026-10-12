import {
  SandboxAllocation,
  SandboxBuyerChangeInput,
  SandboxMaintenanceInput,
  SandboxOnboardingContext,
  SandboxOperationSpec,
  type SandboxPaymentResult,
  type SandboxPaymentSpec,
  SandboxRetirementOrder,
} from "@tranche/contracts";

export function sandboxProductContext(source: SandboxOperationSpec, input: unknown) {
  const change = SandboxMaintenanceInput.parse(input);
  const c = source.onboarding;
  if (
    change.kind !== "onboarding_product" ||
    source.kind !== "onboard_seller" ||
    !c ||
    c.product !== "EXPRESS_CHECKOUT" ||
    change.mappingVersion !== c.mappingVersion + 1
  )
    throw new Error("product_change_invalid");
  return SandboxOnboardingContext.parse({
    ...c,
    product: change.product,
    mappingVersion: change.mappingVersion,
  });
}

export function sandboxRetirementOrder(
  source: SandboxOperationSpec,
  orderId: string,
  input: unknown,
) {
  const order = SandboxRetirementOrder.parse(input);
  const p = source.payment;
  const unit = order.purchase_units[0];
  if (
    source.kind !== "create_order" ||
    !p ||
    p.stage !== "create_order" ||
    p.orderId ||
    p.authorizationId ||
    order.id !== orderId ||
    !unit ||
    unit.reference_id !== source.commitmentId ||
    unit.amount.value !== (p.context.principalCents / 100).toFixed(2) ||
    unit.payee.merchant_id !== p.context.seller.sellerMerchantId
  )
    throw new Error("retirement_order_mismatch");
  return order;
}

export function sandboxBuyerChangeSpec(
  source: SandboxOperationSpec,
  input: unknown,
): SandboxOperationSpec {
  const change = SandboxBuyerChangeInput.parse(input);
  const payment = source.payment;
  if (
    source.kind !== "create_order" ||
    !payment ||
    payment.stage !== "create_order" ||
    payment.orderId ||
    payment.authorizationId ||
    change.buyerMerchantId === payment.context.buyerMerchantId ||
    change.buyerMappingVersion !== payment.context.buyerMappingVersion + 1
  )
    throw new Error("buyer_change_invalid");
  return SandboxOperationSpec.parse({
    ...source,
    payment: { ...payment, context: { ...payment.context, ...change } },
  });
}

export function sandboxPaymentPredecessor(
  payment: Pick<SandboxPaymentSpec, "stage" | "orderId" | "authorizationId">,
  result: SandboxPaymentResult,
): boolean {
  if (payment.stage === "create_order") return !payment.orderId && !payment.authorizationId;
  if (!payment.orderId || payment.orderId !== result.orderId) return false;
  return payment.stage === "authorize_order"
    ? result.evidence === "buyer_approved" && !payment.authorizationId
    : result.evidence === "authorized" &&
        Boolean(payment.authorizationId) &&
        payment.authorizationId === result.authorizationId;
}

export function needsSandboxApproval(spec: SandboxOperationSpec): boolean {
  return spec.kind !== "read_status";
}

export function sandboxRequestAllowance(spec: SandboxOperationSpec): number {
  return spec.onboarding ? 2 + 2 * spec.recoveryCalls : 3 + spec.recoveryCalls;
}

export function sandboxApprovalMatches(input: {
  payloadHash: string;
  nextAttempt: number;
  approval: { payloadHash: string; attempt: number; consumed: boolean };
}): boolean {
  return (
    /^[a-f0-9]{64}$/.test(input.payloadHash) &&
    Number.isSafeInteger(input.nextAttempt) &&
    input.nextAttempt > 0 &&
    input.payloadHash === input.approval.payloadHash &&
    input.nextAttempt === input.approval.attempt &&
    !input.approval.consumed
  );
}

export function sandboxEligibility(input: {
  allocation: SandboxAllocation;
  spec: SandboxOperationSpec;
  additionalCents: number;
  requiredCalls: number;
}): "allowed" | "invalid" | "money_limit" | "call_limit" {
  if (
    !SandboxAllocation.safeParse(input.allocation).success ||
    !SandboxOperationSpec.safeParse(input.spec).success ||
    !Number.isSafeInteger(input.additionalCents) ||
    input.additionalCents < 0 ||
    !Number.isSafeInteger(input.requiredCalls) ||
    input.requiredCalls < 0
  )
    return "invalid";
  const { allocation } = input;
  if (allocation.committedCents + allocation.reservedCents + input.additionalCents > 100) {
    return "money_limit";
  }
  if (allocation.consumedCalls + allocation.heldCalls + input.requiredCalls > 50)
    return "call_limit";
  return "allowed";
}
