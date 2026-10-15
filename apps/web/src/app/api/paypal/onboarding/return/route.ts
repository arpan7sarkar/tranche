import { getDb } from "@/server/db";
import { completeOnboarding } from "@/server/onboarding";
import { appUrl, getPayPal } from "@/server/paypal";
import { memberOrNull } from "@/server/session";

// PayPal's query parameters are forgeable, so the status always comes from getSellerStatus.
export async function GET(request: Request) {
  const member = await memberOrNull(request);
  if (!member) return Response.redirect(`${appUrl()}/sign-in?next=/onboarding`, 303);
  await completeOnboarding(getDb(), getPayPal(), { workspaceId: member.workspaceId });
  return Response.redirect(`${appUrl()}/onboarding`, 303);
}
