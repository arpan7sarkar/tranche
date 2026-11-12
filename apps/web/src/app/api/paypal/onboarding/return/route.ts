import { getDb } from "@/server/db";
import { completeOnboarding } from "@/server/onboarding";
import { appUrl, getPayPal, holdMechanism } from "@/server/paypal";
import { memberOrNull } from "@/server/session";

// PayPal's query parameters are forgeable, so the status always comes from getSellerStatus.
// The onboarding page's "Check again" button lands here too.
export async function GET(request: Request) {
  const member = await memberOrNull(request);
  if (!member) {
    const { pathname, search } = new URL(request.url);
    const next = encodeURIComponent(`${pathname}${search}`);
    return Response.redirect(`${appUrl()}/sign-in?next=${next}`, 303);
  }
  try {
    await completeOnboarding(getDb(), getPayPal(), {
      workspaceId: member.workspaceId,
      mechanism: holdMechanism(),
    });
  } catch {
    console.error("PayPal connection check could not complete");
    return Response.redirect(`${appUrl()}/onboarding?paypalCheck=failed`, 303);
  }
  return Response.redirect(`${appUrl()}/onboarding`, 303);
}
