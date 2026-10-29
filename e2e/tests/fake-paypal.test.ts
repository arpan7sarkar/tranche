import { createServer } from "node:http";
import { afterAll, beforeAll, expect, it } from "vitest";
import { startFakePayPal } from "../fakes/paypal";

let fake: Awaited<ReturnType<typeof startFakePayPal>>;
const sink = createServer((_req, response) => response.end());
beforeAll(async () => {
  await new Promise<void>((resolve) => sink.listen(4912, resolve));
  fake = await startFakePayPal({ port: 4911, webhookUrl: "http://localhost:4912" });
});
afterAll(async () => {
  await fake?.close();
  sink.close();
});
const post = (path: string, body: unknown, key: string) =>
  fetch(`http://localhost:4911${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "PayPal-Request-Id": key },
    body: JSON.stringify(body),
  });
it("reuses request identities and rejects changed payloads", async () => {
  const body = {
    intent: "AUTHORIZE",
    purchase_units: [{ amount: { currency_code: "USD", value: "10.00" } }],
  };
  const first = await (await post("/v2/checkout/orders", body, "create-one")).json();
  expect(await (await post("/v2/checkout/orders", body, "create-one")).json()).toEqual(first);
  expect(
    (await post("/v2/checkout/orders", { ...body, intent: "CAPTURE" }, "create-one")).status,
  ).toBe(409);
});
it("supports approved authorization, capture, and authoritative reads", async () => {
  const order = (await (
    await post(
      "/v2/checkout/orders",
      {
        intent: "AUTHORIZE",
        purchase_units: [{ amount: { currency_code: "USD", value: "10.00" } }],
      },
      "create-two",
    )
  ).json()) as { id: string };
  await post(`/__test/approve/${order.id}`, {}, "approve-two");
  const authorized = (await (
    await post(`/v2/checkout/orders/${order.id}/authorize`, {}, "authorize-two")
  ).json()) as { purchase_units: { payments: { authorizations: { id: string }[] } }[] };
  const id = authorized.purchase_units[0]?.payments.authorizations[0]?.id;
  expect(id).toBeTruthy();
  expect((await fetch(`http://localhost:4911/v2/payments/authorizations/${id}`)).ok).toBe(true);
  const response = await post(`/v2/payments/authorizations/${id}/capture`, {}, "capture-two");
  const capture = (await response.json()) as { id: string; status: string };
  expect(capture.status).toBe("COMPLETED");
  expect(
    await (await post(`/v2/payments/authorizations/${id}/capture`, {}, "capture-two")).json(),
  ).toEqual(capture);
  expect(
    await (await fetch(`http://localhost:4911/v2/payments/captures/${capture.id}`)).json(),
  ).toEqual(capture);
});
