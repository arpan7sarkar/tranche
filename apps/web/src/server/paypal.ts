import "server-only";
import { HoldMechanism } from "@tranche/contracts";
import { createPayPalClient, type PayPal, payPalConfigFromEnv } from "@tranche/paypal";

let client: PayPal | undefined;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function getPayPal(): PayPal {
  if (!client) {
    required("PAYPAL_CLIENT_ID");
    required("PAYPAL_CLIENT_SECRET");
    client = createPayPalClient(payPalConfigFromEnv());
  }
  return client;
}

export function holdMechanism(): HoldMechanism {
  return HoldMechanism.parse(process.env.HOLD_MECHANISM || "authorization");
}

export function appUrl(): string {
  return required("APP_URL").replace(/\/$/, "");
}
