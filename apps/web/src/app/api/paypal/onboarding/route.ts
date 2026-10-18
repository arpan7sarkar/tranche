import { getDb } from "@/server/db";
import { startOnboarding } from "@/server/onboarding";
import { appUrl, getPayPal, holdMechanism } from "@/server/paypal";
import { memberOrNull } from "@/server/session";

export async function POST(request: Request) {
  const member = await memberOrNull(request);
  if (!member) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    return Response.json(
      await startOnboarding(getDb(), getPayPal(), {
        workspaceId: member.workspaceId,
        appUrl: appUrl(),
        mechanism: holdMechanism(),
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.message === "creation_pending_recovery")
      return Response.json(
        { error: "PayPal connection is awaiting verification. Please try again shortly." },
        { status: 409 },
      );
    throw error;
  }
}
