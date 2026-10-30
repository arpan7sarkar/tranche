import "server-only";
import { launch } from "@tranche/agents-service/launch";
import { after } from "next/server";

// A persisted inbox/outbox and VPS schedule recover missed wakeups.
export function kickMoneyTick(): void {
  after(async () => {
    try {
      await launch("moneyTick", [], `wake:${Math.floor(Date.now() / 10_000)}`, async () => {});
    } catch {
      console.info("money_tick_wakeup_deferred");
    }
  });
}
