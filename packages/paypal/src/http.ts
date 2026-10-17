import { errorFromResponse, networkError } from "./errors";

export type PayPalConfig = {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  partnerAttributionId?: string | undefined;
  partnerMerchantId?: string | undefined;
};

export type RequestOptions = {
  beforeDispatch?: (() => Promise<void>) | undefined;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string> | undefined;
  body?: unknown;
  rawJson?: string | undefined;
  form?: FormData | undefined;
  requestId?: string | undefined;
  authAssertionFor?: string | undefined;
  prefer?: "return=representation" | "return=minimal" | undefined;
};

const TIMEOUT_MS = 20_000;
const REFRESH_MARGIN_MS = 60_000;

export function authAssertion(clientId: string, merchantId: string): string {
  const enc = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64");
  return `${enc({ alg: "none" })}.${enc({ iss: clientId, payer_id: merchantId })}.`;
}

function parse(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 300) };
  }
}

export function createTransport(config: PayPalConfig) {
  let cached: { token: string; expiresAt: number } | null = null;
  let inflight: Promise<string> | null = null;

  async function send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (cause) {
      throw networkError(cause);
    }
  }

  async function fetchToken(): Promise<string> {
    const res = await send(`${config.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const body = parse(await res.text());
    if (!res.ok) throw errorFromResponse(res.status, body, res.headers.get("paypal-debug-id"));
    const { access_token, expires_in } = body as { access_token: string; expires_in: number };
    cached = { token: access_token, expiresAt: Date.now() + expires_in * 1000 - REFRESH_MARGIN_MS };
    return access_token;
  }

  async function accessToken(): Promise<string> {
    if (cached && cached.expiresAt > Date.now()) return cached.token;
    inflight ??= fetchToken().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  async function request<T>(opts: RequestOptions, isRetry = false): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${await accessToken()}` };
    let body: RequestInit["body"] = null;
    if (opts.form) {
      body = opts.form;
    } else if (opts.rawJson !== undefined || opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = opts.rawJson ?? JSON.stringify(opts.body);
    }
    if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;
    if (opts.prefer) headers.Prefer = opts.prefer;
    if (opts.authAssertionFor)
      headers["PayPal-Auth-Assertion"] = authAssertion(config.clientId, opts.authAssertionFor);
    if (config.partnerAttributionId)
      headers["PayPal-Partner-Attribution-Id"] = config.partnerAttributionId;

    const qs = opts.query ? `?${new URLSearchParams(opts.query)}` : "";
    await opts.beforeDispatch?.();
    const res = await send(`${config.baseUrl}${opts.path}${qs}`, {
      method: opts.method,
      headers,
      body,
    });

    if (res.status === 401 && !isRetry) {
      cached = null;
      return request<T>(opts, true);
    }
    if (res.status === 204) return undefined as T;
    const json = parse(await res.text());
    if (!res.ok) throw errorFromResponse(res.status, json, res.headers.get("paypal-debug-id"));
    return json as T;
  }

  return { request, accessToken };
}

export type Transport = ReturnType<typeof createTransport>;

const LIVE_HOSTS = new Set(["api-m.paypal.com", "api.paypal.com"]);

export function payPalConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): PayPalConfig {
  const baseUrl = env.PAYPAL_API_BASE || "https://api-m.sandbox.paypal.com";
  if (LIVE_HOSTS.has(new URL(baseUrl).hostname))
    throw new Error("Tranche runs against the PayPal sandbox only");
  const clientId = env.PAYPAL_CLIENT_ID;
  const clientSecret = env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret)
    throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set");
  return {
    clientId,
    clientSecret,
    baseUrl,
    partnerAttributionId: env.PAYPAL_PARTNER_ATTRIBUTION_ID || undefined,
    partnerMerchantId: env.PAYPAL_PARTNER_MERCHANT_ID || undefined,
  };
}
