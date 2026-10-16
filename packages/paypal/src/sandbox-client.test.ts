import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { SandboxClient, type SandboxRequestAccounting } from "./sandbox-client";

const config = { environment: "sandbox", clientId: "FAKE_CLIENT", clientSecret: "FAKE_SECRET" };
const token = () =>
  Response.json({ access_token: "FAKE_TOKEN", token_type: "Bearer", expires_in: 3600 });
function setup(fetcher: typeof fetch) {
  const accounting = {
    reserve: vi.fn<SandboxRequestAccounting["reserve"]>(async () => randomUUID()),
    finish: vi.fn(async () => {}),
  };
  return { client: new SandboxClient(config, accounting, fetcher), accounting };
}

describe("counted sandbox transport", () => {
  it("accepts an empty successful void response under its write permit", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { client } = setup(fetcher);
    const beforeDispatch = vi.fn(async () => {});
    const requestId = randomUUID();
    await expect(
      client.request(
        { method: "POST", path: "/v2/payments/authorizations/AUTH1/void" },
        { permit: { requestId, beforeDispatch } },
      ),
    ).resolves.toBeUndefined();
    expect(beforeDispatch).toHaveBeenCalledOnce();
    const headers = fetcher.mock.calls[1]?.[1]?.headers as Record<string, string> | undefined;
    expect(headers?.["PayPal-Request-Id"]).toBe(requestId);
  });
  it("binds seller assertions to the configured platform and generates tokens only for transport", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValue(Response.json({}));
    const { client } = setup(fetcher);
    await expect(
      client.request({
        method: "GET",
        path: "/v2/checkout/orders/FAKE",
        assertion: { platformClientId: "OTHER", sellerMerchantId: "SELLERA000001" },
      }),
    ).rejects.toThrow("sandbox_configuration");
    expect(fetcher).not.toHaveBeenCalled();
    await client.request({
      method: "GET",
      path: "/v2/checkout/orders/FAKE",
      assertion: { platformClientId: config.clientId, sellerMerchantId: "SELLERA000001" },
      representation: true,
    });
    const headers = fetcher.mock.calls[1]?.[1]?.headers as Record<string, string>;
    const jwt = headers["PayPal-Auth-Assertion"] ?? "";
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);
    expect(parts[2]).toBe("");
    expect(JSON.parse(Buffer.from(parts[0] ?? "", "base64").toString())).toEqual({ alg: "none" });
    expect(JSON.parse(Buffer.from(parts[1] ?? "", "base64").toString())).toEqual({
      iss: config.clientId,
      payer_id: "SELLERA000001",
    });
    expect(headers.Prefer).toBe("return=representation");
  });
  it("sends validated partner attribution without accepting arbitrary headers", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValue(Response.json({}));
    const { client } = setup(fetcher);
    await expect(
      client.request({
        method: "GET",
        path: "/v1/customer/partners/FAKE",
        partner: { attributionId: "bad\r\nheader" },
      }),
    ).rejects.toThrow("sandbox_configuration");
    expect(fetcher).not.toHaveBeenCalled();
    await client.request({
      method: "GET",
      path: "/v1/customer/partners/FAKE",
      partner: { attributionId: "FAKE_BN" },
    });
    expect(fetcher.mock.calls[1]?.[1]?.headers).toMatchObject({
      "PayPal-Partner-Attribution-Id": "FAKE_BN",
      Authorization: "Bearer FAKE_TOKEN",
    });
  });
  it("counts OAuth once, caches its token and counts every read", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ status: "COMPLETED" }))
      .mockResolvedValueOnce(token());
    const { client, accounting } = setup(fetcher);
    await client.request({ method: "GET", path: "/v2/checkout/orders/FAKE" });
    await client.request({ method: "GET", path: "/v2/checkout/orders/FAKE" });
    expect(accounting.reserve.mock.calls.map(([kind]) => kind)).toEqual(["oauth", "read", "read"]);
    for (const [url, options] of fetcher.mock.calls) {
      expect(String(url).startsWith("https://api-m.sandbox.paypal.com/")).toBe(true);
      expect(options?.redirect).toBe("manual");
      expect(options?.signal).toBeInstanceOf(AbortSignal);
    }
  });
  it("requires an outbox permit before POST and sends the stable request ID", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValue(Response.json({}));
    const { client } = setup(fetcher);
    await expect(client.request({ method: "POST", path: "/v2/checkout/orders" })).rejects.toThrow(
      "sandbox_configuration",
    );
    expect(fetcher).not.toHaveBeenCalled();
    const beforeDispatch = vi.fn(async () => {});
    const requestId = randomUUID();
    await client.request(
      { method: "POST", path: "/v2/checkout/orders", body: {} },
      { permit: { requestId, beforeDispatch } },
    );
    expect(beforeDispatch).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[1]?.[1]?.headers).toMatchObject({ "PayPal-Request-Id": requestId });
  });
  it.each([
    "https://evil.example",
    "//evil.example",
    "/v2/../secret",
    "/v2/orders?token=PRIVATE",
    "/v1/oauth2/token",
  ])("rejects unsafe destination %s before OAuth", async (path) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(setup(fetcher).client.request({ method: "GET", path })).rejects.toThrow(
      "sandbox_destination",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([302, 403, 429, 500])(
    "never retries HTTP %i or prints provider errors",
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("FAKE_SECRET private@example.test", { status }));
      const { client } = setup(fetcher);
      await expect(
        client.request({ method: "GET", path: "/v2/checkout/orders/FAKE" }),
      ).rejects.toThrow(/^sandbox_http$/);
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );
  it("redacts network errors and does not retry", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("FAKE_SECRET"));
    await expect(
      setup(fetcher).client.request({ method: "GET", path: "/v2/checkout/orders/FAKE" }),
    ).rejects.toThrow(/^sandbox_network$/);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("rejects malformed OAuth without a business dispatch", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ access_token: "BAD\nTOKEN" }));
    await expect(
      setup(fetcher).client.request({ method: "GET", path: "/v2/checkout/orders/FAKE" }),
    ).rejects.toThrow("sandbox_response");
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("stops when the counter refuses a request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const { client, accounting } = setup(fetcher);
    accounting.reserve.mockRejectedValue(new Error("call_limit"));
    await expect(
      client.request({ method: "GET", path: "/v2/checkout/orders/FAKE" }),
    ).rejects.toThrow("call_limit");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects live configuration", () => {
    expect(
      () =>
        new SandboxClient(
          { ...config, environment: "live" },
          { reserve: async () => "", finish: async () => {} },
        ),
    ).toThrow("sandbox_configuration");
  });

  it("combines the recovery deadline with the request timeout", async () => {
    const signal = AbortSignal.abort();
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      setup(fetcher).client.request(
        { method: "GET", path: "/v2/checkout/orders/FAKE" },
        { signal },
      ),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not send a write when a stale outbox permit is refused", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(token());
    await expect(
      setup(fetcher).client.request(
        { method: "POST", path: "/v2/checkout/orders", body: {} },
        {
          permit: {
            requestId: randomUUID(),
            beforeDispatch: async () => {
              throw new Error("claim_expired");
            },
          },
        },
      ),
    ).rejects.toThrow("claim_expired");
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
