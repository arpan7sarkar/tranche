import { getDeps } from "./deps";
import { reconcile } from "./reconcile";
import { RECONCILE_TASK } from "./schedule";
import { drainTicks } from "./tick";

export const MONEY_HANDLERS = {
  async moneyTick() {
    return drainTicks(getDeps());
  },
  async [RECONCILE_TASK]() {
    return reconcile(getDeps());
  },
};
