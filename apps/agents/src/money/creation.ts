import { createHash } from "node:crypto";
import {
  FundingOrderIntent,
  FundingOrderResponse,
  type HoldMechanism,
  SellerReferralIntent,
  SellerReferralResponse,
  toPayPalValue,
  WebhookRegistrationIntent,
} from "@tranche/contracts";
import { type Db, schema } from "@tranche/db";
import {
  approveUrlOf,
  PAYPAL_WEBHOOK_EVENTS,
  type PayPal,
  requiredSellerFeatures,
} from "@tranche/paypal";
import { and, eq, inArray, lte } from "drizzle-orm";
import type { Deps } from "./deps";
import { enqueueOutbox, type OutboxKind, type OutboxRow } from "./outbox";
import { executeOutbox } from "./outbox-executor";

async function result(deps: Deps, row: OutboxRow) {
  await executeOutbox(deps, 1, row.id);
  const [current] = await deps.db.select().from(schema.outbox).where(eq(schema.outbox.id, row.id));
  if (current?.status !== "succeeded") throw new Error("creation_pending_recovery");
  return current.response;
}

export async function recordCreation(
  deps: Deps,
  kind: OutboxKind,
  requestId: string,
  request: Record<string, unknown>,
) {
  await deps.db.transaction((tx) => enqueueOutbox(tx, { kind, requestId, request }, deps.now()));
  const [row] = await deps.db
    .select()
    .from(schema.outbox)
    .where(eq(schema.outbox.requestId, requestId));
  if (!row || row.kind !== kind) throw new Error("creation_identity_conflict");
  return result(deps, row);
}

export async function startSellerOnboarding(
  db: Db,
  paypal: Pick<PayPal, "createSellerReferral">,
  input: { workspaceId: string; appUrl: string; mechanism: HoldMechanism },
) {
  const request = SellerReferralIntent.parse({
    trackingId: input.workspaceId,
    returnUrl: `${input.appUrl}/api/paypal/onboarding/return`,
    mechanism: input.mechanism,
  });
  const requestId = `referral-${input.mechanism}-${input.workspaceId}`;
  await db.transaction(async (tx) => {
    const [workspace] = await tx
      .select()
      .from(schema.workspace)
      .where(eq(schema.workspace.id, input.workspaceId))
      .for("update");
    if (!workspace) throw new Error("workspace_not_found");
    await enqueueOutbox(tx, { kind: "create_seller_referral", request, requestId }, new Date());
  });
  const [row] = await db.select().from(schema.outbox).where(eq(schema.outbox.requestId, requestId));
  if (!row) throw new Error("referral_intent_missing");
  return SellerReferralResponse.parse(
    await result({ db, paypal: paypal as PayPal, now: () => new Date() }, row),
  );
}

export async function registerPayPalWebhook(deps: Deps, base: string) {
  const url = new URL(base);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("webhook_origin_required");
  const request = WebhookRegistrationIntent.parse({
    url: `${url.origin}/api/webhooks/paypal`,
    events: [...PAYPAL_WEBHOOK_EVENTS],
  });
  const key = createHash("sha256").update(JSON.stringify(request)).digest("hex");
  return recordCreation(deps, "register_webhook", `webhook:${key}`, request);
}

// Recovery only stores an authoritative read; the normal executor performs settlement.
export async function recoverCreation(deps: Deps, id: string, resourceId: string) {
  if (!/^[A-Za-z0-9_-]{1,127}$/.test(resourceId)) throw new Error("invalid_resource_id");
  const [row] = await deps.db.select().from(schema.outbox).where(eq(schema.outbox.id, id));
  if (
    !row ||
    !["create_funding_order", "create_replacement_order", "create_seller_referral"].includes(
      row.kind,
    )
  )
    throw new Error("creation_not_recoverable");
  if (row.status === "succeeded") {
    if (row.response?.orderId === resourceId) return row.response;
    throw new Error("creation_already_settled");
  }
  if (
    !["pending", "sent"].includes(row.status) ||
    !row.request._dispatched ||
    row.nextAttemptAt > deps.now()
  )
    throw new Error("creation_claim_active_or_not_dispatched");
  let response: Record<string, unknown>;
  if (row.kind === "create_seller_referral") {
    const request = SellerReferralIntent.parse(row.request);
    const body = await deps.paypal.transport.request<{
      tracking_id?: string;
      partner_config_override?: { return_url?: string };
      operations?: Array<{
        api_integration_preference?: {
          rest_api_integration?: { third_party_details?: { features?: string[] } };
        };
      }>;
      links?: Array<{ rel: string; href: string }>;
    }>({ method: "GET", path: `/v2/customer/partner-referrals/${resourceId}` });
    const features =
      body.operations?.flatMap(
        (op) =>
          op.api_integration_preference?.rest_api_integration?.third_party_details?.features ?? [],
      ) ?? [];
    if (
      body.tracking_id !== request.trackingId ||
      body.partner_config_override?.return_url !== request.returnUrl ||
      !requiredSellerFeatures(request.mechanism).every((feature) => features.includes(feature))
    )
      throw new Error("referral_identity_mismatch");
    const actionUrl = body.links?.find((link) => link.rel === "action_url")?.href;
    if (
      !actionUrl ||
      new URL(actionUrl).protocol !== "https:" ||
      !["www.sandbox.paypal.com", "sandbox.paypal.com"].includes(new URL(actionUrl).hostname)
    )
      throw new Error("referral_link_invalid");
    response = SellerReferralResponse.parse({ actionUrl });
  } else {
    const request = FundingOrderIntent.parse(row.request);
    const order = await deps.paypal.getOrder(resourceId);
    const unit = order.purchase_units?.[0];
    if (
      order.id !== resourceId ||
      order.intent !== (request.mechanism === "authorization" ? "AUTHORIZE" : "CAPTURE") ||
      order.purchase_units?.length !== 1 ||
      unit?.reference_id !== request.milestoneId ||
      unit?.custom_id !== row.requestId ||
      unit?.payee?.merchant_id !== request.payeeMerchantId ||
      unit.amount?.currency_code !== request.amount.currency ||
      unit.amount.value !== toPayPalValue(request.amount)
    )
      throw new Error("funding_order_identity_mismatch");
    if (
      !["CREATED", "SAVED", "PAYER_ACTION_REQUIRED", "APPROVED", "COMPLETED"].includes(order.status)
    )
      throw new Error("funding_order_not_recoverable");
    const approveUrl = approveUrlOf(order);
    if (["CREATED", "SAVED", "PAYER_ACTION_REQUIRED"].includes(order.status) && !approveUrl)
      throw new Error("funding_approval_link_missing");
    response = FundingOrderResponse.parse({ orderId: order.id, approveUrl, status: order.status });
  }
  const kept = await deps.db
    .update(schema.outbox)
    .set({ status: "called", response, nextAttemptAt: deps.now() })
    .where(
      and(
        eq(schema.outbox.id, row.id),
        eq(schema.outbox.attempts, row.attempts),
        inArray(schema.outbox.status, ["pending", "sent"]),
        lte(schema.outbox.nextAttemptAt, deps.now()),
      ),
    )
    .returning({ id: schema.outbox.id });
  if (!kept.length) throw new Error("creation_recovery_stale");
  return result(deps, { ...row, status: "called", response });
}
