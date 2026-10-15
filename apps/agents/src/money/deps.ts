import { createDb, type Db } from "@tranche/db";
import { createPayPalClient, type PayPal, payPalConfigFromEnv } from "@tranche/paypal";

export type { PayPal };
export type Deps = { db: Db; paypal: PayPal; now: () => Date };

let cached: Deps | undefined;

export function getDeps(): Deps {
  cached ??= {
    db: createDb(),
    paypal: createPayPalClient(payPalConfigFromEnv()),
    now: () => new Date(),
  };
  return cached;
}
