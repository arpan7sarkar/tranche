import "server-only";
import { createPayPalClient, type PayPal, payPalConfigFromEnv } from "@tranche/paypal";

let paypal: PayPal | undefined;

export function getPayPal(): PayPal {
  paypal ??= createPayPalClient(payPalConfigFromEnv());
  return paypal;
}
