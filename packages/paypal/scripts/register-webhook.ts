import { createTransport, PAYPAL_WEBHOOK_EVENTS, payPalConfigFromEnv } from "../src/index";

const base = process.argv[2];
if (!base?.startsWith("https://"))
  throw new Error("Usage: pnpm --filter @tranche/paypal webhook:register https://<tunnel-host>");

const t = createTransport(payPalConfigFromEnv());

const { webhooks } = await t.request<{ webhooks: Array<{ id: string; url: string }> }>({
  method: "GET",
  path: "/v1/notifications/webhooks",
});
for (const w of webhooks) {
  if (w.url.endsWith("/api/webhooks/paypal")) {
    await t.request<void>({ method: "DELETE", path: `/v1/notifications/webhooks/${w.id}` });
    console.log(`deleted ${w.id} ${w.url}`);
  }
}

const created = await t.request<{ id: string }>({
  method: "POST",
  path: "/v1/notifications/webhooks",
  body: {
    url: `${base}/api/webhooks/paypal`,
    event_types: PAYPAL_WEBHOOK_EVENTS.map((name) => ({ name })),
  },
});
console.log(`PAYPAL_WEBHOOK_ID=${created.id}`);
