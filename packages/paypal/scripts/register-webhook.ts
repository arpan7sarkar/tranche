import { runPayPalOperation } from "../../../apps/agents/scripts/paypal-operations";

await runPayPalOperation(["register-webhook", ...process.argv.slice(2)]);
