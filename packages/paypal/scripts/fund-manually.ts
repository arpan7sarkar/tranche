import { runPayPalOperation } from "../../../apps/agents/scripts/paypal-operations";

await runPayPalOperation(["fund", ...process.argv.slice(2)]);
