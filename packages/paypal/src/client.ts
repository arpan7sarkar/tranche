import { type HoldMechanism, type Money, toPayPalValue } from "@tranche/contracts";
import { PayPalError } from "./errors";
import { createTransport, type PayPalConfig } from "./http";

type Link = { href: string; rel: string };
type Amount = { currency_code: string; value: string };

export type CaptureRes = { id: string; status: string; amount?: Amount; create_time: string };
export type AuthorizationRes = {
  id: string;
  status: string;
  amount?: Amount;
  create_time: string;
  expiration_time: string;
};
export type OrderRes = {
  id: string;
  status: string;
  links?: Link[];
  payment_source?: { paypal?: { attributes?: { vault?: { id?: string; status?: string } } } };
  purchase_units?: Array<{
    reference_id?: string;
    payments?: { captures?: CaptureRes[]; authorizations?: AuthorizationRes[] };
  }>;
};

export type Hold = {
  captureId: string | null;
  authorizationId: string | null;
  expiresAt: string;
  honorExpiresAt: string | null;
  vaultId: string | null;
};

const seg = encodeURIComponent;

const REFERRAL_FEATURES = [
  "PAYMENT",
  "REFUND",
  "PARTNER_FEE",
  "DELAY_FUNDS_DISBURSEMENT",
  "VAULT",
  "ACCESS_MERCHANT_INFORMATION",
];

const DAY_MS = 86_400_000;
const DELAYED_SAFE_DAYS = 27;
const HONOR_DAYS = 3;

const amountOf = (m: Money): Amount => ({ currency_code: m.currency, value: toPayPalValue(m) });
const addDays = (iso: string, days: number) =>
  new Date(Date.parse(iso) + days * DAY_MS).toISOString();
const fees = (fee: Money | undefined) =>
  fee ? { platform_fees: [{ amount: amountOf(fee) }] } : {};

function declined(kind: "capture" | "authorization", status: string): PayPalError {
  return new PayPalError({
    status: 422,
    name: "HOLD_DECLINED",
    message: `PayPal ${kind} is ${status}`,
    issue: `${kind.toUpperCase()}_${status}`,
    debugId: null,
    retryable: false,
  });
}

function required(value: string | null, name: string): string {
  if (!value) throw new Error(`${name} is required for this hold mechanism`);
  return value;
}

export function approveUrlOf(order: OrderRes): string | null {
  return order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href ?? null;
}

export function holdFromOrder(order: OrderRes, mechanism: HoldMechanism): Hold | null {
  const payments = order.purchase_units?.[0]?.payments;
  const vaultId = order.payment_source?.paypal?.attributes?.vault?.id ?? null;
  if (mechanism === "delayed_disbursement") {
    const c = payments?.captures?.[0];
    if (!c) return null;
    if (c.status !== "COMPLETED" && c.status !== "PENDING") throw declined("capture", c.status);
    return {
      captureId: c.id,
      authorizationId: null,
      expiresAt: addDays(c.create_time, DELAYED_SAFE_DAYS),
      honorExpiresAt: null,
      vaultId,
    };
  }
  const a = payments?.authorizations?.[0];
  if (!a) return null;
  if (a.status !== "CREATED" && a.status !== "PENDING") throw declined("authorization", a.status);
  return {
    captureId: null,
    authorizationId: a.id,
    expiresAt: addDays(a.expiration_time, -1),
    honorExpiresAt: addDays(a.create_time, HONOR_DAYS),
    vaultId,
  };
}

