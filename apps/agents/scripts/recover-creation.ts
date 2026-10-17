import { runPayPalOperation } from "./paypal-operations";

await runPayPalOperation(["recover", ...process.argv.slice(2)]);
