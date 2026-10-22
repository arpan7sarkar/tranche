import { setTimeout } from "node:timers/promises";
import { AGENT_HANDLERS, closeAgentDb } from "./handlers";

const stop = new AbortController();
process.once("SIGINT", () => stop.abort());
process.once("SIGTERM", () => stop.abort());
try {
  while (!stop.signal.aborted) {
    for (const handler of Object.values(AGENT_HANDLERS)) await handler();
    try {
      await setTimeout(5000, undefined, { signal: stop.signal });
    } catch (error) {
      if (!stop.signal.aborted) throw error;
    }
  }
} finally {
  await closeAgentDb();
}
