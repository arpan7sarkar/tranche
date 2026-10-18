import { createDb, type Db } from "@tranche/db";
import { consumeAll } from "./consumers";

let db: Db | undefined;
export function agentDb(): Db {
  db ??= createDb();
  return db;
}
export async function closeAgentDb(): Promise<void> {
  if (db) {
    await db.$client.end();
    db = undefined;
  }
}
export const AGENT_HANDLERS: Record<string, () => Promise<void>> = {
  async consumeAll() {
    await consumeAll(agentDb());
  },
};
