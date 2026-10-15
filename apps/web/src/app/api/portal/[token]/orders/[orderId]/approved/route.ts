import { resolveMagicLink } from "@tranche/db";
import { getDb } from "@/server/db";
import { confirmApproval, FundingError } from "@/server/funding";

export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/portal/[token]/orders/[orderId]/approved">,
) {
  const { token, orderId } = await ctx.params;
  const portal = await resolveMagicLink(getDb(), token);
  if (!portal || !/^[A-Z0-9]{8,40}$/.test(orderId))
    return Response.json({ error: "This link is invalid or has expired" }, { status: 404 });
  try {
    return Response.json(await confirmApproval(getDb(), { dealId: portal.dealId, orderId }), {
      status: 202,
    });
  } catch (err) {
    if (err instanceof FundingError)
      return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
