import { getDeps } from "./deps";
import { reconcile } from "./reconcile";
import { RECONCILE_TASK } from "./schedule";
import { drainTicks } from "./tick";

export const MONEY_HANDLERS: Record<string, () => Promise<void>> = {
  async moneyTick() {
    console.log(`moneyTick ${JSON.stringify(await drainTicks(getDeps()))}`);
  },
  async [RECONCILE_TASK]() {
    console.log(`reconcile ${JSON.stringify(await reconcile(getDeps()))}`);
  },
};
