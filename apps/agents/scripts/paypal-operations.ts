import { recoverCreation, registerPayPalWebhook } from "../src/money/creation";
import { getDeps } from "../src/money/deps";
import { startFunding } from "../src/money/funding";
import { holdMechanism } from "../src/money/timers-fund";

export async function runPayPalOperation(args: string[]) {
  const [command, first, second] = args;
  if (
    !first ||
    args.length !== (command === "register-webhook" ? 2 : 3) ||
    !["register-webhook", "fund", "recover"].includes(command ?? "")
  )
    throw new Error(
      "Usage: register-webhook <https-origin> | fund <deal-id> <milestone-id> | recover <outbox-id> <known-resource-id>",
    );
  const deps = getDeps();
  try {
    if (command === "register-webhook") {
      const response = await registerPayPalWebhook(deps, first);
      console.log(`PAYPAL_WEBHOOK_ID=${response?.id}`);
    } else if (command === "recover" && second) {
      await recoverCreation(deps, first, second);
      console.log("Creation recovered and settled; inspect the product state.");
    } else if (second) {
      const base = new URL(process.env.APP_URL ?? "http://localhost:3000").origin;
      const response = await startFunding(deps.db, deps.paypal, {
        dealId: first,
        milestoneId: second,
        states: ["funding"],
        mechanism: holdMechanism(),
        requestId: `fund:${second}`,
        returnUrl: `${base}/portal/return?milestoneId=${second}`,
        cancelUrl: base,
        now: deps.now(),
      });
      console.log(JSON.stringify(response));
    }
  } finally {
    await deps.db.$client.end();
  }
}
