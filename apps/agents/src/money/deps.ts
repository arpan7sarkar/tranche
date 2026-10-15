import { createDb, type Db } from "@tranche/db";
import { createPayPalClient, type PayPal, payPalConfigFromEnv } from "@tranche/paypal";

export type { PayPal };
export type Deps = { db: Db; paypal: PayPal; now: () => Date };

// Fails startup rather than moving money on a path that does not exist yet.
export function assertMoneyConfig(env: Record<string, string | undefined> = process.env): void {
  const split = env.SUBCONTRACTOR_SPLIT || "agency_pays";
  if (split !== "agency_pays") {
    throw new Error(
      `SUBCONTRACTOR_SPLIT=${split} is not supported; only agency_pays is (docs/paypal/subcontractor-split.md)`,
    );
  }
}

let cached: Deps | undefined;

export function getDeps(): Deps {
  if (!cached) {
    assertMoneyConfig();
    cached = {
      db: createDb(),
      paypal: createPayPalClient(payPalConfigFromEnv()),
      now: () => new Date(),
    };
  }
  return cached;
}
