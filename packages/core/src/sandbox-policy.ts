import { SandboxAllocation, SandboxOperationSpec } from "@tranche/contracts";

export function needsSandboxApproval(spec: SandboxOperationSpec): boolean {
  return spec.kind !== "read_status";
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
    input.requiredCalls < 1
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
