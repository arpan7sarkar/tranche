import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

type Amount = { currency_code: string; value: string };
type Order = {
  links?: { rel: string; href: string; method: string }[];
  id: string;
  intent: "CAPTURE" | "AUTHORIZE";
  status: "CREATED" | "APPROVED" | "COMPLETED";
  purchase_units: {
    reference_id?: string;
    amount: Amount;
    payee?: unknown;
    payment_instruction?: unknown;
  }[];
};

const day = 86_400_000;

export async function startFakePayPal(opts: { port: number; webhookUrl: string }) {
  const orders = new Map<string, Order>();
  const auths = new Map<string, { orderId: string; amount: Amount; createdAt: number }>();
  const captures = new Map<string, Record<string, unknown>>();
  const requests = new Map<string, { fingerprint: string; status: number; body: unknown }>();
  const identities = new WeakMap<ServerResponse, { key: string; fingerprint: string }>();
  const fakeBase = () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("fake_paypal_not_listening");
    return `http://127.0.0.1:${address.port}`;
  };

  const emit = (event_type: string, resource: Record<string, unknown>) =>
    fetch(opts.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "paypal-transmission-id": randomUUID(),
        "paypal-transmission-sig": "fake-signature",
        "paypal-transmission-time": new Date().toISOString(),
        "paypal-auth-algo": "SHA256withRSA",
        "paypal-cert-url": `${fakeBase()}/fake-cert`,
      },
      body: JSON.stringify({
        id: `WH-${randomUUID()}`,
        event_type,
        resource_type: event_type.split(".")[1]?.toLowerCase(),
        resource,
      }),
    }).catch((e: unknown) => console.error("fake webhook delivery failed", e));

  const send = (res: ServerResponse, status: number, body: unknown) => {
    const identity = identities.get(res);
    if (identity && status >= 200 && status < 300)
      requests.set(identity.key, { ...identity, status, body: structuredClone(body) });
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const read = (req: IncomingMessage) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch (error) {
          reject(error);
        }
      });
    });

  const authorizationOf = (id: string, a: { amount: Amount; createdAt: number }) => ({
    id,
    status: "CREATED",
    amount: a.amount,
    expiration_time: new Date(a.createdAt + 29 * day).toISOString(),
    create_time: new Date(a.createdAt).toISOString(),
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const body = req.method === "POST" && path !== "/v1/oauth2/token" ? await read(req) : {};
    let m: RegExpMatchArray | null;
    const requestId = req.headers["paypal-request-id"];
    if (typeof requestId === "string") {
      const fingerprint = JSON.stringify([req.method, path, body]);
      const prior = requests.get(requestId);
      if (prior)
        return prior.fingerprint === fingerprint
          ? send(res, prior.status, prior.body)
          : send(res, 409, { name: "FAKE_REQUEST_ID_CONFLICT" });
      identities.set(res, { key: requestId, fingerprint });
    }
    m = path.match(/^\/v2\/payments\/authorizations\/([^/]+)$/);
    if (m) {
      const authorization = auths.get(m[1] ?? "");
      return authorization
        ? send(res, 200, authorizationOf(m[1] ?? "", authorization))
        : send(res, 404, { name: "RESOURCE_NOT_FOUND" });
    }
    m = path.match(/^\/v2\/payments\/captures\/([^/]+)$/);
    if (m) {
      const capture = captures.get(m[1] ?? "");
      return capture ? send(res, 200, capture) : send(res, 404, { name: "RESOURCE_NOT_FOUND" });
    }

    if (path === "/v1/oauth2/token")
      return send(res, 200, { access_token: "fake-token", expires_in: 32400, scope: "fake" });
    if (path === "/v1/notifications/verify-webhook-signature")
      return send(res, 200, { verification_status: "SUCCESS" });

    if (path === "/pagespeedonline/v5/runPagespeed") {
      const target = url.searchParams.get("url") ?? "";
      const category = url.searchParams.get("category") ?? "performance";
      const score = target.includes("/good") ? 0.96 : 0.41;
      return send(res, 200, { lighthouseResult: { categories: { [category]: { score } } } });
    }

    if (path === "/v2/checkout/orders" && req.method === "POST") {
      if (
        !["AUTHORIZE", "CAPTURE"].includes(String(body.intent)) ||
        !Array.isArray(body.purchase_units)
      )
        return send(res, 400, { name: "INVALID_FAKE_ORDER" });
      const order: Order = {
        id: `FAKE-${randomUUID().slice(0, 8)}`,
        intent: body.intent as Order["intent"],
        status: "CREATED",
        purchase_units: body.purchase_units as Order["purchase_units"],
      };
      order.links = [
        {
          rel: "approve",
          href: `${fakeBase()}/approve/${order.id}`,
          method: "GET",
        },
      ];
      orders.set(order.id, order);
      return send(res, 201, {
        ...order,
        links: [
          {
            rel: "approve",
            href: `${fakeBase()}/approve/${order.id}`,
            method: "GET",
          },
        ],
      });
    }

    m = path.match(/^\/__test\/approve\/([^/]+)$/);
    if (m) {
      const order = orders.get(m[1] ?? "");
      if (!order) return send(res, 404, { name: "RESOURCE_NOT_FOUND" });
      order.status = "APPROVED";
      await emit("CHECKOUT.ORDER.APPROVED", {
        id: order.id,
        status: "APPROVED",
        intent: order.intent,
        purchase_units: order.purchase_units,
      });
      return send(res, 200, order);
    }

    m = path.match(/^\/v2\/checkout\/orders\/([^/]+)$/);
    if (m) {
      const order = orders.get(m[1] ?? "");
      return order ? send(res, 200, order) : send(res, 404, { name: "RESOURCE_NOT_FOUND" });
    }

    m = path.match(/^\/v2\/checkout\/orders\/([^/]+)\/(authorize|capture)$/);
    if (m) {
      const order = orders.get(m[1] ?? "");
      if (order?.status !== "APPROVED")
        return send(res, 422, {
          name: "UNPROCESSABLE_ENTITY",
          details: [{ issue: "ORDER_NOT_APPROVED" }],
        });
      const unit = order.purchase_units[0];
      if (!unit) return send(res, 400, { name: "MISSING_UNIT" });
      const amount = unit.amount;
      order.status = "COMPLETED";
      if (m[2] === "authorize") {
        const id = `AUTH-${randomUUID().slice(0, 8)}`;
        const a = { orderId: order.id, amount, createdAt: Date.now() };
        auths.set(id, a);
        await emit("PAYMENT.AUTHORIZATION.CREATED", {
          ...authorizationOf(id, a),
          supplementary_data: { related_ids: { order_id: order.id } },
        });
        return send(res, 201, {
          ...order,
          purchase_units: [
            { ...order.purchase_units[0], payments: { authorizations: [authorizationOf(id, a)] } },
          ],
        });
      }
      const capture = {
        id: `CAP-${randomUUID().slice(0, 8)}`,
        status: "COMPLETED",
        amount,
        supplementary_data: { related_ids: { order_id: order.id } },
      };
      captures.set(capture.id, capture);
      await emit("PAYMENT.CAPTURE.COMPLETED", capture);
      return send(res, 201, {
        ...order,
        purchase_units: [{ ...order.purchase_units[0], payments: { captures: [capture] } }],
      });
    }

    m = path.match(/^\/v2\/payments\/authorizations\/([^/]+)\/(capture|reauthorize|void)$/);
    if (m) {
      const a = auths.get(m[1] ?? "");
      if (!a) return send(res, 404, { name: "RESOURCE_NOT_FOUND" });
      if (m[2] === "void") {
        auths.delete(m[1] ?? "");
        await emit("PAYMENT.AUTHORIZATION.VOIDED", { id: m[1], status: "VOIDED" });
        return send(res, 204, {});
      }
      if (m[2] === "reauthorize") {
        const id = `AUTH-${randomUUID().slice(0, 8)}`;
        const fresh = { ...a, createdAt: a.createdAt };
        auths.set(id, fresh);
        return send(res, 201, {
          ...authorizationOf(id, fresh),
          expiration_time: new Date(Date.now() + 3 * day).toISOString(),
        });
      }
      const capture = {
        id: `CAP-${randomUUID().slice(0, 8)}`,
        status: "COMPLETED",
        amount: body.amount ?? a.amount,
        supplementary_data: { related_ids: { order_id: a.orderId, authorization_id: m[1] } },
      };
      captures.set(capture.id, capture);
      await emit("PAYMENT.CAPTURE.COMPLETED", capture);
      return send(res, 201, capture);
    }

    if (path === "/v1/payments/referenced-payouts-items") {
      const item = {
        item_id: `RPI-${randomUUID().slice(0, 8)}`,
        reference_id: body.reference_id,
        processing_state: { status: "SUCCESS" },
      };
      await emit("PAYMENT.REFERENCED-PAYOUT-ITEM.COMPLETED", item);
      return send(res, 201, item);
    }

    if (path === "/v1/payments/payouts") {
      const batch = {
        batch_header: {
          payout_batch_id: `PB-${randomUUID().slice(0, 8)}`,
          batch_status: "SUCCESS",
          sender_batch_header: body.sender_batch_header,
        },
      };
      await emit("PAYMENT.PAYOUTSBATCH.SUCCESS", batch.batch_header);
      return send(res, 201, batch);
    }

    if (path === "/v2/customer/partner-referrals") {
      return send(res, 201, {
        links: [{ rel: "action_url", href: `${fakeBase()}/onboard` }],
      });
    }

    return send(res, 404, { name: "NOT_IMPLEMENTED_IN_FAKE", path });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake_paypal_not_listening");
  return {
    host: address.address,
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await startFakePayPal({
    port: Number(process.env.FAKE_PAYPAL_PORT ?? 4010),
    webhookUrl: process.env.FAKE_WEBHOOK_URL ?? "http://localhost:3100/api/webhooks/paypal",
  });
  console.log("fake paypal ready");
}
