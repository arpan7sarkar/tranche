import { processActions } from "./actions";
import type { Deps } from "./deps";
import { processInbox } from "./inbox";
import { executeOutbox } from "./outbox-executor";
import { claimDueTimers } from "./timers";

export type TickResult = { timers: number; inbox: number; actions: number; outbox: number };

export async function runTick(deps: Deps): Promise<TickResult> {
  const timers = await claimDueTimers(deps);
  const inbox = await processInbox(deps);
  const actions = await processActions(deps);
  const outbox = await executeOutbox(deps);
  return { timers, inbox, actions, outbox };
}

// Ticks until the pipeline is idle or the budget runs out, so one run settles a whole chain
// (proposal -> release -> payout) instead of one step per minute.
export async function drainTicks(deps: Deps, budgetMs = 50_000): Promise<TickResult> {
  const total: TickResult = { timers: 0, inbox: 0, actions: 0, outbox: 0 };
  const until = Date.now() + budgetMs;
  while (Date.now() < until) {
    const r = await runTick(deps);
    total.timers += r.timers;
    total.inbox += r.inbox;
    total.actions += r.actions;
    total.outbox += r.outbox;
    if (r.timers + r.inbox + r.actions + r.outbox === 0) break;
  }
  return total;
}
