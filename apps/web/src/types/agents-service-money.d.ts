// Temporary: H3's @tranche/agents-service/money signatures until feat/h3-pipeline merges. Delete then.
declare module "@tranche/agents-service/money" {
  import type { ProposedActionInput } from "@tranche/contracts";
  import type { Db } from "@tranche/db";

  export function agreeToPlan(db: Db, dealId: string, now?: Date): Promise<void>;
  export function decideApproval(
    db: Db,
    input: { approvalId: string; decision: "approved" | "rejected"; decidedBy: string },
    now?: Date,
  ): Promise<void>;
  export function submitHumanAction(
    db: Db,
    input: ProposedActionInput,
  ): Promise<{ id: string; created: boolean }>;
}
