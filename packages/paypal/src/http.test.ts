import { afterEach, describe, expect, it, vi } from "vitest";
import { PayPalError } from "./errors";
import { CONFIG, mockPayPal, UNPROCESSABLE } from "./fixtures";
import { authAssertion, createTransport } from "./http";

afterEach(() => vi.unstubAllGlobals());

describe("transport", () => {
  it("refreshes the token once on 401", async () => {
    const m = mockPayPal([
      { method: "GET", path: "/a", status: 401, body: { error: "invalid_token" } },
      { method: "GET", path: "/a", body: { ok: true } },
    ]);
    const t = createTransport(CONFIG);
    await expect(t.request({ method: "GET", path: "/a" })).resolves.toEqual({ ok: true });
    expect(m.tokenCalls()).toBe(2);
    expect(m.calls[1]?.headers.get("authorization")).toBe("Bearer token-2");
  });

  it("does not loop on a second 401", async () => {
    mockPayPal([
      { method: "GET", path: "/a", status: 401, body: { error: "invalid_token" } },
      { method: "GET", path: "/a", status: 401, body: { error: "invalid_token" } },
    ]);
    const t = createTransport(CONFIG);
    await expect(t.request({ method: "GET", path: "/a" })).rejects.toMatchObject({
      status: 401,
      retryable: false,
    });
  });

  it("sends the idempotency key and seller assertion on writes", async () => {
    const m = mockPayPal([{ method: "POST", path: "/v2/checkout/orders", body: { id: "X" } }]);
    const t = createTransport(CONFIG);
    await t.request({
      method: "POST",
      path: "/v2/checkout/orders",
      body: { a: 1 },
      requestId: "req-1",
      authAssertionFor: "SELLER1",
    });
    const h = m.calls[0]?.headers;
    expect(h?.get("paypal-request-id")).toBe("req-1");
    expect(h?.get("paypal-auth-assertion")).toBe(authAssertion("client-id", "SELLER1"));
  });

  it("retries only rate limits, server and network failures", async () => {
    mockPayPal([
      { method: "POST", path: "/x", status: 422, body: UNPROCESSABLE },
      { method: "GET", path: "/busy", status: 429, body: { name: "RATE_LIMIT_REACHED" } },
      { method: "GET", path: "/down", status: 503, body: "<html>Service Unavailable</html>" },
    ]);
    const t = createTransport(CONFIG);
    const err = await t.request({ method: "POST", path: "/x", body: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err).toMatchObject({
      name: "UNPROCESSABLE_ENTITY",
      issue: "DELAYED_DISBURSEMENT_NOT_SUPPORTED",
      retryable: false,
    });
    await expect(t.request({ method: "GET", path: "/busy" })).rejects.toMatchObject({
      retryable: true,
    });
    await expect(t.request({ method: "GET", path: "/down" })).rejects.toMatchObject({
      retryable: true,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(
      createTransport(CONFIG).request({ method: "GET", path: "/a" }),
    ).rejects.toMatchObject({ name: "NETWORK_ERROR", status: 0, retryable: true });
  });
});
