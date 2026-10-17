import type { SandboxPaymentContext, SandboxPaymentSpec } from "@tranche/contracts";

export function paymentStageCalls(stage: SandboxPaymentSpec["stage"], n: number): number {
  return (
    { create_order: 3, authorize_order: 5, capture_order: 6, void_authorization: 4 }[stage] + 2 * n
  );
}

export function paymentTotalCalls(c: SandboxPaymentContext): number {
  return 14 + 6 * c.recoveryCalls;
}

export function paymentApproval(c: SandboxPaymentContext, payment?: SandboxPaymentSpec) {
  return {
    ...(c.checkout ? { checkout: c.checkout } : {}),
    path: c.path,
    buyerMappingVersion: c.buyerMappingVersion,
    sellerMappingVersion: c.seller.mappingVersion,
    executeUntil: c.executeUntil,
    recoverUntil: c.recoverUntil,
    lifecycleCalls: paymentTotalCalls(c),
    totalFeeBoundCents: Object.values(c.feeBounds).reduce((a, b) => a + b, 0),
    ...(payment?.stage === "void_authorization"
      ? {
          cleanupCalls: paymentStageCalls(payment.stage, c.recoveryCalls),
          cleanupFeeBoundCents: payment.cleanupFeeBoundCents,
        }
      : {}),
  };
}
