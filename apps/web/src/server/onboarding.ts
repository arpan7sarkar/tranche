import "server-only";
import type { HoldMechanism } from "@tranche/contracts";
import { type Db, schema } from "@tranche/db";
import { type PayPal, requiredSellerFeatures, type SellerFeature } from "@tranche/paypal";
import { and, eq, ne } from "drizzle-orm";

export async function startOnboarding(
  db: Db,
  paypal: Pick<PayPal, "createSellerReferral">,
  input: { workspaceId: string; appUrl: string; mechanism: HoldMechanism },
): Promise<{ actionUrl: string }> {
  const { actionUrl } = await paypal.createSellerReferral({
    trackingId: input.workspaceId,
    returnUrl: `${input.appUrl}/api/paypal/onboarding/return`,
    mechanism: input.mechanism,
  });
  await db
    .update(schema.workspace)
    .set({ paypalOnboarding: "pending" })
    .where(
      and(
        eq(schema.workspace.id, input.workspaceId),
        ne(schema.workspace.paypalOnboarding, "active"),
      ),
    );
  return { actionUrl };
}

const RECHECK_AFTER_MS = 60_000;

// The page re-checks a workspace that is mid-onboarding (pending or missing permissions), at most
// once a minute, so a lost return redirect cannot leave a stale status behind.
export function needsSellerRecheck(
  ws: { paypalOnboarding: string; paypalMissingFeatures: string[]; paypalCheckedAt: Date | null },
  now = new Date(),
): boolean {
  if (ws.paypalOnboarding !== "pending" && ws.paypalMissingFeatures.length === 0) return false;
  return !ws.paypalCheckedAt || now.getTime() - ws.paypalCheckedAt.getTime() >= RECHECK_AFTER_MS;
}

export async function completeOnboarding(
  db: Db,
  paypal: Pick<PayPal, "getSellerStatus">,
  input: { workspaceId: string; mechanism: HoldMechanism },
): Promise<{
  status: "active" | "pending" | "not_started";
  missingFeatures: SellerFeature[];
}> {
  const seller = await paypal.getSellerStatus({ trackingId: input.workspaceId });
  if (!seller.merchantId) {
    const [ws] = await db
      .update(schema.workspace)
      .set({ paypalCheckedAt: new Date() })
      .where(eq(schema.workspace.id, input.workspaceId))
      .returning({ onboarding: schema.workspace.paypalOnboarding });
    return { status: ws?.onboarding ?? "not_started", missingFeatures: [] };
  }
  const missingFeatures = requiredSellerFeatures(input.mechanism).filter(
    (f) => !seller.grantedFeatures.includes(f),
  );
  const status =
    seller.paymentsReceivable && seller.primaryEmailConfirmed && missingFeatures.length === 0
      ? "active"
      : "pending";
  await db
    .update(schema.workspace)
    .set({
      paypalMerchantId: seller.merchantId,
      paypalOnboarding: status,
      paypalMissingFeatures: missingFeatures,
      paypalCheckedAt: new Date(),
    })
    .where(eq(schema.workspace.id, input.workspaceId));
  return { status, missingFeatures };
}
