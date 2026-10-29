import { createServer } from "node:http";
import { setTimeout } from "node:timers/promises";
import { consumeEvents, defaultVerifyDeps, planDeal, verifyMilestone } from "@tranche/agents";
import { scriptedModel } from "@tranche/agents/testing";
import { runTick } from "@tranche/agents-service/money";
import { PlanDealInput } from "@tranche/contracts";
import { createDb } from "@tranche/db";
import { createPayPalClient, payPalConfigFromEnv } from "@tranche/paypal";
import {
  deliverNotifications,
  queueNotifications,
} from "../../apps/agents/src/notifications/queue";
import { fakeGitHub, githubFixture } from "../fakes/github";
import { startFakePayPal } from "../fakes/paypal";
import { startStagingSite } from "../fakes/staging";
import { appEnv } from "../support/environment";

Object.assign(process.env, appEnv);
process.env.TRANCHE_LLM = "on";
const db = createDb(appEnv.DATABASE_URL);
const paypal = createPayPalClient(payPalConfigFromEnv(appEnv));
const verifier = defaultVerifyDeps();
verifier.checks.github = () => fakeGitHub(githubFixture);
verifier.model = () => {
  throw new Error("offline_verifier_model_unconfigured");
};
const emails = new Map<string, { to: string; subject: string; body: string }>();
await startFakePayPal({ port: 4010, webhookUrl: `${appEnv.APP_URL}/api/webhooks/paypal` });
await startStagingSite(4020);
const server = createServer((req, res) => {
  if (req.url === "/emails") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify([...emails.values()]));
  } else res.end("offline services ready");
});
server.listen(4030, "127.0.0.1");
for (;;) {
  try {
    await runTick({ db, paypal, now: () => new Date() });
    await consumeEvents(db, "e2e-planner", ["deal.created"], async (event) => {
      if (!event.payload.planning) return;
      const input = PlanDealInput.parse(event.payload.planning);
      if (input.dealId !== event.dealId) throw new Error("foreign_plan_event");
      await planDeal(
        db,
        input,
        scriptedModel([
          {
            summary: "A storefront with a working checkout",
            currency: "USD",
            milestones: [
              {
                key: "build",
                title: "Storefront",
                price: { currency: "USD", minor: 180000 },
                criteria: { checks: [{ kind: "url_live", url: input.stagingUrl }], prose: [] },
                payees: [{ kind: "agency", shareBps: 10000 }],
              },
            ],
            tasks: [
              {
                key: "build",
                title: "Build storefront",
                durationDays: 3,
                dependsOn: [],
                milestoneKey: "build",
              },
            ],
          },
        ]),
      );
    });
    await consumeEvents(db, "e2e-verifier", ["milestone.verification_requested"], async (event) => {
      await verifyMilestone(db, event.id, verifier);
    });
    await queueNotifications(db);
    await deliverNotifications(db, async (email) => {
      const previous = emails.get(email.key);
      const payload = { to: email.to, subject: email.subject, body: email.body };
      if (previous && JSON.stringify(previous) !== JSON.stringify(payload))
        throw new Error("fake_email_identity_conflict");
      emails.set(email.key, payload);
      return email.key;
    });
  } catch {
    // Global setup creates and migrates the isolated database after services start.
  }
  await setTimeout(300);
}
