import { resolveMagicLink } from "@tranche/db";
import { PayPalError } from "@tranche/paypal";
import { isUuid } from "@/lib/uuid";
import { getDb } from "@/server/db";
import { FundingError, startFunding } from "@/server/funding";
import { requireWebMoneyEnabled, withWebMoneyGate } from "@/server/money-gate";
import { appUrl, getPayPal, holdMechanism } from "@/server/paypal";

export const POST = withWebMoneyGate(async function POST(
  _request: Request,
  ctx: RouteContext<"/api/portal/[token]/milestones/[milestoneId]/fund">,
) {
  const { token, milestoneId } = await ctx.params;
  const portal = await resolveMagicLink(getDb(), token);
  if (!portal || !isUuid(milestoneId))
    return Response.json({ error: "This link is invalid or has expired" }, { status: 404 });
  requireWebMoneyEnabled();
  try {
    return Response.json(
      await startFunding(getDb(), getPayPal(), {
        dealId: portal.dealId,
        milestoneId,
        mechanism: holdMechanism(),
        appUrl: appUrl(),
        portalToken: token,
      }),
    );
  } catch (err) {
    if (err instanceof FundingError)
      return Response.json({ error: err.message }, { status: err.status });
    if (err instanceof PayPalError)
      return Response.json(
        { error: "PayPal could not start the payment", debugId: err.debugId },
        { status: 502 },
      );
    throw err;
  }
});
