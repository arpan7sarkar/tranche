import { SandboxOperationSpec, type SandboxOutcome, SandboxPaymentSpec } from "@tranche/contracts";
import { type SandboxStore, sandboxPayloadHash } from "@tranche/db";
import {
  onboardingStatusRequest,
  paymentAuthorization,
  paymentAuthorizationReference,
  paymentBrowserUrl,
  paymentCapture,
  paymentRead,
  paymentRequest,
  paymentVoid,
  verifyAuthorizationResource,
  verifyOnboarding,
  verifyPaymentOrder,
} from "@tranche/paypal";
import type { PrivateSandboxArtifacts } from "./private-artifacts";
import type { SandboxAdapter } from "./runner";

export function paymentAdapters(
  store: SandboxStore,
  artifacts: PrivateSandboxArtifacts,
  platformClientId: string,
): SandboxAdapter[] {
  function context(spec: SandboxOperationSpec) {
    if (
      !spec.payment ||
      spec.payment.context.seller.platformClientId !== platformClientId ||
      sandboxPayloadHash(spec.request) !==
        sandboxPayloadHash(paymentRequest(spec.payment, spec.commitmentId))
    )
      throw new Error("payment_configuration");
    SandboxOperationSpec.parse(spec);
    return spec.payment;
  }
  return (["create_order", "authorize_order", "capture_order", "void_authorization"] as const).map(
    (kind) => ({
      kind,
      validate: (spec) => {
        const p = context(spec);
        if (p.stage !== kind) throw new Error("payment_stage");
      },
      prepare: (op) => {
        const p = context(op.spec);
        if (kind === "create_order" && !p.context.checkout)
          throw new Error("checkout_destinations_required");
        if (
          Date.parse(
            kind === "void_authorization" ? p.context.recoverUntil : p.context.executeUntil,
          ) <= Date.now()
        )
          throw new Error("payment_deadline");
        return op.spec.request;
      },
      beforeWrite: async (op, read, claim) => {
        const p = context(op.spec);
        const resource = await store.paymentResource(op.commitmentId);
        if (kind !== "void_authorization") await store.requirePaymentConsent(op.spec);
        if (sandboxPayloadHash(resource.context) !== sandboxPayloadHash(p.context))
          throw new Error("payment_configuration");
        if (
          kind !== "void_authorization" &&
          verifyOnboarding(await read(onboardingStatusRequest(p.context.seller)), p.context.seller)
            .status !== "consent_verified"
        )
          throw new Error("seller_not_ready");
        if (kind !== "create_order") {
          const o = verifyPaymentOrder(await read(paymentRead(p, "order")), p, op.commitmentId);
          if (kind === "authorize_order" && o.status !== "APPROVED")
            throw new Error("order_not_approved");
          if (kind === "capture_order" || kind === "void_authorization") {
            if (
              kind === "void_authorization" &&
              o.purchase_units.some((unit) => (unit.payments?.captures?.length ?? 0) > 0)
            )
              throw new Error("authorization_already_captured");
            const authorization = await read(paymentRead(p, "authorization"));
            const authorized = paymentAuthorization(o, p, op.commitmentId, authorization);
            if (authorized.authorizationId !== p.authorizationId)
              throw new Error("authorization_lineage");
            verifyAuthorizationResource(authorization, p);
          }
        }
        await store.recordPaymentReadiness(claim);
      },
      interpret: async (body, op) => {
        const p = context(op.spec);
        if (kind === "void_authorization") return { state: "inconclusive" };
        if (kind === "create_order") {
          // Preserve a known resource even if validation or private artifact storage fails.
          const ref =
            body &&
            typeof body === "object" &&
            "id" in body &&
            typeof body.id === "string" &&
            /^[A-Za-z0-9_-]{1,127}$/.test(body.id)
              ? body.id
              : undefined;
          try {
            const result = paymentBrowserUrl(body, p, op.commitmentId);
            const artifactKey = await artifacts.saveBrowserUrl(result.browserUrl);
            return {
              state: "waiting_for_browser",
              expectedAlias: "buyer",
              artifactKey,
              payment: { evidence: "order_created", orderId: result.orderId, artifactKey },
            };
          } catch {
            return {
              state: "inconclusive",
              payment: { evidence: "inconclusive", ...(ref ? { orderId: ref } : {}) },
            };
          }
        }
        if (kind === "authorize_order") {
          const payment = paymentAuthorization(body, p, op.commitmentId);
          return { state: "succeeded", payment };
        }
        const ref =
          body &&
          typeof body === "object" &&
          "id" in body &&
          typeof body.id === "string" &&
          /^[A-Za-z0-9_-]{1,127}$/.test(body.id)
            ? body.id
            : undefined;
        try {
          const payment = paymentCapture(body, p);
          // A counted read confirms capture; acceptance alone never completes the operation.
          return {
            state: "inconclusive",
            payment: {
              ...payment,
              evidence: payment.evidence === "captured_immediate" ? "pending" : payment.evidence,
            },
          };
        } catch {
          return {
            state: "inconclusive",
            payment: { evidence: "inconclusive", ...(ref ? { captureId: ref } : {}) },
          };
        }
      },
      recover: async (op, read) => {
        const initial = context(op.spec);
        const r = await store.paymentResource(op.commitmentId);
        if (Date.parse(r.context.recoverUntil) <= Date.now() || !r.result.orderId)
          return { state: "inconclusive" };
        const p = SandboxPaymentSpec.parse({
          ...initial,
          orderId: r.result.orderId,
          ...(r.result.authorizationId ? { authorizationId: r.result.authorizationId } : {}),
        });
        const o = verifyPaymentOrder(await read(paymentRead(p, "order")), p, op.commitmentId);
        if (kind === "void_authorization") {
          const payment = paymentVoid(
            o,
            await read(paymentRead(p, "authorization")),
            p,
            op.commitmentId,
          );
          return { state: "succeeded", payment };
        }
        if (kind === "create_order") {
          if (o.status === "APPROVED")
            return { state: "succeeded", payment: { evidence: "buyer_approved", orderId: o.id } };
          if (r.result.artifactKey && ["CREATED", "PAYER_ACTION_REQUIRED"].includes(o.status))
            return {
              state: "waiting_for_browser",
              expectedAlias: "buyer",
              artifactKey: r.result.artifactKey,
              payment: {
                evidence: "order_created",
                orderId: o.id,
                artifactKey: r.result.artifactKey,
              },
            };
          try {
            const link = paymentBrowserUrl(o, p, op.commitmentId);
            const artifactKey = await artifacts.saveBrowserUrl(link.browserUrl);
            return {
              state: "waiting_for_browser",
              expectedAlias: "buyer",
              artifactKey,
              payment: { evidence: "order_created", orderId: o.id, artifactKey },
            };
          } catch {
            return { state: "inconclusive", payment: { evidence: "inconclusive", orderId: o.id } };
          }
        }
        if (kind === "authorize_order") {
          const ref = paymentAuthorizationReference(o, p, op.commitmentId);
          const body = await read(
            paymentRead({ ...p, authorizationId: ref.authorization.id }, "authorization"),
          );
          return { state: "succeeded", payment: paymentAuthorization(o, p, op.commitmentId, body) };
        }
        const captures = o.purchase_units[0]?.payments?.captures ?? [];
        const captureId =
          r.result.captureId ?? (captures.length === 1 ? captures[0]?.id : undefined);
        if (!captureId) return { state: "inconclusive" };
        const payment = paymentCapture(await read(paymentRead(p, "capture", captureId)), p);
        if (payment.captureId !== captureId) throw new Error("capture_changed");
        return {
          state: payment.evidence === "captured_immediate" ? "succeeded" : "inconclusive",
          payment,
        } satisfies SandboxOutcome;
      },
    }),
  );
}
