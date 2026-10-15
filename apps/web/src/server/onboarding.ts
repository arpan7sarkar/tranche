import "server-only";
import { type Db, schema } from "@tranche/db";
import type { PayPal } from "@tranche/paypal";
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
  input: { workspaceId: string },
): Promise<"active" | "pending" | "not_started"> {
  const status = await paypal.getSellerStatus({ trackingId: input.workspaceId });
  if (!status.merchantId) {
    const [ws] = await db
      .select({ onboarding: schema.workspace.paypalOnboarding })
      .from(schema.workspace)
      .where(eq(schema.workspace.id, input.workspaceId));
    return ws?.onboarding ?? "not_started";
  }
  const next = status.paymentsReceivable && status.primaryEmailConfirmed ? "active" : "pending";
  await db
    .update(schema.workspace)
    .set({ paypalMerchantId: status.merchantId, paypalOnboarding: next })
    .where(eq(schema.workspace.id, input.workspaceId));
  return next;
}
