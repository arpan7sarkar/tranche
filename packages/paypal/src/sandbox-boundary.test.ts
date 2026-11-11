import { afterEach, describe, expect, it, vi } from "vitest";
import { createTransport, payPalConfigFromEnv } from "./http";

const sandbox = "https://api-m.sandbox.paypal.com";
const credentials = { clientId: "synthetic-id", clientSecret: "synthetic-secret" };
const envCredentials = {
  PAYPAL_CLIENT_ID: "synthetic-id",
  PAYPAL_CLIENT_SECRET: "synthetic-secret",
};
const invalidOrigins = [
  "https://example.invalid",
  "https://api-m.paypal.com",
  "https://api.paypal.com",
  "http://api-m.sandbox.paypal.com",
  "https://api-m.sandbox.paypal.com:8443",
  "https://api-m.sandbox.paypal.com.example.invalid",
  "https://api-m.sandbox.paypal.com@example.invalid",
  "https://api-m.sandbox.paypal.com/path",
  "https://api-m.sandbox.paypal.com?target=example.invalid",
  "https://api-m.sandbox.paypal.com#fragment",
  "not a url",
];

afterEach(() => vi.unstubAllGlobals());

describe("PayPal sandbox boundary", () => {
  it("defaults environment config to the canonical sandbox origin", () => {
    expect(payPalConfigFromEnv(envCredentials).baseUrl).toBe(sandbox);
    expect(payPalConfigFromEnv({ ...envCredentials, PAYPAL_API_BASE: sandbox }).baseUrl).toBe(
      sandbox,
    );
  });

  it("accepts sandbox mode and normalizes a trailing slash", () => {
    expect(
      payPalConfigFromEnv({
        ...envCredentials,
        PAYPAL_ENV: "sandbox",
        PAYPAL_API_BASE: `${sandbox}/`,
      }).baseUrl,
    ).toBe(sandbox);
  });

  it.each(["live", "production"])("rejects environment mode %s without dispatch", (mode) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(() => payPalConfigFromEnv({ ...envCredentials, PAYPAL_ENV: mode })).toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(invalidOrigins)("rejects environment origin %s without dispatch", (baseUrl) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(() => payPalConfigFromEnv({ ...envCredentials, PAYPAL_API_BASE: baseUrl })).toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(invalidOrigins)(
    "rejects directly configured origin %s before any dispatch",
    async (baseUrl) => {
      const fetch = vi.fn(async () => {
        throw new Error("fake fetch must not be called");
      });
      vi.stubGlobal("fetch", fetch);
      await expect(
        Promise.resolve().then(() =>
          createTransport({ ...credentials, baseUrl }).request({
            method: "POST",
            path: "/v2/checkout/orders",
            body: {},
          }),
        ),
      ).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("dispatches OAuth and orders only to the canonical sandbox with redirects disabled", async () => {
    const fetch = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);
      if (url === `${sandbox}/v1/oauth2/token`)
        return Response.json({ access_token: "fake-token", expires_in: 3600 });
      if (url === `${sandbox}/v2/checkout/orders`) return Response.json({ id: "fake-order" });
      throw new Error("unexpected fake dispatch");
    });
    vi.stubGlobal("fetch", fetch);
    await expect(
      createTransport({ ...credentials, baseUrl: sandbox }).request({
        method: "POST",
        path: "/v2/checkout/orders",
        body: {},
      }),
    ).resolves.toEqual({ id: "fake-order" });
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [, init] of fetch.mock.calls) expect(init?.redirect).toBe("error");
  });

  it("does not follow a mutated configuration to another origin", async () => {
    const config = { ...credentials, baseUrl: sandbox };
    const fetch = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe(`${sandbox}/v1/oauth2/token`);
      return Response.json({ access_token: "fake-token", expires_in: 3600 });
    });
    vi.stubGlobal("fetch", fetch);
    const transport = createTransport(config);
    config.baseUrl = "https://example.invalid";
    await transport.accessToken();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(["oauth", "order"])("does not follow a %s redirect", async (redirectStage) => {
    const dispatched: string[] = [];
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      dispatched.push(url);
      const isToken = url === `${sandbox}/v1/oauth2/token`;
      if ((redirectStage === "oauth" && isToken) || (redirectStage === "order" && !isToken)) {
        if (init?.redirect === "error") throw new TypeError("redirect rejected");
        dispatched.push("https://example.invalid/redirected");
        return Response.json({ access_token: "fake-token", expires_in: 3600, id: "fake-order" });
      }
      return Response.json({ access_token: "fake-token", expires_in: 3600 });
    });
    vi.stubGlobal("fetch", fetch);
    await expect(
      createTransport({ ...credentials, baseUrl: sandbox }).request({
        method: "POST",
        path: "/v2/checkout/orders",
        body: {},
      }),
    ).rejects.toThrow();
    expect(dispatched).not.toContain("https://example.invalid/redirected");
    expect(dispatched).toHaveLength(redirectStage === "oauth" ? 1 : 2);
  });
});
