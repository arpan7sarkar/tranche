import { resolveMagicLink } from "@tranche/db";
import { PayPalError } from "@tranche/paypal";
import { getDb } from "@/server/db";
import { confirmApproval, FundingError } from "@/server/funding";
import { requireWebMoneyEnabled, withWebMoneyGate } from "@/server/money-gate";
import { getPayPal } from "@/server/paypal";

export const POST = withWebMoneyGate(async function POST(
  _request: Request,
  ctx: RouteContext<"/api/portal/[token]/orders/[orderId]/approved">,
) {
  const { token, orderId } = await ctx.params;
  const portal = await resolveMagicLink(getDb(), token);
  if (!portal || !/^[A-Z0-9]{8,40}$/.test(orderId))
    return Response.json({ error: "This link is invalid or has expired" }, { status: 404 });
  requireWebMoneyEnabled();
  try {
    return Response.json(
      await confirmApproval(getDb(), getPayPal(), { dealId: portal.dealId, orderId }),
      {
        status: 202,
      },
    );
  } catch (err) {
    if (err instanceof FundingError)
      return Response.json({ error: err.message }, { status: err.status });
    if (err instanceof PayPalError)
      return Response.json(
        { error: "PayPal could not confirm the payment", debugId: err.debugId },
        { status: 502 },
      );
    throw err;
  }
});
