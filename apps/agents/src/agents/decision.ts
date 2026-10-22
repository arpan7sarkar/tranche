import { decideAction, type Models, proposeAction } from "@tranche/agents";
import type { ProposedActionInput } from "@tranche/contracts";
import { type Db, schema } from "@tranche/db";
import { eq } from "drizzle-orm";
import type { Consumer } from "./consumers";

export function decisionConsumer(
  db: Db,
  config: {
    name: string;
    version: string;
    types: Consumer["types"];
    agent: Exclude<ProposedActionInput["agent"], "human" | "system">;
    side: ProposedActionInput["side"];
    models: () => Models;
    instructions: string;
    context: (event: Parameters<Consumer["handle"]>[0]) => Promise<string>;
  },
): Consumer {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(config.name) || !/^[a-zA-Z0-9._-]{1,40}$/.test(config.version))
    throw new Error("invalid_decision_identity");
  return {
    name: config.name,
    types: config.types,
    async handle(event) {
      if (!event.dealId) throw new Error("event_deal_required");
      const idempotencyKey = `agent:${config.name}:${config.version}:${event.id}`;
      // A committed proposal is the durable decision if the worker died before its receipt.
      const [existing] = await db
        .select()
        .from(schema.proposedAction)
        .where(eq(schema.proposedAction.idempotencyKey, idempotencyKey));
      if (existing) {
        if (
          existing.dealId !== event.dealId ||
          existing.agent !== config.agent ||
          existing.side !== config.side
        )
          throw new Error("proposal_identity_conflict");
        return;
      }
      const decision = await decideAction(
        { instructions: config.instructions, context: await config.context(event) },
        config.models().judge,
      );
      await proposeAction(db, {
        ...decision,
        dealId: event.dealId,
        agent: config.agent,
        side: config.side,
        idempotencyKey,
      });
    },
  };
}
