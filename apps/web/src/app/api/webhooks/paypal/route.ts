import { schema } from "@tranche/db";
import { z } from "zod";
import { getDb } from "@/server/db";
import { kickMoneyTick } from "@/server/kick";
import { getPayPal } from "@/server/paypal";

const Envelope = z.object({
  id: z.string().min(1),
  event_type: z.string().min(1),
  resource: z.record(z.string(), z.unknown()),
});

export async function POST(request: Request): Promise<Response> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return new Response("webhook not configured", { status: 500 });

  // PayPal signs the exact bytes, so verification uses the raw body before any parsing.
  const rawBody = await request.text();
  const headers = Object.fromEntries(request.headers);
  if (!(await getPayPal().verifyWebhook({ headers, rawBody, webhookId }))) {
    return new Response("invalid signature", { status: 400 });
  }

  const parsed = Envelope.safeParse(JSON.parse(rawBody));
  if (!parsed.success) return new Response("malformed event", { status: 400 });

  await getDb()
    .insert(schema.inbox)
    .values({
      source: "paypal",
      sourceEventId: parsed.data.id,
      message: {
        type: "paypal.webhook",
        eventType: parsed.data.event_type,
        resource: parsed.data.resource,
      },
    })
    .onConflictDoNothing();
  kickMoneyTick();
  return new Response(null, { status: 200 });
}
