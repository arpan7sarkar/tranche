import { getDb } from "@/server/db";
import { startOnboarding } from "@/server/onboarding";
import { appUrl, getPayPal, holdMechanism } from "@/server/paypal";
import { memberOrNull } from "@/server/session";

export async function POST(request: Request) {
  const member = await memberOrNull(request);
  if (!member) return Response.json({ error: "unauthorized" }, { status: 401 });
  let body: unknown;
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const parsed = SellerReferralStart.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    return Response.json(
      await startOnboarding(getDb(), getPayPal(), {
        workspaceId: member.workspaceId,
        appUrl: appUrl(),
        mechanism: holdMechanism(),
        attemptId: parsed.data.attemptId,
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.message === "seller_already_connected")
      return Response.json({ error: "PayPal is already connected." }, { status: 409 });
    if (error instanceof Error && error.message === "creation_pending_recovery")
      return Response.json(
        { error: "PayPal connection is awaiting verification. Please try again shortly." },
        { status: 409 },
      );
    throw error;
  }
}

import { SellerReferralStart } from "@tranche/contracts";
