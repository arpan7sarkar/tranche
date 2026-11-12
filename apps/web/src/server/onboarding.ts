import "server-only";
import { startSellerOnboarding } from "@tranche/agents-service/money";
import type { HoldMechanism } from "@tranche/contracts";
import { type Db, schema } from "@tranche/db";
import {
  type PayPal,
  PayPalError,
  requiredSellerFeatures,
  type SellerFeature,
} from "@tranche/paypal";
import { and, eq, isNull, lte, or } from "drizzle-orm";

export async function startOnboarding(
  db: Db,
  paypal: Pick<PayPal, "createSellerReferral">,
  input: { workspaceId: string; appUrl: string; mechanism: HoldMechanism; attemptId?: string },
): Promise<{ actionUrl: string }> {
  return startSellerOnboarding(db, paypal, input);
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
  const now = new Date();
  // Claim the check before network I/O so failures and concurrent requests share the cooldown.
  const [claimed] = await db
    .update(schema.workspace)
    .set({ paypalCheckedAt: now })
    .where(
      and(
        eq(schema.workspace.id, input.workspaceId),
        or(
          isNull(schema.workspace.paypalCheckedAt),
          lte(schema.workspace.paypalCheckedAt, new Date(now.getTime() - RECHECK_AFTER_MS)),
        ),
      ),
    )
    .returning();
  if (!claimed) {
    const [ws] = await db
      .select()
      .from(schema.workspace)
      .where(eq(schema.workspace.id, input.workspaceId));
    if (!ws) throw new Error("workspace_not_found");
    return {
      status: ws.paypalOnboarding,
      missingFeatures: requiredSellerFeatures(input.mechanism).filter((f) =>
        ws.paypalMissingFeatures.includes(f),
      ),
    };
  }
  let seller: Awaited<ReturnType<PayPal["getSellerStatus"]>>;
  try {
    seller = await paypal.getSellerStatus({ trackingId: input.workspaceId });
  } catch (error) {
    if (!(error instanceof PayPalError)) throw error;
    console.warn("PayPal seller status check failed", {
      status: error.status,
      name: error.name,
      debugId: error.debugId,
    });
    await db
      .update(schema.workspace)
      .set({
        paypalCheckError:
          error.status === 401 || error.status === 403 ? "authorization" : "unavailable",
      })
      .where(eq(schema.workspace.id, input.workspaceId));
    return {
      status: claimed.paypalOnboarding,
      missingFeatures: requiredSellerFeatures(input.mechanism).filter((f) =>
        claimed.paypalMissingFeatures.includes(f),
      ),
    };
  }
  if (!seller.merchantId) {
    const [ws] = await db
      .update(schema.workspace)
      .set({ paypalCheckError: null })
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
      paypalCheckError: null,
    })
    .where(eq(schema.workspace.id, input.workspaceId));
  return { status, missingFeatures };
}
