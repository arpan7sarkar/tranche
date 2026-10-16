import { randomUUID } from "node:crypto";
import {
  SandboxOperationSpec,
  SandboxPaymentContext,
  type SandboxPaymentResult,
  SandboxPaymentSpec,
} from "@tranche/contracts";
import { z } from "zod";
import type { SandboxRequest } from "./sandbox-client";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,127}$/);
const money = z.object({
  currency_code: z.literal("USD"),
  value: z.string().regex(/^(0|[1-9]\d*)\.\d{2}$/),
});
const resource = z.object({
  id,
  status: z.string(),
  amount: money,
  expiration_time: z.iso.datetime().optional(),
  supplementary_data: z
    .object({ related_ids: z.object({ order_id: id.optional(), authorization_id: id.optional() }) })
    .optional(),
});
const order = z.object({
  id,
  status: z.string(),
  intent: z.literal("AUTHORIZE"),
  payer: z.object({ payer_id: id }).optional(),
  payment_source: z
    .object({ paypal: z.object({ account_id: id.optional() }).optional() })
    .optional(),
  purchase_units: z
    .array(
      z.object({
        reference_id: z.string(),
        amount: money,
        payee: z.object({ merchant_id: id }),
        payments: z
          .object({
            authorizations: z.array(resource).optional(),
            captures: z.array(resource).optional(),
          })
          .optional(),
      }),
    )
    .length(1),
  links: z
    .array(z.object({ rel: z.string(), href: z.string(), method: z.string().optional() }))
    .optional(),
});
export function paymentAmount(c: SandboxPaymentContext) {
  return { currency_code: "USD", value: (c.principalCents / 100).toFixed(2) };
}
export function paymentRequest(payment: SandboxPaymentSpec, commitmentId: string): SandboxRequest {
  const p = SandboxPaymentSpec.parse(payment);
  const c = p.context;
  const base = {
    partner: c.seller.partner,
    assertion: {
      platformClientId: c.seller.platformClientId,
      sellerMerchantId: c.seller.sellerMerchantId,
    },
    representation: true as const,
  };
  if (p.stage === "create_order") {
    if (p.orderId || p.authorizationId) throw new Error("unexpected_payment_reference");
    return {
      ...base,
      method: "POST",
      path: "/v2/checkout/orders",
      body: {
        intent: "AUTHORIZE",
        purchase_units: [
          {
            reference_id: commitmentId,
            amount: paymentAmount(c),
            payee: { merchant_id: c.seller.sellerMerchantId },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              shipping_preference: "NO_SHIPPING",
              user_action: "CONTINUE",
              ...(c.checkout
                ? { return_url: c.checkout.returnUrl, cancel_url: c.checkout.cancelUrl }
                : {}),
            },
          },
        },
      },
    };
  }
  if (!p.orderId) throw new Error("order_reference_required");
  if (p.stage === "authorize_order") {
    if (p.authorizationId) throw new Error("unexpected_payment_reference");
    return {
      ...base,
      method: "POST",
      path: `/v2/checkout/orders/${p.orderId}/authorize`,
      body: {},
    };
  }
  if (!p.authorizationId) throw new Error("authorization_reference_required");
  return {
    ...base,
    method: "POST",
    path: `/v2/payments/authorizations/${p.authorizationId}/${p.stage === "void_authorization" ? "void" : "capture"}`,
    ...(p.stage === "void_authorization"
      ? {}
      : { body: { amount: paymentAmount(c), final_capture: true } }),
  };
}
export function paymentSpec(
  input: unknown,
  commitmentId: string = randomUUID(),
  stage: SandboxPaymentSpec["stage"] = "create_order",
  references: { orderId?: string; authorizationId?: string; cleanupFeeBoundCents?: number } = {},
): SandboxOperationSpec {
  const context = SandboxPaymentContext.parse(input);
  const payment = SandboxPaymentSpec.parse({ context, stage, ...references });
  return SandboxOperationSpec.parse({
    version: 1,
    kind: stage,
    currency: "USD",
    sender: "buyer",
    recipients: [{ alias: context.seller.seller, cents: context.principalCents }],
    feeBoundCents:
      stage === "void_authorization" ? references.cleanupFeeBoundCents : context.feeBounds[stage],
    commitmentId,
    resourceKey: commitmentId,
    recoveryCalls: context.recoveryCalls,
    payment,
    request: paymentRequest(payment, commitmentId),
  });
}
export function paymentRead(
  p: SandboxPaymentSpec,
  kind: "order" | "authorization" | "capture",
  captureId?: string,
): SandboxRequest {
  const ref =
    kind === "order" ? p.orderId : kind === "authorization" ? p.authorizationId : captureId;
  if (!ref || !id.safeParse(ref).success) throw new Error("payment_reference_missing");
  return {
    method: "GET",
    path:
      kind === "order"
        ? `/v2/checkout/orders/${ref}`
        : `/v2/payments/${kind === "authorization" ? "authorizations" : "captures"}/${ref}`,
    partner: p.context.seller.partner,
    assertion: {
      platformClientId: p.context.seller.platformClientId,
      sellerMerchantId: p.context.seller.sellerMerchantId,
    },
  };
}
function amountMatches(value: z.infer<typeof money>, c: SandboxPaymentContext) {
  return value.currency_code === "USD" && value.value === paymentAmount(c).value;
}
export function verifyPaymentOrder(body: unknown, p: SandboxPaymentSpec, commitmentId: string) {
  const o = order.parse(body);
  const unit = o.purchase_units[0];
  const c = p.context;
  const buyers = [o.payer?.payer_id, o.payment_source?.paypal?.account_id].filter(
    (v): v is string => Boolean(v),
  );
  if (
    (p.orderId && o.id !== p.orderId) ||
    !unit ||
    unit.reference_id !== commitmentId ||
    !amountMatches(unit.amount, c) ||
    unit.payee.merchant_id !== c.seller.sellerMerchantId ||
    buyers.some((v) => v !== c.buyerMerchantId)
  )
    throw new Error("payment_order_mismatch");
  if (o.status !== "CREATED" && o.status !== "PAYER_ACTION_REQUIRED" && buyers.length === 0)
    throw new Error("buyer_identity_missing");
  return o;
}
export function paymentBrowserUrl(body: unknown, p: SandboxPaymentSpec, commitmentId: string) {
  const o = verifyPaymentOrder(body, p, commitmentId);
  if (!["CREATED", "PAYER_ACTION_REQUIRED", "SAVED"].includes(o.status))
    throw new Error("order_not_waiting");
  const links = (o.links ?? []).filter((l) => ["approve", "payer-action"].includes(l.rel));
  if (links.length !== 1) throw new Error("checkout_link_missing");
  const link = links[0];
  const url = new URL(link?.href ?? "");
  if (
    url.protocol !== "https:" ||
    !["sandbox.paypal.com", "www.sandbox.paypal.com"].includes(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    url.searchParams.getAll("token").length !== 1 ||
    url.searchParams.get("token") !== o.id ||
    (link?.method && link.method !== "GET")
  )
    throw new Error("checkout_destination");
  return { orderId: o.id, browserUrl: url.href };
}

export function verifyBuyerChangeOrder(body: unknown, p: SandboxPaymentSpec, commitmentId: string) {
  const o = verifyPaymentOrder(body, p, commitmentId);
  if (
    !["CREATED", "PAYER_ACTION_REQUIRED"].includes(o.status) ||
    o.payer?.payer_id ||
    o.payment_source?.paypal?.account_id ||
    o.purchase_units.some(
      (unit) =>
        (unit.payments?.authorizations?.length ?? 0) > 0 ||
        (unit.payments?.captures?.length ?? 0) > 0,
    )
  )
    throw new Error("buyer_change_order_not_unapproved");
  return o;
}
export function paymentAuthorizationReference(
  body: unknown,
  p: SandboxPaymentSpec,
  commitmentId: string,
) {
  const o = verifyPaymentOrder(body, p, commitmentId);
  const auth = o.purchase_units[0]?.payments?.authorizations;
  const a = auth?.[0];
  if (auth?.length !== 1 || !a || !amountMatches(a.amount, p.context))
    throw new Error("authorization_mismatch");
  if (p.authorizationId && p.authorizationId !== a.id) throw new Error("authorization_mismatch");
  const related = a.supplementary_data?.related_ids;
  if (related?.order_id && related.order_id !== o.id) throw new Error("authorization_lineage");
  return { orderId: o.id, authorization: a };
}
export function paymentAuthorization(
  body: unknown,
  p: SandboxPaymentSpec,
  commitmentId: string,
  authoritativeBody?: unknown,
): SandboxPaymentResult {
  const ref = paymentAuthorizationReference(body, p, commitmentId);
  const a = authoritativeBody === undefined ? ref.authorization : resource.parse(authoritativeBody);
  if (
    a.id !== ref.authorization.id ||
    !amountMatches(a.amount, p.context) ||
    (a.supplementary_data?.related_ids.order_id &&
      a.supplementary_data.related_ids.order_id !== ref.orderId)
  )
    throw new Error("authorization_lineage");
  if (a.status !== "CREATED" || !a.expiration_time || Date.parse(a.expiration_time) <= Date.now())
    throw new Error("authorization_not_ready");
  return {
    evidence: "authorized",
    orderId: ref.orderId,
    authorizationId: a.id,
    providerExpiresAt: a.expiration_time,
  };
}
export function verifyAuthorizationResource(body: unknown, p: SandboxPaymentSpec) {
  const a = resource.parse(body);
  if (
    a.id !== p.authorizationId ||
    a.status !== "CREATED" ||
    !amountMatches(a.amount, p.context) ||
    !a.expiration_time ||
    Date.parse(a.expiration_time) <= Date.now() ||
    (a.supplementary_data?.related_ids.order_id &&
      a.supplementary_data.related_ids.order_id !== p.orderId)
  )
    throw new Error("authorization_not_ready");
  return a;
}
export function paymentCapture(body: unknown, p: SandboxPaymentSpec): SandboxPaymentResult {
  const a = resource.parse(body);
  const related = a.supplementary_data?.related_ids;
  if (
    !p.orderId ||
    !p.authorizationId ||
    !amountMatches(a.amount, p.context) ||
    !related ||
    related.order_id !== p.orderId ||
    related.authorization_id !== p.authorizationId
  )
    throw new Error("capture_lineage");
  return {
    evidence:
      a.status === "COMPLETED"
        ? "captured_immediate"
        : a.status === "PENDING"
          ? "pending"
          : "inconclusive",
    orderId: p.orderId,
    authorizationId: p.authorizationId,
    captureId: a.id,
  };
}

export function paymentVoid(
  orderBody: unknown,
  authorizationBody: unknown,
  p: SandboxPaymentSpec,
  commitmentId: string,
): SandboxPaymentResult {
  const o = verifyPaymentOrder(orderBody, p, commitmentId);
  const ref = paymentAuthorizationReference(o, p, commitmentId);
  const a = resource.parse(authorizationBody);
  if (
    o.purchase_units.some((unit) => (unit.payments?.captures?.length ?? 0) > 0) ||
    a.id !== ref.authorization.id ||
    a.id !== p.authorizationId ||
    a.status !== "VOIDED" ||
    !amountMatches(a.amount, p.context) ||
    (a.supplementary_data?.related_ids.order_id &&
      a.supplementary_data.related_ids.order_id !== p.orderId)
  )
    throw new Error("void_not_verified");
  return { evidence: "voided", orderId: o.id, authorizationId: a.id };
}
