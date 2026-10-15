import "server-only";
import type { HoldMechanism } from "@tranche/contracts";
import { type Db, schema } from "@tranche/db";
import { type PayPal, requiredSellerFeatures, type SellerFeature } from "@tranche/paypal";
import { and, eq, ne } from "drizzle-orm";

export async function startOnboarding(
  db: Db,
  paypal: Pick<PayPal, "createSellerReferral">,
  input: { workspaceId: string; appUrl: string },
): Promise<{ actionUrl: string }> {
  const { actionUrl } = await paypal.createSellerReferral({
    trackingId: input.workspaceId,
    returnUrl: `${input.appUrl}/api/paypal/onboarding/return`,
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
      .select({ onboarding: schema.workspace.paypalOnboarding })
      .from(schema.workspace)
      .where(eq(schema.workspace.id, input.workspaceId));
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
    .set({ paypalMerchantId: seller.merchantId, paypalOnboarding: status })
    .where(eq(schema.workspace.id, input.workspaceId));
  return { status, missingFeatures };
}
