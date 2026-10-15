import { getDb } from "@/server/db";
import { startOnboarding } from "@/server/onboarding";
import { appUrl, getPayPal } from "@/server/paypal";
import { memberOrNull } from "@/server/session";

export async function POST(request: Request) {
  const member = await memberOrNull(request);
  if (!member) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(
    await startOnboarding(getDb(), getPayPal(), {
      workspaceId: member.workspaceId,
      appUrl: appUrl(),
    }),
  );
}
