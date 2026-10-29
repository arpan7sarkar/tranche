import { runMonitor } from "@tranche/agents";
import { createDb, type Db } from "@tranche/db";
import { emailSender } from "../notifications/email";
import { deliverNotifications, queueNotifications } from "../notifications/queue";
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
  async notifications() {
    await queueNotifications(agentDb());
    const send = emailSender();
    if (send) await deliverNotifications(agentDb(), send);
  },
  async monitor() {
    await runMonitor(agentDb());
  },
  async consumeAll() {
    await consumeAll(agentDb());
  },
};
