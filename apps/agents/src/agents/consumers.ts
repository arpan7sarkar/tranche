import { consumeEvents, type EventRow } from "@tranche/agents";
import type { DomainEventType } from "@tranche/contracts";
import type { Db } from "@tranche/db";
export type Consumer = {
  name: string;
  types: readonly DomainEventType[];
  handle: (event: EventRow) => Promise<void>;
};
export const consumers: Consumer[] = [];
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
  return consumeEvents(db, consumer.name, consumer.types, consumer.handle);
}
export async function consumeAll(
  db: Db,
  registry: readonly Consumer[] = consumers,
): Promise<number> {
  let count = 0;
  for (const consumer of registry) count += await consume(db, consumer.name, registry);
  return count;
}