export function createPayPalClient(config: PayPalConfig) {
  const t = createTransport(config);

  return {
    transport: t,

    async createSellerReferral(input: {
      trackingId: string;
      returnUrl: string;
    }): Promise<{ actionUrl: string }> {
      const res = await t.request<{ links: Link[] }>({
        method: "POST",
        path: "/v2/customer/partner-referrals",
        body: {
          tracking_id: input.trackingId,
          partner_config_override: { return_url: input.returnUrl },
          operations: [
            {
              operation: "API_INTEGRATION",
              api_integration_preference: {
                rest_api_integration: {
                  integration_method: "PAYPAL",
                  integration_type: "THIRD_PARTY",
                  third_party_details: { features: REFERRAL_FEATURES },
                },
              },
            },
          ],
          products: ["EXPRESS_CHECKOUT"],
          legal_consents: [{ type: "SHARE_DATA_CONSENT", granted: true }],
        },
      });
      const actionUrl = res.links.find((l) => l.rel === "action_url")?.href;
      if (!actionUrl) {
        throw new PayPalError({
          status: 502,
          name: "MISSING_ACTION_URL",
          message: "Partner referral response had no action_url link",
          issue: null,
          debugId: null,
          retryable: false,
        });
      }
      return { actionUrl };
    },

    async getSellerStatus(input: { trackingId: string }): Promise<{
      merchantId: string | null;
      paymentsReceivable: boolean;
      primaryEmailConfirmed: boolean;
    }> {
      const partnerId = config.partnerMerchantId;
      if (!partnerId)
        throw new Error("PAYPAL_PARTNER_MERCHANT_ID is required to read seller status");
      const unknown = { merchantId: null, paymentsReceivable: false, primaryEmailConfirmed: false };
      let found: { merchant_id?: string };
      try {
        found = await t.request({
          method: "GET",
          path: `/v1/customer/partners/${seg(partnerId)}/merchant-integrations`,
          query: { tracking_id: input.trackingId },
        });
      } catch (err) {
        if (err instanceof PayPalError && err.status === 404) return unknown;
        throw err;
      }
      if (!found.merchant_id) return unknown;
      const status = await t.request<{
        payments_receivable?: boolean;
        primary_email_confirmed?: boolean;
      }>({
        method: "GET",
        path: `/v1/customer/partners/${seg(partnerId)}/merchant-integrations/${seg(found.merchant_id)}`,
      });
      return {
        merchantId: found.merchant_id,
        paymentsReceivable: status.payments_receivable === true,
        primaryEmailConfirmed: status.primary_email_confirmed === true,
      };
    },

    getOrder(orderId: string): Promise<OrderRes> {
      return t.request<OrderRes>({ method: "GET", path: `/v2/checkout/orders/${seg(orderId)}` });
    },

    getCapture(captureId: string): Promise<CaptureRes> {
      return t.request<CaptureRes>({
        method: "GET",
        path: `/v2/payments/captures/${seg(captureId)}`,
      });
    },

    getAuthorization(authorizationId: string): Promise<AuthorizationRes> {
      return t.request<AuthorizationRes>({
        method: "GET",
        path: `/v2/payments/authorizations/${seg(authorizationId)}`,
      });
    },

    async createFundingOrder(input: {
      requestId: string;
      mechanism: HoldMechanism;
      amount: Money;
      platformFee: Money;
      payeeMerchantId: string;
      milestoneId: string;
      vaultId: string | null;
      returnUrl: string;
      cancelUrl: string;
    }): Promise<{ orderId: string; approveUrl: string | null; status: string }> {
      const paypalSource = input.vaultId
        ? { vault_id: input.vaultId }
        : {
            attributes: {
              vault: {
                store_in_vault: "ON_SUCCESS",
                usage_type: "MERCHANT",
                customer_type: "CONSUMER",
              },
            },
            experience_context: {
              return_url: input.returnUrl,
              cancel_url: input.cancelUrl,
              user_action: "PAY_NOW",
              shipping_preference: "NO_SHIPPING",
              brand_name: "Tranche",
            },
          };
      const order = await t.request<OrderRes>({
        method: "POST",
        path: "/v2/checkout/orders",
        requestId: input.requestId,
        prefer: "return=representation",
        body: {
          intent: input.mechanism === "authorization" ? "AUTHORIZE" : "CAPTURE",
          purchase_units: [
            {
              reference_id: input.milestoneId,
              custom_id: input.milestoneId,
              amount: amountOf(input.amount),
              payee: { merchant_id: input.payeeMerchantId },
              payment_instruction: {
                ...fees(input.platformFee),
                ...(input.mechanism === "delayed_disbursement"
                  ? { disbursement_mode: "DELAYED" }
                  : {}),
              },
            },
          ],
          payment_source: { paypal: paypalSource },
        },
      });
      return { orderId: order.id, approveUrl: approveUrlOf(order), status: order.status };
    },

    async placeHold(input: {
      requestId: string;
      orderId: string;
      mechanism: HoldMechanism;
    }): Promise<Hold> {
      const existing = await t.request<OrderRes>({
        method: "GET",
        path: `/v2/checkout/orders/${seg(input.orderId)}`,
      });
      const already = holdFromOrder(existing, input.mechanism);
      if (already) return already;
      if (existing.status !== "APPROVED") {
        throw new PayPalError({
          status: 409,
          name: "ORDER_NOT_APPROVED",
          message: `Order ${input.orderId} is ${existing.status}`,
          issue: "ORDER_NOT_APPROVED",
          debugId: null,
          retryable: false,
        });
      }
      const action = input.mechanism === "authorization" ? "authorize" : "capture";
      const order = await t.request<OrderRes>({
        method: "POST",
        path: `/v2/checkout/orders/${seg(input.orderId)}/${action}`,
        body: {},
        requestId: input.requestId,
        prefer: "return=representation",
      });
      const hold = holdFromOrder(order, input.mechanism);
      if (!hold) {
        throw new PayPalError({
          status: 502,
          name: "HOLD_MISSING",
          message: `PayPal returned no ${action} for order ${input.orderId}`,
          issue: null,
          debugId: null,
          retryable: true,
        });
      }
      return hold;
    },

    async renewHold(input: {
      requestId: string;
      authorizationId: string;
      amount: Money;
      payeeMerchantId?: string | undefined;
    }): Promise<{ authorizationId: string; expiresAt: string; honorExpiresAt: string }> {
      const a = await t.request<AuthorizationRes>({
        method: "POST",
        path: `/v2/payments/authorizations/${seg(input.authorizationId)}/reauthorize`,
        body: { amount: amountOf(input.amount) },
        requestId: input.requestId,
        prefer: "return=representation",
        authAssertionFor: input.payeeMerchantId,
      });
      return {
        authorizationId: a.id,
        expiresAt: addDays(a.expiration_time, -1),
        honorExpiresAt: addDays(a.create_time, HONOR_DAYS),
      };
    },

    async releaseHold(input: {
      requestId: string;
      mechanism: HoldMechanism;
      captureId: string | null;
      authorizationId: string | null;
      amount: Money;
      platformFee?: Money | undefined;
      payeeMerchantId?: string | undefined;
    }): Promise<{ releaseRef: string }> {
      if (input.mechanism === "delayed_disbursement") {
        const res = await t.request<{ item_id: string }>({
          method: "POST",
          path: "/v1/payments/referenced-payouts-items",
          requestId: input.requestId,
          body: {
            reference_id: required(input.captureId, "captureId"),
            reference_type: "TRANSACTION_ID",
          },
        });
        return { releaseRef: res.item_id };
      }
      const capture = await t.request<CaptureRes>({
        method: "POST",
        path: `/v2/payments/authorizations/${seg(required(input.authorizationId, "authorizationId"))}/capture`,
        requestId: input.requestId,
        prefer: "return=representation",
        authAssertionFor: input.payeeMerchantId,
        body: {
          amount: amountOf(input.amount),
          final_capture: true,
          payment_instruction: { disbursement_mode: "INSTANT", ...fees(input.platformFee) },
        },
      });
      return { releaseRef: capture.id };
    },

    async voidHold(input: {
      requestId: string;
      mechanism: HoldMechanism;
      authorizationId: string | null;
      captureId: string | null;
      platformFee?: Money | undefined;
      payeeMerchantId?: string | undefined;
    }): Promise<void> {
      if (input.mechanism === "authorization") {
        await t.request<void>({
          method: "POST",
          path: `/v2/payments/authorizations/${seg(required(input.authorizationId, "authorizationId"))}/void`,
          requestId: input.requestId,
          prefer: "return=minimal",
          authAssertionFor: input.payeeMerchantId,
        });
        return;
      }
      await t.request<unknown>({
        method: "POST",
        path: `/v2/payments/captures/${seg(required(input.captureId, "captureId"))}/refund`,
        requestId: input.requestId,
        prefer: "return=minimal",
        authAssertionFor: input.payeeMerchantId,
        body: input.platformFee ? { payment_instruction: fees(input.platformFee) } : {},
      });
    },

    async sendPayouts(input: {
      requestId: string;
      items: Array<{ email: string; amount: Money; note: string }>;
    }): Promise<{ batchId: string }> {
      const res = await t.request<{ batch_header: { payout_batch_id: string } }>({
        method: "POST",
        path: "/v1/payments/payouts",
        requestId: input.requestId,
        body: {
          sender_batch_header: {
            sender_batch_id: input.requestId,
            email_subject: "You have a payment from Tranche",
          },
          items: input.items.map((item, i) => ({
            recipient_type: "EMAIL",
            receiver: item.email,
            note: item.note,
            sender_item_id: `${input.requestId}-${i}`,
            amount: { value: toPayPalValue(item.amount), currency: item.amount.currency },
          })),
        },
      });
      return { batchId: res.batch_header.payout_batch_id };
    },

    async verifyWebhook(input: {
      headers: Record<string, string>;
      rawBody: string;
      webhookId: string;
    }): Promise<boolean> {
      const meta = {
        auth_algo: input.headers["paypal-auth-algo"],
        cert_url: input.headers["paypal-cert-url"],
        transmission_id: input.headers["paypal-transmission-id"],
        transmission_sig: input.headers["paypal-transmission-sig"],
        transmission_time: input.headers["paypal-transmission-time"],
        webhook_id: input.webhookId,
      };
      if (Object.values(meta).some((v) => !v)) return false;
      try {
        JSON.parse(input.rawBody);
      } catch {
        return false;
      }
      // PayPal verifies the exact delivered bytes, so the body is spliced in, never re-serialized.
      const res = await t.request<{ verification_status: string }>({
        method: "POST",
        path: "/v1/notifications/verify-webhook-signature",
        rawJson: `${JSON.stringify(meta).slice(0, -1)},"webhook_event":${input.rawBody}}`,
      });
      return res.verification_status === "SUCCESS";
    },

    async submitDisputeEvidence(input: {
      requestId: string;
      disputeId: string;
      notes: string;
      documents?:
        | Array<{ name: string; contentType: string; data: Uint8Array<ArrayBuffer> }>
        | undefined;
      payeeMerchantId?: string | undefined;
    }): Promise<void> {
      const form = new FormData();
      form.append(
        "input",
        new Blob(
          [
            JSON.stringify({
              evidences: [{ evidence_type: "PROOF_OF_FULFILLMENT", notes: input.notes }],
            }),
          ],
          { type: "application/json" },
        ),
      );
      for (const d of input.documents ?? [])
        form.append("evidence-file", new Blob([d.data], { type: d.contentType }), d.name);
      await t.request<unknown>({
        method: "POST",
        path: `/v1/customer/disputes/${seg(input.disputeId)}/provide-evidence`,
        requestId: input.requestId,
        authAssertionFor: input.payeeMerchantId,
        form,
      });
    },
  };
}

export type PayPal = ReturnType<typeof createPayPalClient>;
