import { vi } from "vitest";

export const BASE_URL = "https://api-m.sandbox.paypal.com";
export const CONFIG = {
  clientId: "client-id",
  clientSecret: "client-secret",
  baseUrl: BASE_URL,
  partnerMerchantId: "PARTNER123",
};

export type Route = {
  method: string;
  path: string | RegExp;
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
};

export type Call = { method: string; url: URL; headers: Headers; body: string | null };

export function mockPayPal(routes: Route[]) {
  const calls: Call[] = [];
  const queue = [...routes];
  let tokenCalls = 0;
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const i = queue.findIndex(
      (r) =>
        r.method === method &&
        (typeof r.path === "string" ? r.path === url.pathname : r.path.test(url.pathname)),
    );
    if (url.pathname === "/v1/oauth2/token" && i === -1) {
      tokenCalls++;
      return Response.json({
        access_token: `token-${tokenCalls}`,
        token_type: "Bearer",
        expires_in: 32400,
      });
    }
    const body =
      typeof init?.body === "string" ? init.body : init?.body instanceof FormData ? "[form]" : null;
    calls.push({ method, url, headers: new Headers(init?.headers), body });
    if (i === -1) throw new Error(`Unexpected ${method} ${url.pathname}`);
    const route = queue.splice(i, 1)[0] as Route;
    if (route.status === 204) return new Response(null, { status: 204 });
    return new Response(
      typeof route.body === "string" ? route.body : JSON.stringify(route.body ?? {}),
      {
        status: route.status ?? 200,
        headers: { "content-type": "application/json", ...route.headers },
      },
    );
  });
  vi.stubGlobal("fetch", fn);
  return { calls, tokenCalls: () => tokenCalls, remaining: () => queue.length };
}

export const UNPROCESSABLE = {
  name: "UNPROCESSABLE_ENTITY",
  message: "The requested action could not be performed.",
  debug_id: "f1a2b3c4d5e6f",
  details: [{ issue: "DELAYED_DISBURSEMENT_NOT_SUPPORTED", description: "Not enabled." }],
};

export const ORDER_APPROVED = {
  id: "5O190127TN364715T",
  status: "APPROVED",
  purchase_units: [{ reference_id: "m1" }],
};

export const ORDER_CAPTURED = {
  id: "5O190127TN364715T",
  status: "COMPLETED",
  payment_source: { paypal: { attributes: { vault: { id: "8kk8451t", status: "VAULTED" } } } },
  purchase_units: [
    {
      reference_id: "m1",
      payments: {
        captures: [
          {
            id: "3C679366HH908993F",
            status: "COMPLETED",
            amount: { currency_code: "USD", value: "1000.00" },
            create_time: "2026-10-10T10:00:00Z",
          },
        ],
      },
    },
  ],
};
