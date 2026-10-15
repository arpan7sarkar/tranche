import type { DomainEventType } from "@tranche/contracts";
import { schema } from "@tranche/db";
import type { Tx } from "./db";
import { must } from "./errors";

export async function appendEvent(
  tx: Tx,
  e: {
    type: DomainEventType;
    dealId: string | null;
    milestoneId: string | null;
    payload: Record<string, unknown>;
  },
): Promise<number> {
  const [row] = await tx.insert(schema.event).values(e).returning({ id: schema.event.id });
  return must(row).id;
}
