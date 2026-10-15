import { schema } from "@tranche/db";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { resolvePortalToken } from "@/server/portal";

// End-to-end runs only: stands in for the buyer approving in PayPal's window, against E5's fake PayPal.
function fakePayPalBase(): string | null {
  const base = process.env.PAYPAL_API_BASE;
  if (process.env.NEXT_PUBLIC_E2E_FAKE_PAYPAL !== "1" || !base) return null;
  const host = URL.parse(base)?.hostname ?? "paypal.com";
  return host === "paypal.com" || host.endsWith(".paypal.com") ? null : base;
}

export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/portal/[token]/orders/[orderId]/fake-approve">,
) {
  const base = fakePayPalBase();
  if (!base) return Response.json({ error: "not_found" }, { status: 404 });
  const { token, orderId } = await ctx.params;
  const link = await resolvePortalToken(token);
  if (!link) return Response.json({ error: "invalid_link" }, { status: 404 });
  const [hold] = await getDb()
    .select({ id: schema.hold.id })
    .from(schema.hold)
    .innerJoin(schema.milestone, eq(schema.milestone.id, schema.hold.milestoneId))
    .where(and(eq(schema.hold.paypalOrderId, orderId), eq(schema.milestone.dealId, link.dealId)));
  if (!hold) return Response.json({ error: "not_found" }, { status: 404 });
  const res = await fetch(`${base}/__test/approve/${encodeURIComponent(orderId)}`, {
    method: "POST",
  });
  if (!res.ok) return Response.json({ error: "fake_paypal_failed" }, { status: 502 });
  return new Response(null, { status: 204 });
}
