import { createInterface } from "node:readline/promises";
import { HoldMechanism } from "@tranche/contracts";
import { platformFee } from "@tranche/core";
import { createPayPalClient, payPalConfigFromEnv } from "../src/index";

const seller = process.env.SANDBOX_SELLER_MERCHANT_ID;
if (!seller) throw new Error("SANDBOX_SELLER_MERCHANT_ID is not set");
const mechanism = HoldMechanism.parse(process.env.HOLD_MECHANISM ?? "authorization");
const paypal = createPayPalClient(payPalConfigFromEnv());
const amount = { currency: "USD", minor: 100 };
const base = {
  mechanism,
  amount,
  platformFee: platformFee(amount),
  payeeMerchantId: seller,
  returnUrl: "https://example.com/return",
  cancelUrl: "https://example.com/cancel",
};

const first = await paypal.createFundingOrder({
  ...base,
  requestId: crypto.randomUUID(),
  milestoneId: "manual-1",
  vaultId: null,
});
console.log(`Approve as the sandbox Personal account:\n${first.approveUrl}`);
const prompt = createInterface({ input: process.stdin, output: process.stdout });
await prompt.question("Press Enter after approving... ");
prompt.close();
const hold1 = await paypal.placeHold({
  requestId: crypto.randomUUID(),
  orderId: first.orderId,
  mechanism,
});
console.log("first hold", hold1);
if (!hold1.vaultId)
  throw new Error("PayPal returned no vault id; vaulted re-funding is unavailable");

const second = await paypal.createFundingOrder({
  ...base,
  requestId: crypto.randomUUID(),
  milestoneId: "manual-2",
  vaultId: hold1.vaultId,
});
console.log("second order (no approval expected)", second);
const hold2 = await paypal.placeHold({
  requestId: crypto.randomUUID(),
  orderId: second.orderId,
  mechanism,
});
console.log("second hold", hold2);
