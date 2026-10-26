import {
  consumeEvents,
  type EventRow,
  planDeal,
  runNegotiation,
  verifyMilestone,
} from "@tranche/agents";
import type { DomainEventType } from "@tranche/contracts";
import { Id, PlanDealInput } from "@tranche/contracts";
import type { Db } from "@tranche/db";
import { agentDb } from "./handlers";
export type Consumer = {
  name: string;
  types: readonly DomainEventType[];
  handle: (event: EventRow) => Promise<void>;
};
export const consumers: Consumer[] = [
  {
    name: "negotiator",
    types: ["negotiation.started"],
    handle: async (event) => {
      await runNegotiation(agentDb(), Id.parse(event.payload.negotiationId));
    },
  },
  {
    name: "planner",
    types: ["deal.created"],
    handle: async (event) => {
      if (!event.payload.planning) return;
      const input = PlanDealInput.parse(event.payload.planning);
      if (input.dealId !== event.dealId) throw new Error("foreign_plan_event");
      await planDeal(agentDb(), input);
    },
  },
  {
    name: "verifier",
    types: ["milestone.verification_requested"],
    handle: async (event) => {
      await verifyMilestone(agentDb(), event.id);
    },
  },
];
export function registerConsumer(consumer: Consumer): void {
  if (consumers.some((item) => item.name === consumer.name)) throw new Error("duplicate_consumer");
  consumers.push(consumer);
}
export async function consume(
  db: Db,
  name: string,
  registry: readonly Consumer[] = consumers,
): Promise<number> {
  const consumer = registry.find((item) => item.name === name);
  if (!consumer) throw new Error("unknown_consumer");
  return consumeEvents(
    db,
    consumer.name,
    consumer.types,
    consumer.handle,
    50,
    ["planner", "verifier", "negotiator"].includes(consumer.name),
  );
}
export async function consumeAll(
  db: Db,
  registry: readonly Consumer[] = consumers,
): Promise<number> {
  let count = 0;
  for (const consumer of registry) count += await consume(db, consumer.name, registry);
  return count;
}
