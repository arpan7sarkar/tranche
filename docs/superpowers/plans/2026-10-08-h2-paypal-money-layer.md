# H2 - PayPal Money Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A typed, idempotent PayPal client for every money movement Tranche makes, the agency "Connect PayPal" backend, the client funding routes, and a read-only PayPal toolset for agents.

**Architecture:** One fetch-based transport in `packages/paypal` owns OAuth, headers (`PayPal-Request-Id`, `Prefer`, `PayPal-Auth-Assertion`, `PayPal-Partner-Attribution-Id`) and error mapping to `PayPalError`. `createPayPalClient` builds every money method on top of it; holds work for both mechanisms behind a `mechanism` argument. The transport never retries business calls itself: retries belong to the H3 outbox executor, which reads `PayPalError.retryable`. Next.js route handlers in `apps/web` stay thin and call tested functions in `apps/web/src/server/`.

**Tech Stack:** TypeScript 7, native `fetch`, Vitest 5, Drizzle 0.45, Next.js 16 route handlers, `@paypal/agent-toolkit` 1.11 (MCP server), `@ai-sdk/mcp` 2.0, `@modelcontextprotocol/sdk` 1.32.

**Spec:** `docs/superpowers/specs/2026-10-08-tranche-design.md` (sections 9, 10, 12, 14)

**Owner:** Person H.

**Depends on:** Foundation plan `2026-10-08-00-foundation.md` (contracts, schema, `docs/sandbox-capabilities.md`).
Tasks 7 and 8 also consume two session helpers from the H5 frontend plan (named in their Interfaces blocks).

## Why not the official server SDK

`@paypal/paypal-server-sdk` 2.5.0 (APIMatic generated) covers Orders v2, Payments v2 (authorize, capture, reauthorize, void, refund), Vault v3, Transaction Search and Subscriptions.
It does not cover Partner Referrals, merchant integrations, referenced payouts, Payouts, webhook verification or Disputes, so a fetch client is needed regardless.
The SDK ships its own OAuth manager, its own `ApiError` model and an axios transport, so using it for half the calls would give the money layer two token caches, two error models and two retry classifications, and its calls cannot be stubbed with the same `fetch` mock.
This plan therefore uses one fetch transport for every endpoint and removes `@paypal/paypal-server-sdk` from `packages/paypal`.
The APIMatic sponsor story is unaffected: it rests on the APIMatic Context Plugin used during development (spec section 14).

## Integration overrides

The [integration contract](2026-10-08-01-integration-contract.md) wins over anything in this plan that conflicts with it.
Items that affect this plan:

- Web helpers: use `getDb()` from `apps/web/src/server/db.ts`, `getPayPal()` from `apps/web/src/server/paypal.ts`, and `memberOrNull(request)` from `apps/web/src/server/session.ts` instead of `requireWorkspaceId` (section 1).
- Portal token checks use `resolveMagicLink` from `@tranche/db` instead of `resolvePortalToken` (section 2).
- Portal funding return URL: `${APP_URL}/portal/<token>?funded=<milestoneId>` (section 2).
- Honor `PAYPAL_API_BASE` for the end-to-end fake server (section 6).

## Global Constraints

- PayPal sandbox only; default base URL `https://api-m.sandbox.paypal.com`.
- Money crosses into PayPal only through `toPayPalValue` and comes back only through `fromPayPalValue` from `@tranche/contracts`.
- Every PayPal write sends `PayPal-Request-Id`; the id is derived from a database id so a retry reuses it.
- PayPal holds: authorization valid 29 days with a 3 day honor period; delayed disbursement auto-disburses to the seller after 28 days.
- `expiresAt` returned by this layer is the hard deadline (authorization `expiration_time` minus 1 day; delayed capture time plus 27 days), not the honor period; `honorExpiresAt` is returned separately.
- Agents never receive a tool that moves money.
- No em dash characters anywhere; use a plain `-`.
- Comments only when they carry real value.
- Conventional commits, no AI co-author lines.

## Review Focus

- **A webhook body re-serialized before verification** (key order or whitespace changed): PayPal verifies the exact bytes, so `verifyWebhook` must splice the raw body into the request verbatim - pinned by Task 4 Step 1 `"sends the raw webhook body verbatim"`.
- **A crash after PayPal captured but before we stored the result, then a retry**: `placeHold` must read the order first and never capture twice - pinned by Task 3 Step 1 `"does not capture an order that is already captured"`.
- **An access token revoked or expired mid-flight (401)**: the transport refreshes once and retries the call - pinned by Task 1 Step 1 `"refreshes the token once on 401"`.
- **A client opening a crafted URL to fund or confirm a milestone of another deal**: 404, nothing created - pinned by Task 8 Step 1 `"refuses a milestone from another deal"` and `"refuses an order from another deal"`.
- **The client double-clicks "approve" while PayPal's webhook also arrives**: exactly one `paypal.place_hold` outbox row - pinned by Task 8 Step 1 `"enqueues place_hold once even when confirmed twice"`.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/paypal/src/errors.ts` | `PayPalError`, error parsing, retry classification |
| `packages/paypal/src/http.ts` | `createTransport`: OAuth cache, headers, `authAssertion` |
| `packages/paypal/src/client.ts` | `createPayPalClient` and every money method, `holdFromOrder`, `approveUrlOf` |
| `packages/paypal/src/fees.ts` | `platformFeeFor` |
| `packages/paypal/src/outbox.ts` | `PAYPAL_OUTBOX_KINDS`, `runPayPalOutbox` for the H3 executor |
| `packages/paypal/src/webhook-events.ts` | `PAYPAL_WEBHOOK_EVENTS` |
| `packages/paypal/src/agent-tools.ts` | `readOnlyPayPalTools` (subpath export, not re-exported from index) |
| `packages/paypal/src/index.ts` | Public exports |
| `packages/paypal/src/fixtures.ts` | Test-only fetch mock and recorded PayPal responses |
| `packages/paypal/src/*.test.ts` | Unit tests |
| `packages/paypal/src/sandbox.test.ts` | Real sandbox integration suite (env gated) |
| `packages/paypal/scripts/register-webhook.ts` | Registers the sandbox webhook for a tunnel URL |
| `packages/paypal/scripts/fund-manually.ts` | Buyer-approval and vault flow, run by hand once |
| `apps/web/src/server/db.ts` | `getDb()` singleton |
| `apps/web/src/server/paypal.ts` | `getPayPal()`, `holdMechanism()`, `appUrl()` |
| `apps/web/src/server/onboarding.ts` | `startOnboarding`, `completeOnboarding` |
| `apps/web/src/server/funding.ts` | `startFunding`, `confirmApproval`, `enqueuePlaceHold`, `FundingError` |
| `apps/web/src/app/api/paypal/onboarding/route.ts` | `POST` start onboarding |
| `apps/web/src/app/api/paypal/onboarding/return/route.ts` | `GET` onboarding return |
| `apps/web/src/app/api/portal/[token]/milestones/[milestoneId]/fund/route.ts` | `POST` start funding |
| `apps/web/src/app/api/portal/[token]/orders/[orderId]/approved/route.ts` | `POST` buyer approved |

---

### Task 1: Transport, OAuth and PayPalError

**Files:**
- Modify: `packages/paypal/package.json`, `packages/paypal/tsconfig.json`
- Create: `packages/paypal/src/errors.ts`, `packages/paypal/src/http.ts`, `packages/paypal/src/fixtures.ts`
- Test: `packages/paypal/src/http.test.ts`

**Interfaces:**
- Consumes: nothing beyond Node 22 globals.
- Produces:
  - `class PayPalError extends Error { status: number; issue: string | null; debugId: string | null; retryable: boolean }` (`name` is PayPal's error name, for example `UNPROCESSABLE_ENTITY`; `status` 0 means a network failure).
  - `type PayPalConfig = { clientId: string; clientSecret: string; baseUrl: string; partnerAttributionId?: string | undefined; partnerMerchantId?: string | undefined }`. `partnerMerchantId` is the platform's own PayPal merchant id, needed only by `getSellerStatus`.
  - `createTransport(config): { request<T>(opts: RequestOptions): Promise<T>; accessToken(): Promise<string> }`, `type Transport`.
  - `authAssertion(clientId: string, merchantId: string): string`.

- [ ] **Step 1: Adjust the package and write the failing tests**

Replace `packages/paypal/package.json` with:

```json
{
  "name": "@tranche/paypal",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./agent-tools": "./src/agent-tools.ts"
  },
  "scripts": {
    "typecheck": "tsc",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "@ai-sdk/mcp": "2.0.71",
    "@modelcontextprotocol/sdk": "1.32.1",
    "@paypal/agent-toolkit": "1.11.0",
    "@tranche/contracts": "workspace:*"
  }
}
```

Replace `packages/paypal/tsconfig.json` with:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "scripts", "*.ts"]
}
```

Run: `pnpm install`

`packages/paypal/src/fixtures.ts`:

```ts
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
      (r) => r.method === method && (typeof r.path === "string" ? r.path === url.pathname : r.path.test(url.pathname)),
    );
    if (url.pathname === "/v1/oauth2/token" && i === -1) {
      tokenCalls++;
      return Response.json({ access_token: `token-${tokenCalls}`, token_type: "Bearer", expires_in: 32400 });
    }
    const body = typeof init?.body === "string" ? init.body : init?.body instanceof FormData ? "[form]" : null;
    calls.push({ method, url, headers: new Headers(init?.headers), body });
    if (i === -1) throw new Error(`Unexpected ${method} ${url.pathname}`);
    const route = queue.splice(i, 1)[0]!;
    if (route.status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(route.body ?? {}), {
      status: route.status ?? 200,
      headers: { "content-type": "application/json", ...route.headers },
    });
  });
  vi.stubGlobal("fetch", fn);
  return { calls, tokenCalls: () => tokenCalls, remaining: () => queue.length };
}

export const UNPROCESSABLE = {
  name: "UNPROCESSABLE_ENTITY",
  message: "The requested action could not be performed, semantically incorrect, or failed business validation.",
  debug_id: "f1a2b3c4d5e6f",
  details: [{ issue: "DELAYED_DISBURSEMENT_NOT_SUPPORTED", description: "Delayed disbursement is not enabled." }],
};

export const ORDER_PAYER_ACTION = {
  id: "5O190127TN364715T",
  status: "PAYER_ACTION_REQUIRED",
  links: [
    { href: `${BASE_URL}/v2/checkout/orders/5O190127TN364715T`, rel: "self", method: "GET" },
    { href: "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T", rel: "payer-action", method: "GET" },
  ],
};

export const ORDER_APPROVED = { id: "5O190127TN364715T", status: "APPROVED", purchase_units: [{ reference_id: "m1" }] };

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

export const ORDER_AUTHORIZED = {
  id: "5O190127TN364715T",
  status: "COMPLETED",
  purchase_units: [
    {
      reference_id: "m1",
      payments: {
        authorizations: [
          {
            id: "0VF52814937998046",
            status: "CREATED",
            amount: { currency_code: "USD", value: "1000.00" },
            create_time: "2026-10-10T10:00:00Z",
            expiration_time: "2026-11-08T10:00:00Z",
          },
        ],
      },
    },
  ],
};

export const REAUTHORIZED = {
  id: "8AA831015G517922L",
  status: "CREATED",
  create_time: "2026-10-15T10:00:00Z",
  expiration_time: "2026-11-08T10:00:00Z",
};
```

`packages/paypal/src/http.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { PayPalError } from "./errors";
import { CONFIG, mockPayPal, UNPROCESSABLE } from "./fixtures";
import { authAssertion, createTransport } from "./http";

afterEach(() => vi.unstubAllGlobals());

describe("transport", () => {
  it("caches the token across calls and shares an in-flight fetch", async () => {
    const m = mockPayPal([
      { method: "GET", path: "/a", body: { ok: 1 } },
      { method: "GET", path: "/b", body: { ok: 2 } },
      { method: "GET", path: "/c", body: { ok: 3 } },
    ]);
    const t = createTransport(CONFIG);
    await Promise.all([t.request({ method: "GET", path: "/a" }), t.request({ method: "GET", path: "/b" })]);
    await t.request({ method: "GET", path: "/c" });
    expect(m.tokenCalls()).toBe(1);
    expect(m.calls[0]!.headers.get("authorization")).toBe("Bearer token-1");
  });

  it("refreshes the token once on 401", async () => {
    const m = mockPayPal([
      { method: "GET", path: "/a", status: 401, body: { error: "invalid_token" } },
      { method: "GET", path: "/a", body: { ok: true } },
    ]);
    const t = createTransport(CONFIG);
    await expect(t.request({ method: "GET", path: "/a" })).resolves.toEqual({ ok: true });
    expect(m.tokenCalls()).toBe(2);
    expect(m.calls[1]!.headers.get("authorization")).toBe("Bearer token-2");
  });

  it("does not loop on a second 401", async () => {
    mockPayPal([
      { method: "GET", path: "/a", status: 401, body: { error: "invalid_token" } },
      { method: "GET", path: "/a", status: 401, body: { error: "invalid_token" } },
    ]);
    const t = createTransport(CONFIG);
    await expect(t.request({ method: "GET", path: "/a" })).rejects.toMatchObject({ status: 401, retryable: false });
  });

  it("sends idempotency, prefer, assertion and attribution headers", async () => {
    const m = mockPayPal([{ method: "POST", path: "/v2/checkout/orders", body: { id: "X" } }]);
    const t = createTransport({ ...CONFIG, partnerAttributionId: "TRANCHE_BN" });
    await t.request({
      method: "POST",
      path: "/v2/checkout/orders",
      body: { a: 1 },
      requestId: "req-1",
      prefer: "return=representation",
      authAssertionFor: "SELLER1",
    });
    const h = m.calls[0]!.headers;
    expect(h.get("paypal-request-id")).toBe("req-1");
    expect(h.get("prefer")).toBe("return=representation");
    expect(h.get("paypal-auth-assertion")).toBe(authAssertion("client-id", "SELLER1"));
    expect(h.get("paypal-partner-attribution-id")).toBe("TRANCHE_BN");
    expect(h.get("content-type")).toBe("application/json");
    expect(m.calls[0]!.body).toBe('{"a":1}');
  });

  it("maps business errors to non-retryable PayPalError", async () => {
    mockPayPal([{ method: "POST", path: "/x", status: 422, body: UNPROCESSABLE }]);
    const t = createTransport(CONFIG);
    const err = await t.request({ method: "POST", path: "/x", body: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err).toMatchObject({
      name: "UNPROCESSABLE_ENTITY",
      status: 422,
      issue: "DELAYED_DISBURSEMENT_NOT_SUPPORTED",
      debugId: "f1a2b3c4d5e6f",
      retryable: false,
    });
  });

  it("marks 429 and 5xx as retryable, including non-JSON bodies", async () => {
    mockPayPal([
      { method: "GET", path: "/busy", status: 429, body: { name: "RATE_LIMIT_REACHED" } },
      { method: "GET", path: "/down", status: 503, body: "<html>Service Unavailable</html>" },
    ]);
    const t = createTransport(CONFIG);
    await expect(t.request({ method: "GET", path: "/busy" })).rejects.toMatchObject({ retryable: true, status: 429 });
    await expect(t.request({ method: "GET", path: "/down" })).rejects.toMatchObject({ retryable: true, status: 503 });
  });

  it("marks network failures as retryable with status 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const t = createTransport(CONFIG);
    await expect(t.request({ method: "GET", path: "/a" })).rejects.toMatchObject({
      name: "NETWORK_ERROR",
      status: 0,
      retryable: true,
    });
  });

  it("returns undefined for 204", async () => {
    mockPayPal([{ method: "POST", path: "/void", status: 204 }]);
    const t = createTransport(CONFIG);
    await expect(t.request({ method: "POST", path: "/void" })).resolves.toBeUndefined();
  });

  it("builds an unsigned auth assertion", () => {
    const [header, payload, signature] = authAssertion("client-id", "SELLER1").split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({ alg: "none" });
    expect(JSON.parse(Buffer.from(payload!, "base64url").toString())).toEqual({ iss: "client-id", payer_id: "SELLER1" });
    expect(signature).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @tranche/paypal exec vitest run src/http.test.ts`
Expected: FAIL with "Failed to resolve import ./errors".

- [ ] **Step 3: Write the transport**

`packages/paypal/src/errors.ts`:

```ts
export type PayPalErrorInit = {
  status: number;
  name: string;
  message: string;
  issue: string | null;
  debugId: string | null;
  retryable: boolean;
};

export class PayPalError extends Error {
  readonly status: number;
  readonly issue: string | null;
  readonly debugId: string | null;
  readonly retryable: boolean;

  constructor(init: PayPalErrorInit) {
    super(init.message);
    this.name = init.name;
    this.status = init.status;
    this.issue = init.issue;
    this.debugId = init.debugId;
    this.retryable = init.retryable;
  }
}

type ErrorBody = {
  name?: string;
  message?: string;
  debug_id?: string;
  details?: Array<{ issue?: string; description?: string }>;
  error?: string;
  error_description?: string;
};

export function errorFromResponse(status: number, body: unknown, headerDebugId: string | null): PayPalError {
  const b = (body && typeof body === "object" ? body : {}) as ErrorBody;
  return new PayPalError({
    status,
    name: b.name ?? b.error ?? `HTTP_${status}`,
    message: b.details?.[0]?.description ?? b.message ?? b.error_description ?? `PayPal returned ${status}`,
    issue: b.details?.[0]?.issue ?? b.error ?? null,
    debugId: b.debug_id ?? headerDebugId,
    retryable: status === 429 || status >= 500,
  });
}

export function networkError(cause: unknown): PayPalError {
  const err = new PayPalError({
    status: 0,
    name: "NETWORK_ERROR",
    message: cause instanceof Error ? cause.message : String(cause),
    issue: null,
    debugId: null,
    retryable: true,
  });
  err.cause = cause;
  return err;
}
```

`packages/paypal/src/http.ts`:

```ts
import { errorFromResponse, networkError } from "./errors";

export type PayPalConfig = {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  partnerAttributionId?: string | undefined;
  partnerMerchantId?: string | undefined;
};

export type RequestOptions = {
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
  const enc = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
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
    let body: BodyInit | null = null;
    if (opts.form) {
      body = opts.form;
    } else if (opts.rawJson !== undefined || opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = opts.rawJson ?? JSON.stringify(opts.body);
    }
    if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;
    if (opts.prefer) headers.Prefer = opts.prefer;
    if (opts.authAssertionFor) headers["PayPal-Auth-Assertion"] = authAssertion(config.clientId, opts.authAssertionFor);
    if (config.partnerAttributionId) headers["PayPal-Partner-Attribution-Id"] = config.partnerAttributionId;

    const qs = opts.query ? `?${new URLSearchParams(opts.query)}` : "";
    const res = await send(`${config.baseUrl}${opts.path}${qs}`, { method: opts.method, headers, body });

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @tranche/paypal exec vitest run src/http.test.ts && pnpm --filter @tranche/paypal typecheck`
Expected: PASS, 9 tests, 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/paypal pnpm-lock.yaml
git commit -m "feat(paypal): Add fetch transport with token cache and PayPalError"
```

---

### Task 2: Seller onboarding methods

**Files:**
- Create: `packages/paypal/src/client.ts`
- Test: `packages/paypal/src/onboarding.test.ts`

**Interfaces:**
- Consumes: `createTransport`, `PayPalConfig`, `PayPalError` (Task 1).
- Produces: `createPayPalClient(config: PayPalConfig)` returning an object with `transport`, `createSellerReferral({ trackingId, returnUrl }): Promise<{ actionUrl: string }>` and `getSellerStatus({ trackingId }): Promise<{ merchantId: string | null; paymentsReceivable: boolean; primaryEmailConfirmed: boolean }>`; `type PayPal = ReturnType<typeof createPayPalClient>`. Task 3 and Task 4 add the remaining methods to this same object.

- [ ] **Step 1: Write the failing tests**

`packages/paypal/src/onboarding.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPayPalClient } from "./client";
import { BASE_URL, CONFIG, mockPayPal } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

describe("seller onboarding", () => {
  it("creates a partner referral and returns the action url", async () => {
    const m = mockPayPal([
      {
        method: "POST",
        path: "/v2/customer/partner-referrals",
        status: 201,
        body: {
          links: [
            { href: `${BASE_URL}/v2/customer/partner-referrals/ZjcyODU4`, rel: "self", method: "GET" },
            { href: "https://www.sandbox.paypal.com/bizsignup/partner/entry?referralToken=abc", rel: "action_url", method: "GET" },
          ],
        },
      },
    ]);
    const paypal = createPayPalClient(CONFIG);
    const { actionUrl } = await paypal.createSellerReferral({
      trackingId: "ws-1",
      returnUrl: "https://app.test/api/paypal/onboarding/return",
    });
    expect(actionUrl).toBe("https://www.sandbox.paypal.com/bizsignup/partner/entry?referralToken=abc");
    const body = JSON.parse(m.calls[0]!.body!);
    expect(body.tracking_id).toBe("ws-1");
    expect(body.partner_config_override.return_url).toBe("https://app.test/api/paypal/onboarding/return");
    expect(body.operations[0].api_integration_preference.rest_api_integration.third_party_details.features).toEqual(
      expect.arrayContaining(["PAYMENT", "REFUND", "PARTNER_FEE", "DELAY_FUNDS_DISBURSEMENT", "VAULT"]),
    );
  });

  it("reports an unknown seller when PayPal has no integration yet", async () => {
    mockPayPal([
      {
        method: "GET",
        path: "/v1/customer/partners/PARTNER123/merchant-integrations",
        status: 404,
        body: { name: "RESOURCE_NOT_FOUND", details: [{ issue: "INVALID_RESOURCE_ID" }] },
      },
    ]);
    const paypal = createPayPalClient(CONFIG);
    await expect(paypal.getSellerStatus({ trackingId: "ws-1" })).resolves.toEqual({
      merchantId: null,
      paymentsReceivable: false,
      primaryEmailConfirmed: false,
    });
  });

  it("reads the seller status by tracking id", async () => {
    const m = mockPayPal([
      {
        method: "GET",
        path: "/v1/customer/partners/PARTNER123/merchant-integrations",
        body: { merchant_id: "7XG9XQ5ZK4N6Q", tracking_id: "ws-1" },
      },
      {
        method: "GET",
        path: "/v1/customer/partners/PARTNER123/merchant-integrations/7XG9XQ5ZK4N6Q",
        body: { merchant_id: "7XG9XQ5ZK4N6Q", tracking_id: "ws-1", payments_receivable: true, primary_email_confirmed: false },
      },
    ]);
    const paypal = createPayPalClient(CONFIG);
    await expect(paypal.getSellerStatus({ trackingId: "ws-1" })).resolves.toEqual({
      merchantId: "7XG9XQ5ZK4N6Q",
      paymentsReceivable: true,
      primaryEmailConfirmed: false,
    });
    expect(m.calls[0]!.url.searchParams.get("tracking_id")).toBe("ws-1");
  });

  it("requires the partner merchant id for status checks", async () => {
    const paypal = createPayPalClient({ ...CONFIG, partnerMerchantId: undefined });
    await expect(paypal.getSellerStatus({ trackingId: "ws-1" })).rejects.toThrow("PAYPAL_PARTNER_MERCHANT_ID");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @tranche/paypal exec vitest run src/onboarding.test.ts`
Expected: FAIL with "Failed to resolve import ./client".

- [ ] **Step 3: Write the onboarding half of the client**

`packages/paypal/src/client.ts`:

```ts
import { PayPalError } from "./errors";
import { createTransport, type PayPalConfig } from "./http";

type Link = { href: string; rel: string };

const seg = encodeURIComponent;

const REFERRAL_FEATURES = [
  "PAYMENT",
  "REFUND",
  "PARTNER_FEE",
  "DELAY_FUNDS_DISBURSEMENT",
  "VAULT",
  "ACCESS_MERCHANT_INFORMATION",
];

export function createPayPalClient(config: PayPalConfig) {
  const t = createTransport(config);

  return {
    transport: t,

    async createSellerReferral(input: { trackingId: string; returnUrl: string }): Promise<{ actionUrl: string }> {
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
      if (!partnerId) throw new Error("PAYPAL_PARTNER_MERCHANT_ID is required to read seller status");
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
      const status = await t.request<{ payments_receivable?: boolean; primary_email_confirmed?: boolean }>({
        method: "GET",
        path: `/v1/customer/partners/${seg(partnerId)}/merchant-integrations/${seg(found.merchant_id)}`,
      });
      return {
        merchantId: found.merchant_id,
        paymentsReceivable: status.payments_receivable === true,
        primaryEmailConfirmed: status.primary_email_confirmed === true,
      };
    },
  };
}

export type PayPal = ReturnType<typeof createPayPalClient>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @tranche/paypal exec vitest run src/onboarding.test.ts && pnpm --filter @tranche/paypal typecheck`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/paypal/src/client.ts packages/paypal/src/onboarding.test.ts
git commit -m "feat(paypal): Add seller referral and seller status"
```

---

### Task 3: Funding orders and holds

**Files:**
- Modify: `packages/paypal/src/client.ts`
- Create: `packages/paypal/src/fees.ts`
- Test: `packages/paypal/src/holds.test.ts`, `packages/paypal/src/fees.test.ts`

**Interfaces:**
- Consumes: `Money`, `HoldMechanism`, `toPayPalValue` from `@tranche/contracts`; transport (Task 1).
- Produces, all on the `PayPal` object:
  - `getOrder(orderId: string): Promise<OrderRes>`, `getCapture(captureId: string): Promise<CaptureRes>`, `getAuthorization(authorizationId: string): Promise<AuthorizationRes>`.
  - `createFundingOrder({ requestId, mechanism, amount, platformFee, payeeMerchantId, milestoneId, vaultId, returnUrl, cancelUrl }): Promise<{ orderId: string; approveUrl: string | null; status: string }>`; `approveUrl` is `null` when a vaulted order needs no buyer action.
  - `placeHold({ requestId, orderId, mechanism }): Promise<Hold>` with `type Hold = { captureId: string | null; authorizationId: string | null; expiresAt: string; honorExpiresAt: string | null; vaultId: string | null }`.
  - `renewHold({ requestId, authorizationId, amount, payeeMerchantId? }): Promise<{ authorizationId: string; expiresAt: string; honorExpiresAt: string }>`.
  - `releaseHold({ requestId, mechanism, captureId, authorizationId, amount, platformFee?, payeeMerchantId? }): Promise<{ releaseRef: string }>`.
  - `voidHold({ requestId, mechanism, authorizationId, captureId, platformFee?, payeeMerchantId? }): Promise<void>`.
  - Free functions `holdFromOrder(order, mechanism): Hold | null` and `approveUrlOf(order): string | null`.
  - `platformFeeFor(amount: Money): Money` and `PLATFORM_FEE_BPS = 250` from `fees.ts`.

Hold semantics the H3 and H4 plans rely on:
- `expiresAt` is the last safe moment to release or void; for `authorization` reauthorizing does not move it (PayPal caps every authorization at 29 days from the original), so H4 re-funds through the vault before it.
- `honorExpiresAt` is when an authorization stops guaranteeing funds; H4 calls `renewHold` after it (PayPal accepts reauthorization from day 4 to day 29) when release is still ahead.
- `releaseHold` with `delayed_disbursement` always releases the full captured amount.
- Missing ids throw a plain `Error` (a programming bug, never retried); every PayPal failure throws `PayPalError`.

- [ ] **Step 1: Write the failing tests**

`packages/paypal/src/fees.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { platformFeeFor } from "./fees";

describe("platformFeeFor", () => {
  it("takes 2.5% rounded down to the minor unit", () => {
    expect(platformFeeFor({ currency: "USD", minor: 100000 })).toEqual({ currency: "USD", minor: 2500 });
    expect(platformFeeFor({ currency: "USD", minor: 99 })).toEqual({ currency: "USD", minor: 2 });
    expect(platformFeeFor({ currency: "JPY", minor: 1000 })).toEqual({ currency: "JPY", minor: 25 });
    expect(platformFeeFor({ currency: "USD", minor: 0 })).toEqual({ currency: "USD", minor: 0 });
  });
});
```

`packages/paypal/src/holds.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPayPalClient } from "./client";
import {
  CONFIG,
  mockPayPal,
  ORDER_APPROVED,
  ORDER_AUTHORIZED,
  ORDER_CAPTURED,
  ORDER_PAYER_ACTION,
  REAUTHORIZED,
} from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

const usd = (minor: number) => ({ currency: "USD", minor });
const ORDER_PATH = "/v2/checkout/orders/5O190127TN364715T";

const fundingInput = {
  requestId: "fund-m1-0",
  amount: usd(100000),
  platformFee: usd(2500),
  payeeMerchantId: "SELLER1",
  milestoneId: "m1",
  returnUrl: "https://app.test/portal/tok?funded=m1",
  cancelUrl: "https://app.test/portal/tok",
};

describe("createFundingOrder", () => {
  it("creates a first funding order that vaults on success", async () => {
    const m = mockPayPal([{ method: "POST", path: "/v2/checkout/orders", status: 201, body: ORDER_PAYER_ACTION }]);
    const paypal = createPayPalClient(CONFIG);
    const res = await paypal.createFundingOrder({ ...fundingInput, mechanism: "authorization", vaultId: null });
    expect(res).toEqual({
      orderId: "5O190127TN364715T",
      approveUrl: "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T",
      status: "PAYER_ACTION_REQUIRED",
    });
    const call = m.calls[0]!;
    expect(call.headers.get("paypal-request-id")).toBe("fund-m1-0");
    const body = JSON.parse(call.body!);
    expect(body.intent).toBe("AUTHORIZE");
    const unit = body.purchase_units[0];
    expect(unit.amount).toEqual({ currency_code: "USD", value: "1000.00" });
    expect(unit.payee).toEqual({ merchant_id: "SELLER1" });
    expect(unit.reference_id).toBe("m1");
    expect(unit.payment_instruction.platform_fees).toEqual([{ amount: { currency_code: "USD", value: "25.00" } }]);
    expect(unit.payment_instruction.disbursement_mode).toBeUndefined();
    expect(body.payment_source.paypal.attributes.vault.store_in_vault).toBe("ON_SUCCESS");
    expect(body.payment_source.paypal.experience_context.return_url).toBe(fundingInput.returnUrl);
  });

  it("creates a delayed disbursement capture order from a vaulted payment method", async () => {
    const m = mockPayPal([{ method: "POST", path: "/v2/checkout/orders", status: 201, body: ORDER_CAPTURED }]);
    const paypal = createPayPalClient(CONFIG);
    const res = await paypal.createFundingOrder({ ...fundingInput, mechanism: "delayed_disbursement", vaultId: "8kk8451t" });
    expect(res.approveUrl).toBeNull();
    expect(res.status).toBe("COMPLETED");
    const body = JSON.parse(m.calls[0]!.body!);
    expect(body.intent).toBe("CAPTURE");
    expect(body.purchase_units[0].payment_instruction.disbursement_mode).toBe("DELAYED");
    expect(body.payment_source).toEqual({ paypal: { vault_id: "8kk8451t" } });
  });
});

describe("placeHold", () => {
  it("captures an approved delayed disbursement order", async () => {
    const m = mockPayPal([
      { method: "GET", path: ORDER_PATH, body: ORDER_APPROVED },
      { method: "POST", path: `${ORDER_PATH}/capture`, status: 201, body: ORDER_CAPTURED },
    ]);
    const paypal = createPayPalClient(CONFIG);
    const hold = await paypal.placeHold({ requestId: "place-hold-h1", orderId: "5O190127TN364715T", mechanism: "delayed_disbursement" });
    expect(hold).toEqual({
      captureId: "3C679366HH908993F",
      authorizationId: null,
      expiresAt: "2026-11-06T10:00:00.000Z",
      honorExpiresAt: null,
      vaultId: "8kk8451t",
    });
    expect(m.calls[1]!.headers.get("paypal-request-id")).toBe("place-hold-h1");
  });

  it("does not capture an order that is already captured", async () => {
    const m = mockPayPal([{ method: "GET", path: ORDER_PATH, body: ORDER_CAPTURED }]);
    const paypal = createPayPalClient(CONFIG);
    const hold = await paypal.placeHold({ requestId: "place-hold-h1", orderId: "5O190127TN364715T", mechanism: "delayed_disbursement" });
    expect(hold.captureId).toBe("3C679366HH908993F");
    expect(m.calls).toHaveLength(1);
  });

  it("authorizes an approved order and reports both deadlines", async () => {
    mockPayPal([
      { method: "GET", path: ORDER_PATH, body: ORDER_APPROVED },
      { method: "POST", path: `${ORDER_PATH}/authorize`, status: 201, body: ORDER_AUTHORIZED },
    ]);
    const paypal = createPayPalClient(CONFIG);
    const hold = await paypal.placeHold({ requestId: "place-hold-h1", orderId: "5O190127TN364715T", mechanism: "authorization" });
    expect(hold).toEqual({
      captureId: null,
      authorizationId: "0VF52814937998046",
      expiresAt: "2026-11-07T10:00:00.000Z",
      honorExpiresAt: "2026-10-13T10:00:00.000Z",
      vaultId: null,
    });
  });

  it("refuses an order the buyer has not approved", async () => {
    mockPayPal([{ method: "GET", path: ORDER_PATH, body: ORDER_PAYER_ACTION }]);
    const paypal = createPayPalClient(CONFIG);
    await expect(
      paypal.placeHold({ requestId: "r", orderId: "5O190127TN364715T", mechanism: "authorization" }),
    ).rejects.toMatchObject({ name: "ORDER_NOT_APPROVED", retryable: false });
  });

  it("rejects a declined capture", async () => {
    const declined = structuredClone(ORDER_CAPTURED);
    declined.purchase_units[0]!.payments.captures[0]!.status = "DECLINED";
    mockPayPal([{ method: "GET", path: ORDER_PATH, body: declined }]);
    const paypal = createPayPalClient(CONFIG);
    await expect(
      paypal.placeHold({ requestId: "r", orderId: "5O190127TN364715T", mechanism: "delayed_disbursement" }),
    ).rejects.toMatchObject({ name: "HOLD_DECLINED", issue: "CAPTURE_DECLINED", retryable: false });
  });
});

describe("renew, release and void", () => {
  it("reauthorizes with the seller assertion", async () => {
    const m = mockPayPal([
      { method: "POST", path: "/v2/payments/authorizations/0VF52814937998046/reauthorize", status: 201, body: REAUTHORIZED },
    ]);
    const paypal = createPayPalClient(CONFIG);
    const res = await paypal.renewHold({
      requestId: "renew-h1-1",
      authorizationId: "0VF52814937998046",
      amount: usd(100000),
      payeeMerchantId: "SELLER1",
    });
    expect(res).toEqual({
      authorizationId: "8AA831015G517922L",
      expiresAt: "2026-11-07T10:00:00.000Z",
      honorExpiresAt: "2026-10-18T10:00:00.000Z",
    });
    expect(JSON.parse(m.calls[0]!.body!)).toEqual({ amount: { currency_code: "USD", value: "1000.00" } });
    expect(m.calls[0]!.headers.get("paypal-auth-assertion")).not.toBeNull();
  });

  it("releases a delayed disbursement with a referenced payout", async () => {
    const m = mockPayPal([
      {
        method: "POST",
        path: "/v1/payments/referenced-payouts-items",
        body: { item_id: "6RQZ7V4YSQZQS", processing_state: { status: "PENDING" }, reference_id: "3C679366HH908993F" },
      },
    ]);
    const paypal = createPayPalClient(CONFIG);
    const res = await paypal.releaseHold({
      requestId: "release-h1",
      mechanism: "delayed_disbursement",
      captureId: "3C679366HH908993F",
      authorizationId: null,
      amount: usd(100000),
    });
    expect(res).toEqual({ releaseRef: "6RQZ7V4YSQZQS" });
    expect(JSON.parse(m.calls[0]!.body!)).toEqual({ reference_id: "3C679366HH908993F", reference_type: "TRANSACTION_ID" });
    expect(m.calls[0]!.headers.get("paypal-request-id")).toBe("release-h1");
  });

  it("releases an authorization by capturing it with the platform fee", async () => {
    const m = mockPayPal([
      {
        method: "POST",
        path: "/v2/payments/authorizations/0VF52814937998046/capture",
        status: 201,
        body: { id: "7TK53561YB803214S", status: "COMPLETED", create_time: "2026-10-20T10:00:00Z" },
      },
    ]);
    const paypal = createPayPalClient(CONFIG);
    const res = await paypal.releaseHold({
      requestId: "release-h1",
      mechanism: "authorization",
      captureId: null,
      authorizationId: "0VF52814937998046",
      amount: usd(100000),
      platformFee: usd(2500),
      payeeMerchantId: "SELLER1",
    });
    expect(res).toEqual({ releaseRef: "7TK53561YB803214S" });
    expect(JSON.parse(m.calls[0]!.body!)).toEqual({
      amount: { currency_code: "USD", value: "1000.00" },
      final_capture: true,
      payment_instruction: {
        disbursement_mode: "INSTANT",
        platform_fees: [{ amount: { currency_code: "USD", value: "25.00" } }],
      },
    });
  });

  it("voids an authorization", async () => {
    const m = mockPayPal([{ method: "POST", path: "/v2/payments/authorizations/0VF52814937998046/void", status: 204 }]);
    const paypal = createPayPalClient(CONFIG);
    await paypal.voidHold({ requestId: "void-h1", mechanism: "authorization", authorizationId: "0VF52814937998046", captureId: null });
    expect(m.calls[0]!.headers.get("paypal-request-id")).toBe("void-h1");
  });

  it("voids a delayed disbursement by refunding the capture and our fee", async () => {
    const m = mockPayPal([
      {
        method: "POST",
        path: "/v2/payments/captures/3C679366HH908993F/refund",
        status: 201,
        body: { id: "1JU08902781691411", status: "COMPLETED" },
      },
    ]);
    const paypal = createPayPalClient(CONFIG);
    await paypal.voidHold({
      requestId: "void-h1",
      mechanism: "delayed_disbursement",
      authorizationId: null,
      captureId: "3C679366HH908993F",
      platformFee: usd(2500),
      payeeMerchantId: "SELLER1",
    });
    expect(JSON.parse(m.calls[0]!.body!)).toEqual({
      payment_instruction: { platform_fees: [{ amount: { currency_code: "USD", value: "25.00" } }] },
    });
    expect(m.calls[0]!.headers.get("paypal-auth-assertion")).not.toBeNull();
  });

  it("throws a plain Error when the id for the mechanism is missing", async () => {
    mockPayPal([]);
    const paypal = createPayPalClient(CONFIG);
    await expect(
      paypal.releaseHold({ requestId: "r", mechanism: "authorization", captureId: null, authorizationId: null, amount: usd(1) }),
    ).rejects.toThrow("authorizationId is required");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @tranche/paypal exec vitest run src/holds.test.ts src/fees.test.ts`
Expected: FAIL with "paypal.createFundingOrder is not a function" and "Failed to resolve import ./fees".

- [ ] **Step 3: Write fees and the hold methods**

`packages/paypal/src/fees.ts`:

```ts
import type { Money } from "@tranche/contracts";

export const PLATFORM_FEE_BPS = 250;

export function platformFeeFor(amount: Money): Money {
  return { currency: amount.currency, minor: Math.floor((amount.minor * PLATFORM_FEE_BPS) / 10_000) };
}
```

In `packages/paypal/src/client.ts`, add these imports and helpers above `createPayPalClient`:

```ts
import { type HoldMechanism, type Money, toPayPalValue } from "@tranche/contracts";

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

const DAY_MS = 86_400_000;
const DELAYED_SAFE_DAYS = 27;
const HONOR_DAYS = 3;

const amountOf = (m: Money): Amount => ({ currency_code: m.currency, value: toPayPalValue(m) });
const addDays = (iso: string, days: number) => new Date(Date.parse(iso) + days * DAY_MS).toISOString();
const fees = (fee: Money | undefined) => (fee ? { platform_fees: [{ amount: amountOf(fee) }] } : {});

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
```

Inside the object returned by `createPayPalClient`, add after `getSellerStatus`:

```ts
    getOrder(orderId: string): Promise<OrderRes> {
      return t.request<OrderRes>({ method: "GET", path: `/v2/checkout/orders/${seg(orderId)}` });
    },

    getCapture(captureId: string): Promise<CaptureRes> {
      return t.request<CaptureRes>({ method: "GET", path: `/v2/payments/captures/${seg(captureId)}` });
    },

    getAuthorization(authorizationId: string): Promise<AuthorizationRes> {
      return t.request<AuthorizationRes>({ method: "GET", path: `/v2/payments/authorizations/${seg(authorizationId)}` });
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
            attributes: { vault: { store_in_vault: "ON_SUCCESS", usage_type: "MERCHANT", customer_type: "CONSUMER" } },
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
                ...(input.mechanism === "delayed_disbursement" ? { disbursement_mode: "DELAYED" } : {}),
              },
            },
          ],
          payment_source: { paypal: paypalSource },
        },
      });
      return { orderId: order.id, approveUrl: approveUrlOf(order), status: order.status };
    },

    async placeHold(input: { requestId: string; orderId: string; mechanism: HoldMechanism }): Promise<Hold> {
      const existing = await t.request<OrderRes>({ method: "GET", path: `/v2/checkout/orders/${seg(input.orderId)}` });
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
          body: { reference_id: required(input.captureId, "captureId"), reference_type: "TRANSACTION_ID" },
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @tranche/paypal exec vitest run src/holds.test.ts src/fees.test.ts && pnpm --filter @tranche/paypal typecheck`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/paypal/src
git commit -m "feat(paypal): Add funding orders and holds for both mechanisms"
```

---

### Task 4: Payouts, webhook verification, disputes and the outbox dispatcher

**Files:**
- Modify: `packages/paypal/src/client.ts`
- Create: `packages/paypal/src/outbox.ts`, `packages/paypal/src/webhook-events.ts`, `packages/paypal/src/index.ts` (replace)
- Test: `packages/paypal/src/payouts-webhooks.test.ts`, `packages/paypal/src/outbox.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 3.
- Produces:
  - `sendPayouts({ requestId, items: Array<{ email: string; amount: Money; note: string }> }): Promise<{ batchId: string }>`; `sender_batch_id` equals `requestId`.
  - `verifyWebhook({ headers: Record<string, string>, rawBody: string, webhookId: string }): Promise<boolean>`; header keys are lowercase (as produced by `Object.fromEntries(request.headers)`); returns `false` without calling PayPal when a signature header is missing or the body is not JSON.
  - `submitDisputeEvidence({ requestId, disputeId, notes, documents?, payeeMerchantId? }): Promise<void>` with `documents?: Array<{ name: string; contentType: string; data: Uint8Array<ArrayBuffer> }>`.
  - `PAYPAL_OUTBOX_KINDS`, `type PayPalOutboxKind`, `runPayPalOutbox(paypal: PayPal, kind: PayPalOutboxKind, request: Record<string, unknown>): Promise<Record<string, unknown>>`.
  - `PAYPAL_WEBHOOK_EVENTS` (readonly string tuple).

Outbox contract with H3:
- `outbox.kind` is one of `PAYPAL_OUTBOX_KINDS`; `outbox.request` is the method input as JSON plus optional bookkeeping fields (for example `holdId`) that the method ignores; `outbox.requestId` equals `request.requestId`.
- Kind to method: `paypal.create_order` -> `createFundingOrder`, `paypal.place_hold` -> `placeHold`, `paypal.renew_hold` -> `renewHold`, `paypal.release_hold` -> `releaseHold`, `paypal.void_hold` -> `voidHold`, `paypal.send_payouts` -> `sendPayouts`, `paypal.submit_dispute_evidence` -> `submitDisputeEvidence`.
- Retry when the thrown error is a `PayPalError` with `retryable: true`; any other error is terminal.
- Request id conventions (deterministic, so retries reuse them): `fund-<milestoneId>-<attempt>`, `place-hold-<holdId>`, `renew-<holdId>-<n>`, `release-<holdId>`, `void-<holdId>`, `payout-<payoutId>`, `dispute-<disputeId>-<n>`.

- [ ] **Step 1: Write the failing tests**

`packages/paypal/src/payouts-webhooks.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPayPalClient } from "./client";
import { CONFIG, mockPayPal } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

const SIGNATURE_HEADERS = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42",
  "paypal-transmission-id": "69cd13f0-d67a-11e5-baa3-778b53f4ae55",
  "paypal-transmission-sig": "lmI95Jx3Y9nhR5SJWlHVIWpg4AgFk7n9bCHSRxbrd8A9zrhdu2rMyFrmz+Zjh3s3boXB07VXCXUZy/UFzUlnGJn0wDugt7FlSvdKeIJenLRemUxYCPVoEZzg9VFNqOa48gMkvF+XTpxBeUx/kWy6B5cp7GkT2+pOowfRK7OaynuxUoKW3JcMWw272VKjLTtTAShncla7tGF+55rxyt2KNZIIqxNMJ48RDZheGU5w1npu9dZHnPgTXB9iomeVRoD8O/jhRpnKsGrDschyNdkeh81BJJMH4Ctc6lnCCquoP/GzCzz33MMsNdid7vL/NIWaCsekQpW26FpWPi/tfj8nLA==",
  "paypal-transmission-time": "2026-10-10T10:00:00Z",
};

describe("sendPayouts", () => {
  it("uses the request id as the sender batch id", async () => {
    const m = mockPayPal([
      {
        method: "POST",
        path: "/v1/payments/payouts",
        status: 201,
        body: { batch_header: { payout_batch_id: "5UXD2E8A7EBQJ", batch_status: "PENDING" } },
      },
    ]);
    const paypal = createPayPalClient(CONFIG);
    const res = await paypal.sendPayouts({
      requestId: "payout-p1",
      items: [{ email: "dev@example.com", amount: { currency: "USD", minor: 30000 }, note: "Milestone: Build" }],
    });
    expect(res).toEqual({ batchId: "5UXD2E8A7EBQJ" });
    const body = JSON.parse(m.calls[0]!.body!);
    expect(body.sender_batch_header.sender_batch_id).toBe("payout-p1");
    expect(body.items[0]).toEqual({
      recipient_type: "EMAIL",
      receiver: "dev@example.com",
      note: "Milestone: Build",
      sender_item_id: "payout-p1-0",
      amount: { value: "300.00", currency: "USD" },
    });
  });
});

describe("verifyWebhook", () => {
  it("sends the raw webhook body verbatim", async () => {
    const rawBody = '{"id": "WH-1",   "event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"amount":{"value":"10.00"}}}';
    const m = mockPayPal([
      { method: "POST", path: "/v1/notifications/verify-webhook-signature", body: { verification_status: "SUCCESS" } },
    ]);
    const paypal = createPayPalClient(CONFIG);
    await expect(paypal.verifyWebhook({ headers: SIGNATURE_HEADERS, rawBody, webhookId: "WH-ID" })).resolves.toBe(true);
    const sent = m.calls[0]!.body!;
    expect(sent.endsWith(`"webhook_event":${rawBody}}`)).toBe(true);
    expect(JSON.parse(sent)).toMatchObject({ webhook_id: "WH-ID", auth_algo: "SHA256withRSA" });
  });

  it("returns false on FAILURE", async () => {
    mockPayPal([
      { method: "POST", path: "/v1/notifications/verify-webhook-signature", body: { verification_status: "FAILURE" } },
    ]);
    const paypal = createPayPalClient(CONFIG);
    await expect(
      paypal.verifyWebhook({ headers: SIGNATURE_HEADERS, rawBody: '{"id":"WH-1"}', webhookId: "WH-ID" }),
    ).resolves.toBe(false);
  });

  it("returns false without calling PayPal when a header is missing or the body is not JSON", async () => {
    const m = mockPayPal([]);
    const paypal = createPayPalClient(CONFIG);
    const { "paypal-transmission-sig": _, ...missing } = SIGNATURE_HEADERS;
    await expect(paypal.verifyWebhook({ headers: missing, rawBody: '{"id":"WH-1"}', webhookId: "WH-ID" })).resolves.toBe(false);
    await expect(paypal.verifyWebhook({ headers: SIGNATURE_HEADERS, rawBody: "not json", webhookId: "WH-ID" })).resolves.toBe(false);
    expect(m.calls).toHaveLength(0);
  });
});

describe("submitDisputeEvidence", () => {
  it("posts multipart evidence with the seller assertion", async () => {
    const m = mockPayPal([{ method: "POST", path: "/v1/customer/disputes/PP-D-27803/provide-evidence", body: { links: [] } }]);
    const paypal = createPayPalClient(CONFIG);
    await paypal.submitDisputeEvidence({
      requestId: "dispute-PP-D-27803-1",
      disputeId: "PP-D-27803",
      notes: "Delivered and verified on 2026-10-20; see evidence report.",
      payeeMerchantId: "SELLER1",
      documents: [{ name: "evidence.json", contentType: "application/json", data: new TextEncoder().encode("{}") }],
    });
    expect(m.calls[0]!.body).toBe("[form]");
    expect(m.calls[0]!.headers.get("paypal-auth-assertion")).not.toBeNull();
    expect(m.calls[0]!.headers.get("content-type")).toBeNull();
  });
});
```

`packages/paypal/src/outbox.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { PayPal } from "./client";
import { PAYPAL_OUTBOX_KINDS, runPayPalOutbox } from "./outbox";

describe("runPayPalOutbox", () => {
  it("dispatches each kind to its method and passes the request through", async () => {
    const fake = {
      createFundingOrder: vi.fn(async () => ({ orderId: "O", approveUrl: null, status: "COMPLETED" })),
      placeHold: vi.fn(async () => ({ captureId: "C", authorizationId: null, expiresAt: "x", honorExpiresAt: null, vaultId: null })),
      renewHold: vi.fn(async () => ({ authorizationId: "A2", expiresAt: "x", honorExpiresAt: "y" })),
      releaseHold: vi.fn(async () => ({ releaseRef: "R" })),
      voidHold: vi.fn(async () => undefined),
      sendPayouts: vi.fn(async () => ({ batchId: "B" })),
      submitDisputeEvidence: vi.fn(async () => undefined),
    } as unknown as PayPal;

    const request = { requestId: "place-hold-h1", orderId: "O", mechanism: "authorization", holdId: "h1" };
    await expect(runPayPalOutbox(fake, "paypal.place_hold", request)).resolves.toMatchObject({ captureId: "C" });
    expect(fake.placeHold).toHaveBeenCalledWith(request);
    await expect(runPayPalOutbox(fake, "paypal.void_hold", { requestId: "void-h1" })).resolves.toEqual({});

    for (const kind of PAYPAL_OUTBOX_KINDS) {
      await expect(runPayPalOutbox(fake, kind, { requestId: "r" })).resolves.toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @tranche/paypal exec vitest run src/payouts-webhooks.test.ts src/outbox.test.ts`
Expected: FAIL with "paypal.sendPayouts is not a function" and "Failed to resolve import ./outbox".

- [ ] **Step 3: Write the methods, dispatcher and exports**

Inside the object returned by `createPayPalClient`, add after `voidHold`:

```ts
    async sendPayouts(input: {
      requestId: string;
      items: Array<{ email: string; amount: Money; note: string }>;
    }): Promise<{ batchId: string }> {
      const res = await t.request<{ batch_header: { payout_batch_id: string } }>({
        method: "POST",
        path: "/v1/payments/payouts",
        requestId: input.requestId,
        body: {
          sender_batch_header: { sender_batch_id: input.requestId, email_subject: "You have a payment from Tranche" },
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

    async verifyWebhook(input: { headers: Record<string, string>; rawBody: string; webhookId: string }): Promise<boolean> {
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
      documents?: Array<{ name: string; contentType: string; data: Uint8Array<ArrayBuffer> }> | undefined;
      payeeMerchantId?: string | undefined;
    }): Promise<void> {
      const form = new FormData();
      form.append(
        "input",
        new Blob([JSON.stringify({ evidences: [{ evidence_type: "PROOF_OF_FULFILLMENT", notes: input.notes }] })], {
          type: "application/json",
        }),
      );
      for (const d of input.documents ?? []) form.append("evidence-file", new Blob([d.data], { type: d.contentType }), d.name);
      await t.request<unknown>({
        method: "POST",
        path: `/v1/customer/disputes/${seg(input.disputeId)}/provide-evidence`,
        requestId: input.requestId,
        authAssertionFor: input.payeeMerchantId,
        form,
      });
    },
```

`packages/paypal/src/outbox.ts`:

```ts
import type { PayPal } from "./client";

export const PAYPAL_OUTBOX_KINDS = [
  "paypal.create_order",
  "paypal.place_hold",
  "paypal.renew_hold",
  "paypal.release_hold",
  "paypal.void_hold",
  "paypal.send_payouts",
  "paypal.submit_dispute_evidence",
] as const;
export type PayPalOutboxKind = (typeof PAYPAL_OUTBOX_KINDS)[number];

type Input<K extends keyof PayPal> = PayPal[K] extends (input: infer I) => unknown ? I : never;

export async function runPayPalOutbox(
  paypal: PayPal,
  kind: PayPalOutboxKind,
  request: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (kind) {
    case "paypal.create_order":
      return paypal.createFundingOrder(request as Input<"createFundingOrder">);
    case "paypal.place_hold":
      return paypal.placeHold(request as Input<"placeHold">);
    case "paypal.renew_hold":
      return paypal.renewHold(request as Input<"renewHold">);
    case "paypal.release_hold":
      return paypal.releaseHold(request as Input<"releaseHold">);
    case "paypal.void_hold":
      await paypal.voidHold(request as Input<"voidHold">);
      return {};
    case "paypal.send_payouts":
      return paypal.sendPayouts(request as Input<"sendPayouts">);
    case "paypal.submit_dispute_evidence":
      await paypal.submitDisputeEvidence(request as Input<"submitDisputeEvidence">);
      return {};
  }
}
```

`packages/paypal/src/webhook-events.ts`:

```ts
export const PAYPAL_WEBHOOK_EVENTS = [
  "CHECKOUT.ORDER.APPROVED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.AUTHORIZATION.CREATED",
  "PAYMENT.AUTHORIZATION.VOIDED",
  "PAYMENT.REFERENCED-PAYOUT-ITEM.COMPLETED",
  "PAYMENT.PAYOUTSBATCH.SUCCESS",
  "CUSTOMER.DISPUTE.CREATED",
  "MERCHANT.ONBOARDING.COMPLETED",
] as const;
```

Replace `packages/paypal/src/index.ts`:

```ts
export {
  type AuthorizationRes,
  approveUrlOf,
  type CaptureRes,
  createPayPalClient,
  type Hold,
  holdFromOrder,
  type OrderRes,
  type PayPal,
} from "./client";
export { PayPalError } from "./errors";
export { PLATFORM_FEE_BPS, platformFeeFor } from "./fees";
export { authAssertion, createTransport, type PayPalConfig, type Transport } from "./http";
export { PAYPAL_OUTBOX_KINDS, type PayPalOutboxKind, runPayPalOutbox } from "./outbox";
export { PAYPAL_WEBHOOK_EVENTS } from "./webhook-events";
```

`agent-tools.ts` is deliberately not re-exported: the web app must not bundle the MCP stack, and agents import only `@tranche/paypal/agent-tools`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @tranche/paypal test && pnpm --filter @tranche/paypal typecheck && pnpm check`
Expected: PASS, all paypal unit tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/paypal/src
git commit -m "feat(paypal): Add payouts, webhook verification, disputes and outbox dispatch"
```

---

### Task 5: Read-only PayPal tools for agents

**Files:**
- Create: `packages/paypal/src/agent-tools.ts`
- Test: `packages/paypal/src/agent-tools.test.ts`

**Interfaces:**
- Consumes: `createTransport`, `PayPalConfig` (Task 1); `PayPalAgentToolkit` MCP server from `@paypal/agent-toolkit/mcp`; `createMCPClient` from `@ai-sdk/mcp`; `InMemoryTransport` from `@modelcontextprotocol/sdk/inMemory.js`.
- Produces (imported by the E lane from `@tranche/paypal/agent-tools`):
  - `readOnlyPayPalTools(config: PayPalConfig): Promise<{ tools: ToolSet; close(): Promise<void> }>`; `tools` plugs straight into the AI SDK `tools` option.
  - `READ_ONLY_TOOL_NAMES`: `get_dispute`, `get_invoice`, `get_merchant_insights`, `get_order`, `get_refund`, `get_shipment_tracking`, `list_disputes`, `list_invoices`, `list_transactions`, `search_invoicing`.

The toolkit's own `@paypal/agent-toolkit/ai-sdk` entry targets `ai@4` tool objects and is not compatible with the `ai@7` installed here.
Running the toolkit as an in-process MCP server and reading it through `@ai-sdk/mcp` is version independent, and it is the "PayPal MCP server" the spec names.
The caller must call `close()` when the agent run ends.

- [ ] **Step 1: Write the failing test**

`packages/paypal/src/agent-tools.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { READ_ONLY_TOOL_NAMES, readOnlyPayPalTools } from "./agent-tools";
import { CONFIG, mockPayPal } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

describe("readOnlyPayPalTools", () => {
  it("exposes exactly the read-only PayPal tools", async () => {
    mockPayPal([]);
    const { tools, close } = await readOnlyPayPalTools(CONFIG);
    try {
      const names = Object.keys(tools).sort();
      expect(names).toEqual([...READ_ONLY_TOOL_NAMES].sort());
      for (const name of names) expect(name).toMatch(/^(get|list|search)_/);
      for (const forbidden of ["create_order", "pay_order", "create_refund", "create_invoice", "send_invoice", "accept_dispute_claim"]) {
        expect(tools).not.toHaveProperty(forbidden);
      }
    } finally {
      await close();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tranche/paypal exec vitest run src/agent-tools.test.ts`
Expected: FAIL with "Failed to resolve import ./agent-tools".

- [ ] **Step 3: Write the tool factory**

`packages/paypal/src/agent-tools.ts`:

```ts
import { createMCPClient } from "@ai-sdk/mcp";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/mcp";
import { createTransport, type PayPalConfig } from "./http";

const READ_ONLY_ACTIONS = {
  orders: { get: true },
  disputes: { list: true, get: true },
  transactions: { list: true },
  invoices: { list: true, get: true, search: true },
  insights: { get: true },
  payments: { getRefunds: true },
  shipment: { get: true },
};

export const READ_ONLY_TOOL_NAMES = [
  "get_dispute",
  "get_invoice",
  "get_merchant_insights",
  "get_order",
  "get_refund",
  "get_shipment_tracking",
  "list_disputes",
  "list_invoices",
  "list_transactions",
  "search_invoicing",
] as const;

export async function readOnlyPayPalTools(config: PayPalConfig) {
  const accessToken = await createTransport(config).accessToken();
  const server = new PayPalAgentToolkit({
    accessToken,
    configuration: { actions: READ_ONLY_ACTIONS, context: { sandbox: config.baseUrl.includes("sandbox") } },
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const mcp = await createMCPClient({ transport: clientSide });
  const close = async () => {
    await mcp.close();
    await server.close();
  };

  const tools = await mcp.tools();
  const allowed: readonly string[] = READ_ONLY_TOOL_NAMES;
  const unexpected = Object.keys(tools).filter((name) => !allowed.includes(name));
  if (unexpected.length > 0) {
    await close();
    throw new Error(`Refusing PayPal tools that are not read-only: ${unexpected.join(", ")}`);
  }
  return { tools, close };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @tranche/paypal exec vitest run src/agent-tools.test.ts && pnpm --filter @tranche/paypal typecheck`
Expected: PASS.
If the tool list differs from `READ_ONLY_TOOL_NAMES`, print `Object.keys(tools)` and fix the action map, never the assertion: every name must still start with `get_`, `list_` or `search_`.

- [ ] **Step 5: Commit**

```bash
git add packages/paypal/src/agent-tools.ts packages/paypal/src/agent-tools.test.ts
git commit -m "feat(paypal): Expose read-only PayPal MCP tools for agents"
```

---

### Task 6: Sandbox integration suite and webhook registration

**Files:**
- Create: `packages/paypal/src/sandbox.test.ts`, `packages/paypal/scripts/register-webhook.ts`, `packages/paypal/scripts/fund-manually.ts`
- Modify: `.env.example`, `docs/sandbox-capabilities.md`

**Interfaces:**
- Consumes: the whole client (Tasks 1 to 4); env `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_BASE_URL`, `PAYPAL_HOLD_MECHANISM`, `PAYPAL_PARTNER_MERCHANT_ID`, `SANDBOX_SELLER_MERCHANT_ID`.
- Produces: `PAYPAL_WEBHOOK_ID` for `.env` (read by the H3 webhook route) and verified rows in `docs/sandbox-capabilities.md`.

- [ ] **Step 1: Add the env variables**

Append to `.env.example`:

```bash
PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com
PAYPAL_HOLD_MECHANISM=authorization
PAYPAL_PARTNER_MERCHANT_ID=
PAYPAL_PARTNER_ATTRIBUTION_ID=
SANDBOX_SELLER_MERCHANT_ID=
```

Set `PAYPAL_HOLD_MECHANISM` in your `.env` to the value recorded under "Decision" in `docs/sandbox-capabilities.md`.
`PAYPAL_PARTNER_MERCHANT_ID` is the platform sandbox business account's merchant id (Sandbox Accounts -> account -> Account ID).
`SANDBOX_SELLER_MERCHANT_ID` is the agency sandbox business account's merchant id.

- [ ] **Step 2: Write the sandbox suite**

`packages/paypal/src/sandbox.test.ts`:

```ts
import { HoldMechanism } from "@tranche/contracts";
import { describe, expect, it } from "vitest";
import { createPayPalClient } from "./client";
import { PayPalError } from "./errors";

const env = process.env;
const live = Boolean(env.PAYPAL_CLIENT_ID);
const config = {
  clientId: env.PAYPAL_CLIENT_ID ?? "",
  clientSecret: env.PAYPAL_CLIENT_SECRET ?? "",
  baseUrl: env.PAYPAL_BASE_URL ?? "https://api-m.sandbox.paypal.com",
  partnerMerchantId: env.PAYPAL_PARTNER_MERCHANT_ID,
};
const mechanism = HoldMechanism.parse(env.PAYPAL_HOLD_MECHANISM ?? "authorization");
const seller = env.SANDBOX_SELLER_MERCHANT_ID;

async function cardOrder(paypal: ReturnType<typeof createPayPalClient>, intent: "AUTHORIZE" | "CAPTURE", payee?: string) {
  return paypal.transport.request<{ id: string; status: string }>({
    method: "POST",
    path: "/v2/checkout/orders",
    requestId: crypto.randomUUID(),
    prefer: "return=representation",
    body: {
      intent,
      purchase_units: [
        {
          reference_id: "sandbox-test",
          amount: { currency_code: "USD", value: "25.00" },
          ...(payee
            ? {
                payee: { merchant_id: payee },
                payment_instruction: {
                  platform_fees: [{ amount: { currency_code: "USD", value: "0.63" } }],
                  ...(intent === "CAPTURE" ? { disbursement_mode: "DELAYED" } : {}),
                },
              }
            : {}),
        },
      ],
      payment_source: {
        card: { number: "4111111111111111", expiry: "2030-12", name: "Sandbox Buyer", security_code: "123" },
      },
    },
  });
}

describe.runIf(live)("PayPal sandbox", () => {
  const paypal = createPayPalClient(config);

  it("authorizes, reads the hold, and voids it", async () => {
    const order = await cardOrder(paypal, "AUTHORIZE");
    const hold = await paypal.placeHold({ requestId: crypto.randomUUID(), orderId: order.id, mechanism: "authorization" });
    expect(hold.authorizationId).toBeTruthy();
    expect(Date.parse(hold.expiresAt)).toBeGreaterThan(Date.now() + 20 * 86_400_000);
    await paypal.voidHold({
      requestId: crypto.randomUUID(),
      mechanism: "authorization",
      authorizationId: hold.authorizationId,
      captureId: null,
    });
    const auth = await paypal.getAuthorization(hold.authorizationId!);
    expect(auth.status).toBe("VOIDED");
  }, 60_000);

  it("authorizes and releases by capture, idempotently", async () => {
    const order = await cardOrder(paypal, "AUTHORIZE");
    const hold = await paypal.placeHold({ requestId: crypto.randomUUID(), orderId: order.id, mechanism: "authorization" });
    const release = { requestId: crypto.randomUUID(), mechanism: "authorization" as const, captureId: null, authorizationId: hold.authorizationId, amount: { currency: "USD", minor: 2500 } };
    const first = await paypal.releaseHold(release);
    const again = await paypal.releaseHold(release);
    expect(again.releaseRef).toBe(first.releaseRef);
  }, 60_000);

  it.runIf(Boolean(seller) && mechanism === "delayed_disbursement")(
    "captures with delayed disbursement for the seller and releases with a referenced payout",
    async () => {
      const order = await cardOrder(paypal, "CAPTURE", seller);
      const hold = await paypal.placeHold({ requestId: crypto.randomUUID(), orderId: order.id, mechanism });
      expect(hold.captureId).toBeTruthy();
      const { releaseRef } = await paypal.releaseHold({
        requestId: crypto.randomUUID(),
        mechanism,
        captureId: hold.captureId,
        authorizationId: null,
        amount: { currency: "USD", minor: 2500 },
      });
      expect(releaseRef).toBeTruthy();
    },
    60_000,
  );

  it.runIf(Boolean(seller) && mechanism === "authorization")(
    "authorizes for the seller and captures with the platform fee",
    async () => {
      const order = await cardOrder(paypal, "AUTHORIZE", seller);
      const hold = await paypal.placeHold({ requestId: crypto.randomUUID(), orderId: order.id, mechanism });
      const { releaseRef } = await paypal.releaseHold({
        requestId: crypto.randomUUID(),
        mechanism,
        captureId: null,
        authorizationId: hold.authorizationId,
        amount: { currency: "USD", minor: 2500 },
        platformFee: { currency: "USD", minor: 63 },
        payeeMerchantId: seller,
      });
      expect(releaseRef).toBeTruthy();
    },
    60_000,
  );

  it("surfaces business errors as non-retryable PayPalError", async () => {
    const err = await paypal.getOrder("DOES-NOT-EXIST-123").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err).toMatchObject({ status: 404, retryable: false });
  }, 30_000);
});
```

- [ ] **Step 3: Run the suite against the sandbox**

Run: `set -a && . ./.env && set +a && pnpm --filter @tranche/paypal exec vitest run src/sandbox.test.ts`
Expected: PASS for the two authorization tests and the error test, plus whichever seller test matches `PAYPAL_HOLD_MECHANISM` when `SANDBOX_SELLER_MERCHANT_ID` is set.
If card orders fail with `PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING` or similar, enable "Advanced Credit and Debit Card Payments" for the app in the developer dashboard and rerun.
If the seller test fails with `PERMISSION_DENIED` or `NOT_AUTHORIZED`, finish onboarding the agency sandbox account through Task 7 first, then rerun.
In CI the suite is skipped because `PAYPAL_CLIENT_ID` is not set.

- [ ] **Step 4: Write the webhook registration script**

`packages/paypal/scripts/register-webhook.ts`:

```ts
import { createTransport, PAYPAL_WEBHOOK_EVENTS } from "../src/index";

const base = process.argv[2];
if (!base?.startsWith("https://")) throw new Error("Usage: register-webhook.ts https://<tunnel-host>");

const t = createTransport({
  clientId: process.env.PAYPAL_CLIENT_ID ?? "",
  clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? "",
  baseUrl: process.env.PAYPAL_BASE_URL ?? "https://api-m.sandbox.paypal.com",
});

const { webhooks } = await t.request<{ webhooks: Array<{ id: string; url: string }> }>({
  method: "GET",
  path: "/v1/notifications/webhooks",
});
for (const w of webhooks) {
  if (w.url.endsWith("/api/webhooks/paypal")) {
    await t.request<void>({ method: "DELETE", path: `/v1/notifications/webhooks/${w.id}` });
    console.log(`deleted ${w.id} ${w.url}`);
  }
}

const created = await t.request<{ id: string }>({
  method: "POST",
  path: "/v1/notifications/webhooks",
  body: { url: `${base}/api/webhooks/paypal`, event_types: PAYPAL_WEBHOOK_EVENTS.map((name) => ({ name })) },
});
console.log(`PAYPAL_WEBHOOK_ID=${created.id}`);
```

- [ ] **Step 5: Register the sandbox webhook through a tunnel**

Run in one terminal: `pnpm dev`
Run in a second terminal: `cloudflared tunnel --url http://localhost:3000`
Expected: a line like `https://<random>.trycloudflare.com`.
Run: `pnpm tsx --env-file=.env packages/paypal/scripts/register-webhook.ts https://<random>.trycloudflare.com`
Expected: `PAYPAL_WEBHOOK_ID=<id>`; put it in `.env`.
The tunnel host changes every run, so rerun this script after every new tunnel; it deletes the previous registration first, which keeps the app under PayPal's 10 webhook limit.
If PayPal rejects an event name with `WEBHOOK_EVENT_TYPE_INVALID`, remove that one name from `PAYPAL_WEBHOOK_EVENTS`, note it in `docs/sandbox-capabilities.md`, and rerun.

- [ ] **Step 6: Write the manual buyer-approval and vault script**

`packages/paypal/scripts/fund-manually.ts`:

```ts
import { createInterface } from "node:readline/promises";
import { HoldMechanism } from "@tranche/contracts";
import { createPayPalClient, platformFeeFor } from "../src/index";

const env = process.env;
const seller = env.SANDBOX_SELLER_MERCHANT_ID;
if (!seller) throw new Error("SANDBOX_SELLER_MERCHANT_ID is not set");
const mechanism = HoldMechanism.parse(env.PAYPAL_HOLD_MECHANISM ?? "authorization");
const paypal = createPayPalClient({
  clientId: env.PAYPAL_CLIENT_ID ?? "",
  clientSecret: env.PAYPAL_CLIENT_SECRET ?? "",
  baseUrl: env.PAYPAL_BASE_URL ?? "https://api-m.sandbox.paypal.com",
});
const amount = { currency: "USD", minor: 10000 };
const base = {
  mechanism,
  amount,
  platformFee: platformFeeFor(amount),
  payeeMerchantId: seller,
  returnUrl: "https://example.com/return",
  cancelUrl: "https://example.com/cancel",
};

const first = await paypal.createFundingOrder({ ...base, requestId: crypto.randomUUID(), milestoneId: "manual-1", vaultId: null });
console.log(`Approve as the sandbox Personal account:\n${first.approveUrl}`);
await createInterface({ input: process.stdin, output: process.stdout }).question("Press Enter after approving... ");
const hold1 = await paypal.placeHold({ requestId: crypto.randomUUID(), orderId: first.orderId, mechanism });
console.log("first hold", hold1);
if (!hold1.vaultId) throw new Error("No vault id returned; record VAULT as FAILED in docs/sandbox-capabilities.md");

const second = await paypal.createFundingOrder({ ...base, requestId: crypto.randomUUID(), milestoneId: "manual-2", vaultId: hold1.vaultId });
console.log("second order (no approval expected)", second);
const hold2 = await paypal.placeHold({ requestId: crypto.randomUUID(), orderId: second.orderId, mechanism });
console.log("second hold", hold2);
process.exit(0);
```

Run: `pnpm tsx --env-file=.env packages/paypal/scripts/fund-manually.ts`
Expected: an approval URL; after approving in the browser, a first hold with a `vaultId`, then a second order with `approveUrl: null` and a second hold.
If PayPal rejects `usage_type: "MERCHANT"` for an order with a third-party payee, change it to `"PLATFORM"` in `createFundingOrder`, update the expectation in `holds.test.ts`, rerun, and record which one worked.

- [ ] **Step 7: Record the results**

Append to `docs/sandbox-capabilities.md`:

```markdown
## Money layer verification

| Check | Result |
|---|---|
| Card AUTHORIZE, placeHold, voidHold | OK / FAILED |
| Card AUTHORIZE, releaseHold twice returns the same capture | OK / FAILED |
| Seller hold and release with the chosen mechanism | OK / FAILED / skipped |
| Buyer approval, vault on success, vaulted second funding without approval | OK / FAILED |
| Vault usage_type that worked | MERCHANT / PLATFORM |
| Webhook registration with all 9 event types | OK / list of rejected names |
```

Fill in every row from Steps 3, 5 and 6.

- [ ] **Step 8: Commit**

```bash
git add packages/paypal/src/sandbox.test.ts packages/paypal/scripts .env.example docs/sandbox-capabilities.md
git commit -m "test(paypal): Add sandbox integration suite and webhook registration"
```

---

### Task 7: Connect PayPal backend

**Files:**
- Create: `apps/web/src/server/db.ts`, `apps/web/src/server/paypal.ts`, `apps/web/src/server/onboarding.ts`
- Create: `apps/web/src/app/api/paypal/onboarding/route.ts`, `apps/web/src/app/api/paypal/onboarding/return/route.ts`
- Modify: `apps/web/package.json`, `apps/web/next.config.ts`
- Test: `apps/web/src/server/onboarding.test.ts`

**Interfaces:**
- Consumes:
  - `createDb`, `migrateDb`, `schema`, `type Db` from `@tranche/db`; `createPayPalClient`, `type PayPal` from `@tranche/paypal`.
  - `requireWorkspaceId(request: Request): Promise<string | null>` from `apps/web/src/server/session.ts`, produced by the H5 frontend plan's auth task; `null` means not signed in.
  - The H5 onboarding page at `/onboarding/paypal`, which reads `?status=active|pending|not_started`.
- Produces:
  - `getDb(): Db`, `getPayPal(): PayPal`, `holdMechanism(): HoldMechanism`, `appUrl(): string`.
  - `startOnboarding(db, paypal, { workspaceId, appUrl }): Promise<{ actionUrl: string }>`.
  - `completeOnboarding(db, paypal, { workspaceId }): Promise<"active" | "pending" | "not_started">`, also called by the H3 inbox processor on `MERCHANT.ONBOARDING.COMPLETED` with `workspaceId` taken from the event's `tracking_id`.
  - `POST /api/paypal/onboarding` -> `200 { actionUrl }` or `401`.
  - `GET /api/paypal/onboarding/return` -> `303` to `/onboarding/paypal?status=<status>`.

- [ ] **Step 1: Add dependencies and write the failing test**

In `apps/web/package.json` add to `dependencies`:

```json
"@tranche/db": "workspace:*",
"@tranche/paypal": "workspace:*",
"drizzle-orm": "0.45.4",
```

In `apps/web/next.config.ts` change `transpilePackages` to:

```ts
  transpilePackages: ["@tranche/contracts", "@tranche/db", "@tranche/paypal"],
```

Run: `pnpm install`

`apps/web/src/server/onboarding.test.ts`:

```ts
import { createDb, migrateDb, schema } from "@tranche/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { completeOnboarding, startOnboarding } from "./onboarding";

const url = process.env.DATABASE_URL;
const db = url ? createDb(url) : null;

async function workspace() {
  const [ws] = await db!
    .insert(schema.workspace)
    .values({ name: `Onboarding ${crypto.randomUUID()}`, rateCard: { currency: "USD", dailyRateMinor: 1, minimumProjectMinor: 0 } })
    .returning();
  return ws!;
}

const read = async (id: string) => (await db!.select().from(schema.workspace).where(eq(schema.workspace.id, id)))[0]!;

describe.runIf(Boolean(db))("onboarding", () => {
  beforeAll(async () => {
    await migrateDb(db!);
  });
  afterAll(async () => {
    await db!.$client.end();
  });

  it("starts onboarding with the workspace as tracking id", async () => {
    const ws = await workspace();
    const createSellerReferral = vi.fn(async () => ({ actionUrl: "https://paypal.test/signup" }));
    const res = await startOnboarding(db!, { createSellerReferral }, { workspaceId: ws.id, appUrl: "https://app.test" });
    expect(res).toEqual({ actionUrl: "https://paypal.test/signup" });
    expect(createSellerReferral).toHaveBeenCalledWith({
      trackingId: ws.id,
      returnUrl: "https://app.test/api/paypal/onboarding/return",
    });
    expect((await read(ws.id)).paypalOnboarding).toBe("pending");
  });

  it("activates a seller who can receive payments and confirmed their email", async () => {
    const ws = await workspace();
    const getSellerStatus = vi.fn(async () => ({ merchantId: "SELLER1", paymentsReceivable: true, primaryEmailConfirmed: true }));
    await expect(completeOnboarding(db!, { getSellerStatus }, { workspaceId: ws.id })).resolves.toBe("active");
    expect(await read(ws.id)).toMatchObject({ paypalMerchantId: "SELLER1", paypalOnboarding: "active" });
  });

  it("keeps a seller pending until the email is confirmed", async () => {
    const ws = await workspace();
    const getSellerStatus = vi.fn(async () => ({ merchantId: "SELLER2", paymentsReceivable: true, primaryEmailConfirmed: false }));
    await expect(completeOnboarding(db!, { getSellerStatus }, { workspaceId: ws.id })).resolves.toBe("pending");
    expect(await read(ws.id)).toMatchObject({ paypalMerchantId: "SELLER2", paypalOnboarding: "pending" });
  });

  it("leaves the workspace unchanged when PayPal has no seller yet", async () => {
    const ws = await workspace();
    const getSellerStatus = vi.fn(async () => ({ merchantId: null, paymentsReceivable: false, primaryEmailConfirmed: false }));
    await expect(completeOnboarding(db!, { getSellerStatus }, { workspaceId: ws.id })).resolves.toBe("not_started");
    expect((await read(ws.id)).paypalMerchantId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=postgres://tranche:tranche@localhost:5433/tranche pnpm --filter @tranche/web exec vitest run src/server/onboarding.test.ts`
Expected: FAIL with "Failed to resolve import ./onboarding".

- [ ] **Step 3: Write the server modules and routes**

`apps/web/src/server/db.ts`:

```ts
import { createDb, type Db } from "@tranche/db";

const g = globalThis as unknown as { trancheDb?: Db };

export function getDb(): Db {
  g.trancheDb ??= createDb();
  return g.trancheDb;
}
```

`apps/web/src/server/paypal.ts`:

```ts
import { HoldMechanism } from "@tranche/contracts";
import { createPayPalClient, type PayPal } from "@tranche/paypal";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

let client: PayPal | undefined;

export function getPayPal(): PayPal {
  client ??= createPayPalClient({
    clientId: required("PAYPAL_CLIENT_ID"),
    clientSecret: required("PAYPAL_CLIENT_SECRET"),
    baseUrl: process.env.PAYPAL_BASE_URL ?? "https://api-m.sandbox.paypal.com",
    partnerMerchantId: process.env.PAYPAL_PARTNER_MERCHANT_ID,
    partnerAttributionId: process.env.PAYPAL_PARTNER_ATTRIBUTION_ID,
  });
  return client;
}

export function holdMechanism(): HoldMechanism {
  return HoldMechanism.parse(process.env.PAYPAL_HOLD_MECHANISM ?? "authorization");
}

export function appUrl(): string {
  return required("APP_URL").replace(/\/$/, "");
}
```

`apps/web/src/server/onboarding.ts`:

```ts
import { type Db, schema } from "@tranche/db";
import type { PayPal } from "@tranche/paypal";
import { and, eq, ne } from "drizzle-orm";

export async function startOnboarding(
  db: Db,
  paypal: Pick<PayPal, "createSellerReferral">,
  input: { workspaceId: string; appUrl: string },
): Promise<{ actionUrl: string }> {
  const { actionUrl } = await paypal.createSellerReferral({
    trackingId: input.workspaceId,
    returnUrl: `${input.appUrl}/api/paypal/onboarding/return`,
  });
  await db
    .update(schema.workspace)
    .set({ paypalOnboarding: "pending" })
    .where(and(eq(schema.workspace.id, input.workspaceId), ne(schema.workspace.paypalOnboarding, "active")));
  return { actionUrl };
}

export async function completeOnboarding(
  db: Db,
  paypal: Pick<PayPal, "getSellerStatus">,
  input: { workspaceId: string },
): Promise<"active" | "pending" | "not_started"> {
  const status = await paypal.getSellerStatus({ trackingId: input.workspaceId });
  if (!status.merchantId) {
    const [ws] = await db
      .select({ onboarding: schema.workspace.paypalOnboarding })
      .from(schema.workspace)
      .where(eq(schema.workspace.id, input.workspaceId));
    return ws?.onboarding ?? "not_started";
  }
  const next = status.paymentsReceivable && status.primaryEmailConfirmed ? "active" : "pending";
  await db
    .update(schema.workspace)
    .set({ paypalMerchantId: status.merchantId, paypalOnboarding: next })
    .where(eq(schema.workspace.id, input.workspaceId));
  return next;
}
```

The "no seller yet" test creates a workspace whose `paypalOnboarding` defaults to `not_started`, which is what `completeOnboarding` returns.

`apps/web/src/app/api/paypal/onboarding/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { startOnboarding } from "@/server/onboarding";
import { appUrl, getPayPal } from "@/server/paypal";
import { requireWorkspaceId } from "@/server/session";

export async function POST(request: Request) {
  const workspaceId = await requireWorkspaceId(request);
  if (!workspaceId) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  return NextResponse.json(await startOnboarding(getDb(), getPayPal(), { workspaceId, appUrl: appUrl() }));
}
```

`apps/web/src/app/api/paypal/onboarding/return/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { completeOnboarding } from "@/server/onboarding";
import { appUrl, getPayPal } from "@/server/paypal";
import { requireWorkspaceId } from "@/server/session";

export async function GET(request: Request) {
  const workspaceId = await requireWorkspaceId(request);
  if (!workspaceId) return NextResponse.redirect(`${appUrl()}/sign-in`, 303);
  const status = await completeOnboarding(getDb(), getPayPal(), { workspaceId });
  return NextResponse.redirect(`${appUrl()}/onboarding/paypal?status=${status}`, 303);
}
```

The return route ignores PayPal's query parameters (`merchantIdInPayPal`, `permissionsGranted`) on purpose: anyone can forge them, so the status always comes from `getSellerStatus`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL=postgres://tranche:tranche@localhost:5433/tranche pnpm --filter @tranche/web exec vitest run src/server/onboarding.test.ts`
Expected: PASS, 4 tests.
Run: `pnpm --filter @tranche/web typecheck`
Expected: PASS once `apps/web/src/server/session.ts` exists from the H5 auth task; if H5 has not landed yet, this is the only expected error.

- [ ] **Step 5: Verify end to end in the sandbox**

With `pnpm dev`, the tunnel and a signed-in agency user: click "Connect PayPal" (H5 onboarding screen), complete signup with the agency sandbox business account, and land on `/onboarding/paypal?status=active`.
Expected: `workspace.paypal_merchant_id` equals `SANDBOX_SELLER_MERCHANT_ID` and `paypal_onboarding` is `active`.

- [ ] **Step 6: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): Add Connect PayPal onboarding routes"
```

---

### Task 8: Client funding routes

**Files:**
- Create: `apps/web/src/server/funding.ts`
- Create: `apps/web/src/app/api/portal/[token]/milestones/[milestoneId]/fund/route.ts`
- Create: `apps/web/src/app/api/portal/[token]/orders/[orderId]/approved/route.ts`
- Test: `apps/web/src/server/funding.test.ts`

**Interfaces:**
- Consumes:
  - Task 7 `getDb`, `getPayPal`, `holdMechanism`, `appUrl`; `platformFeeFor`, `approveUrlOf`, `PayPalError` from `@tranche/paypal`.
  - `resolvePortalToken(token: string): Promise<{ dealId: string; clientId: string } | null>` from `apps/web/src/server/portal.ts`, produced by the H5 frontend plan's client portal task.
  - The H1 state machine moves a milestone into `funding`; this task only reads that state.
- Produces:
  - `class FundingError extends Error { status: 404 | 409 }`.
  - `startFunding(db, paypal, { dealId, milestoneId, mechanism, appUrl, portalToken }): Promise<{ orderId: string; approveUrl: string | null }>`; `approveUrl: null` means the vaulted payment method was charged without buyer action and the hold is already queued.
  - `confirmApproval(db, { dealId, orderId }): Promise<{ holdId: string }>`.
  - `enqueuePlaceHold(db, hold: { id: string; paypalOrderId: string; mechanism: HoldMechanism }): Promise<void>`, which the H3 inbox processor also calls on `CHECKOUT.ORDER.APPROVED`, so the webhook and the browser callback collapse onto one outbox row (`requestId = place-hold-<holdId>`).
  - `POST /api/portal/[token]/milestones/[milestoneId]/fund` -> `200 { orderId, approveUrl }`, `404`, `409`, or `502 { error, debugId }`.
  - `POST /api/portal/[token]/orders/[orderId]/approved` -> `202 { holdId }` or `404`.
  - A new `hold` row with `status: "pending"`; H3 turns it `active` when the `paypal.place_hold` outbox row succeeds, storing `captureId`, `authorizationId`, `expiresAt`, and the client's `paypalVaultId` from the returned `Hold`.

Order creation is called directly from the route, not through the outbox, because the buyer needs the approval URL in the same request.
It is still safe to retry: the request id `fund-<milestoneId>-<attempt>` makes PayPal return the same order for 6 hours, and the milestone row lock below stops two parallel clicks from creating two holds.

- [ ] **Step 1: Write the failing test**

`apps/web/src/server/funding.test.ts`:

```ts
import { createDb, migrateDb, schema } from "@tranche/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { confirmApproval, FundingError, startFunding } from "./funding";

const url = process.env.DATABASE_URL;
const db = url ? createDb(url) : null;

async function fixture(opts: { state?: "funding" | "agreed"; connected?: boolean; vaultId?: string | null } = {}) {
  const [ws] = await db!
    .insert(schema.workspace)
    .values({
      name: `Funding ${crypto.randomUUID()}`,
      rateCard: { currency: "USD", dailyRateMinor: 1, minimumProjectMinor: 0 },
      paypalMerchantId: opts.connected === false ? null : "SELLER1",
      paypalOnboarding: opts.connected === false ? "not_started" : "active",
    })
    .returning();
  const [cl] = await db!
    .insert(schema.client)
    .values({ workspaceId: ws!.id, name: "Acme", email: "buyer@acme.test", paypalVaultId: opts.vaultId ?? null })
    .returning();
  const [dl] = await db!
    .insert(schema.deal)
    .values({ workspaceId: ws!.id, clientId: cl!.id, title: "Rebuild", brief: "b", currency: "USD", status: "active" })
    .returning();
  const [ms] = await db!
    .insert(schema.milestone)
    .values({
      dealId: dl!.id,
      key: "design",
      position: 0,
      title: "Design",
      priceMinor: 100000,
      criteria: { checks: [{ kind: "url_live", url: "https://example.com" }], prose: [] },
      payees: [{ kind: "agency", shareBps: 10000 }],
      state: opts.state ?? "funding",
    })
    .returning();
  return { dealId: dl!.id, milestoneId: ms!.id };
}

function fakePayPal(order: { orderId: string; approveUrl: string | null; status: string }) {
  return {
    createFundingOrder: vi.fn(async () => order),
    getOrder: vi.fn(async (id: string) => ({
      id,
      status: "PAYER_ACTION_REQUIRED",
      links: [{ href: `https://paypal.test/approve/${id}`, rel: "payer-action" }],
    })),
  };
}

const base = { mechanism: "authorization" as const, appUrl: "https://app.test", portalToken: "tok" };
const holdsOf = (milestoneId: string) => db!.select().from(schema.hold).where(eq(schema.hold.milestoneId, milestoneId));
const outboxFor = (orderId: string) =>
  db!.select().from(schema.outbox).where(eq(schema.outbox.kind, "paypal.place_hold")).then((rows) =>
    rows.filter((r) => (r.request as { orderId?: string }).orderId === orderId),
  );

describe.runIf(Boolean(db))("funding", () => {
  beforeAll(async () => {
    await migrateDb(db!);
  });
  afterAll(async () => {
    await db!.$client.end();
  });

  it("creates an order with our fee and a pending hold", async () => {
    const f = await fixture();
    const paypal = fakePayPal({ orderId: "ORDER-A", approveUrl: "https://paypal.test/approve/ORDER-A", status: "PAYER_ACTION_REQUIRED" });
    const res = await startFunding(db!, paypal, { ...base, ...f });
    expect(res).toEqual({ orderId: "ORDER-A", approveUrl: "https://paypal.test/approve/ORDER-A" });
    expect(paypal.createFundingOrder).toHaveBeenCalledWith({
      requestId: `fund-${f.milestoneId}-0`,
      mechanism: "authorization",
      amount: { currency: "USD", minor: 100000 },
      platformFee: { currency: "USD", minor: 2500 },
      payeeMerchantId: "SELLER1",
      milestoneId: f.milestoneId,
      vaultId: null,
      returnUrl: `https://app.test/portal/tok?funded=${f.milestoneId}`,
      cancelUrl: "https://app.test/portal/tok",
    });
    const holds = await holdsOf(f.milestoneId);
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({ status: "pending", paypalOrderId: "ORDER-A", amountMinor: 100000, mechanism: "authorization" });
  });

  it("reuses a pending order that still waits for the buyer", async () => {
    const f = await fixture();
    const paypal = fakePayPal({ orderId: "ORDER-B", approveUrl: "https://paypal.test/approve/ORDER-B", status: "PAYER_ACTION_REQUIRED" });
    await startFunding(db!, paypal, { ...base, ...f });
    const again = await startFunding(db!, paypal, { ...base, ...f });
    expect(again).toEqual({ orderId: "ORDER-B", approveUrl: "https://paypal.test/approve/ORDER-B" });
    expect(paypal.createFundingOrder).toHaveBeenCalledTimes(1);
    expect(await holdsOf(f.milestoneId)).toHaveLength(1);
  });

  it("charges a vaulted client without approval and queues the hold", async () => {
    const f = await fixture({ vaultId: "VAULT1" });
    const paypal = fakePayPal({ orderId: "ORDER-C", approveUrl: null, status: "COMPLETED" });
    const res = await startFunding(db!, paypal, { ...base, ...f });
    expect(res.approveUrl).toBeNull();
    expect(paypal.createFundingOrder).toHaveBeenCalledWith(expect.objectContaining({ vaultId: "VAULT1" }));
    expect(await outboxFor("ORDER-C")).toHaveLength(1);
  });

  it("refuses a milestone from another deal", async () => {
    const a = await fixture();
    const b = await fixture();
    const paypal = fakePayPal({ orderId: "X", approveUrl: null, status: "CREATED" });
    await expect(startFunding(db!, paypal, { ...base, dealId: a.dealId, milestoneId: b.milestoneId })).rejects.toMatchObject({
      status: 404,
    });
    expect(paypal.createFundingOrder).not.toHaveBeenCalled();
  });

  it("refuses a milestone that is not waiting for funding", async () => {
    const f = await fixture({ state: "agreed" });
    await expect(startFunding(db!, fakePayPal({ orderId: "X", approveUrl: null, status: "CREATED" }), { ...base, ...f })).rejects.toBeInstanceOf(
      FundingError,
    );
  });

  it("refuses when the agency has not connected PayPal", async () => {
    const f = await fixture({ connected: false });
    await expect(
      startFunding(db!, fakePayPal({ orderId: "X", approveUrl: null, status: "CREATED" }), { ...base, ...f }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("enqueues place_hold once even when confirmed twice", async () => {
    const f = await fixture();
    await startFunding(db!, fakePayPal({ orderId: "ORDER-D", approveUrl: "u", status: "PAYER_ACTION_REQUIRED" }), { ...base, ...f });
    const first = await confirmApproval(db!, { dealId: f.dealId, orderId: "ORDER-D" });
    const second = await confirmApproval(db!, { dealId: f.dealId, orderId: "ORDER-D" });
    expect(second.holdId).toBe(first.holdId);
    const rows = await outboxFor("ORDER-D");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ requestId: `place-hold-${first.holdId}`, status: "pending" });
    expect(rows[0]!.request).toEqual({
      requestId: `place-hold-${first.holdId}`,
      orderId: "ORDER-D",
      mechanism: "authorization",
      holdId: first.holdId,
    });
  });

  it("refuses an order from another deal", async () => {
    const a = await fixture();
    const b = await fixture();
    await startFunding(db!, fakePayPal({ orderId: "ORDER-E", approveUrl: "u", status: "PAYER_ACTION_REQUIRED" }), { ...base, ...a });
    await expect(confirmApproval(db!, { dealId: b.dealId, orderId: "ORDER-E" })).rejects.toMatchObject({ status: 404 });
    expect(await outboxFor("ORDER-E")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=postgres://tranche:tranche@localhost:5433/tranche pnpm --filter @tranche/web exec vitest run src/server/funding.test.ts`
Expected: FAIL with "Failed to resolve import ./funding".

- [ ] **Step 3: Write the funding module and routes**

`apps/web/src/server/funding.ts`:

```ts
import type { HoldMechanism } from "@tranche/contracts";
import { type Db, schema } from "@tranche/db";
import { approveUrlOf, type PayPal, platformFeeFor } from "@tranche/paypal";
import { and, desc, eq } from "drizzle-orm";

export class FundingError extends Error {
  constructor(
    readonly status: 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const PENDING_ORDER_TTL_MS = 3 * 60 * 60 * 1000;
const AWAITING_BUYER = new Set(["CREATED", "PAYER_ACTION_REQUIRED", "APPROVED"]);

export async function enqueuePlaceHold(
  db: Db | Tx,
  hold: { id: string; paypalOrderId: string; mechanism: HoldMechanism },
): Promise<void> {
  const requestId = `place-hold-${hold.id}`;
  await db
    .insert(schema.outbox)
    .values({
      kind: "paypal.place_hold",
      requestId,
      request: { requestId, orderId: hold.paypalOrderId, mechanism: hold.mechanism, holdId: hold.id },
    })
    .onConflictDoNothing({ target: schema.outbox.requestId });
}

export async function startFunding(
  db: Db,
  paypal: Pick<PayPal, "createFundingOrder" | "getOrder">,
  input: { dealId: string; milestoneId: string; mechanism: HoldMechanism; appUrl: string; portalToken: string },
): Promise<{ orderId: string; approveUrl: string | null }> {
  // ponytail: holds a row lock across one PayPal call (max 20s); move order creation to the outbox if funding traffic grows
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ m: schema.milestone, d: schema.deal, w: schema.workspace, c: schema.client })
      .from(schema.milestone)
      .innerJoin(schema.deal, eq(schema.deal.id, schema.milestone.dealId))
      .innerJoin(schema.workspace, eq(schema.workspace.id, schema.deal.workspaceId))
      .innerJoin(schema.client, eq(schema.client.id, schema.deal.clientId))
      .where(and(eq(schema.milestone.id, input.milestoneId), eq(schema.milestone.dealId, input.dealId)))
      .for("update", { of: schema.milestone });
    if (!row) throw new FundingError(404, "Milestone not found");
    if (row.m.state !== "funding") throw new FundingError(409, `Milestone is ${row.m.state}, not waiting for funding`);
    if (row.w.paypalOnboarding !== "active" || !row.w.paypalMerchantId) {
      throw new FundingError(409, "The agency has not finished connecting PayPal");
    }

    const holds = await tx
      .select()
      .from(schema.hold)
      .where(eq(schema.hold.milestoneId, row.m.id))
      .orderBy(desc(schema.hold.createdAt));
    if (holds.some((h) => h.status === "active")) throw new FundingError(409, "Milestone is already funded");
    const pending = holds.find((h) => h.status === "pending");
    if (pending) {
      const order = await paypal.getOrder(pending.paypalOrderId);
      if (AWAITING_BUYER.has(order.status)) return { orderId: order.id, approveUrl: approveUrlOf(order) };
      await tx.update(schema.hold).set({ status: "failed" }).where(eq(schema.hold.id, pending.id));
    }

    const amount = { currency: row.d.currency, minor: row.m.priceMinor };
    const portal = `${input.appUrl}/portal/${input.portalToken}`;
    const order = await paypal.createFundingOrder({
      requestId: `fund-${row.m.id}-${holds.length}`,
      mechanism: input.mechanism,
      amount,
      platformFee: platformFeeFor(amount),
      payeeMerchantId: row.w.paypalMerchantId,
      milestoneId: row.m.id,
      vaultId: row.c.paypalVaultId,
      returnUrl: `${portal}?funded=${row.m.id}`,
      cancelUrl: portal,
    });
    const [hold] = await tx
      .insert(schema.hold)
      .values({
        milestoneId: row.m.id,
        mechanism: input.mechanism,
        paypalOrderId: order.orderId,
        amountMinor: amount.minor,
        currency: amount.currency,
        status: "pending",
        expiresAt: new Date(Date.now() + PENDING_ORDER_TTL_MS),
      })
      .returning();
    if (!order.approveUrl) await enqueuePlaceHold(tx, hold!);
    return { orderId: order.orderId, approveUrl: order.approveUrl };
  });
}

export async function confirmApproval(db: Db, input: { dealId: string; orderId: string }): Promise<{ holdId: string }> {
  const [row] = await db
    .select({ hold: schema.hold })
    .from(schema.hold)
    .innerJoin(schema.milestone, eq(schema.milestone.id, schema.hold.milestoneId))
    .where(and(eq(schema.hold.paypalOrderId, input.orderId), eq(schema.milestone.dealId, input.dealId)));
  if (!row) throw new FundingError(404, "Order not found");
  if (row.hold.status === "pending") await enqueuePlaceHold(db, row.hold);
  return { holdId: row.hold.id };
}
```

A pending hold's `expiresAt` (3 hours) is our own cutoff for an abandoned checkout, not a PayPal rule; H4 voids nothing for pending holds, it only ignores them.

`apps/web/src/app/api/portal/[token]/milestones/[milestoneId]/fund/route.ts`:

```ts
import { Id } from "@tranche/contracts";
import { PayPalError } from "@tranche/paypal";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { FundingError, startFunding } from "@/server/funding";
import { appUrl, getPayPal, holdMechanism } from "@/server/paypal";
import { resolvePortalToken } from "@/server/portal";

export async function POST(_request: Request, ctx: RouteContext<"/api/portal/[token]/milestones/[milestoneId]/fund">) {
  const { token, milestoneId } = await ctx.params;
  const portal = await resolvePortalToken(token);
  if (!portal || !Id.safeParse(milestoneId).success) {
    return NextResponse.json({ error: "This link is invalid or has expired" }, { status: 404 });
  }
  try {
    const res = await startFunding(getDb(), getPayPal(), {
      dealId: portal.dealId,
      milestoneId,
      mechanism: holdMechanism(),
      appUrl: appUrl(),
      portalToken: token,
    });
    return NextResponse.json(res);
  } catch (err) {
    if (err instanceof FundingError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof PayPalError) {
      return NextResponse.json({ error: "PayPal could not start the payment", debugId: err.debugId }, { status: 502 });
    }
    throw err;
  }
}
```

`apps/web/src/app/api/portal/[token]/orders/[orderId]/approved/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { confirmApproval, FundingError } from "@/server/funding";
import { resolvePortalToken } from "@/server/portal";

export async function POST(_request: Request, ctx: RouteContext<"/api/portal/[token]/orders/[orderId]/approved">) {
  const { token, orderId } = await ctx.params;
  const portal = await resolvePortalToken(token);
  if (!portal || !/^[A-Z0-9]{8,40}$/.test(orderId)) {
    return NextResponse.json({ error: "This link is invalid or has expired" }, { status: 404 });
  }
  try {
    return NextResponse.json(await confirmApproval(getDb(), { dealId: portal.dealId, orderId }), { status: 202 });
  } catch (err) {
    if (err instanceof FundingError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL=postgres://tranche:tranche@localhost:5433/tranche pnpm --filter @tranche/web exec vitest run src/server/funding.test.ts`
Expected: PASS, 8 tests.
Run: `pnpm --filter @tranche/web typecheck && pnpm check`
Expected: PASS once `apps/web/src/server/portal.ts` exists from the H5 portal task.

- [ ] **Step 5: Verify end to end in the sandbox**

With the seeded deal, set its first milestone to `funding`, open the client portal link (H5), click "Fund milestone", approve with the sandbox Personal account, and wait for the H3 executor.
Expected: one `outbox` row `paypal.place_hold` with status `succeeded`, the `hold` row `active` with a future `expires_at`, and `client.paypal_vault_id` set.
Then move the second milestone to `funding` and fund it.
Expected: `approveUrl` is `null`, no PayPal page opens, and the second hold becomes `active` on its own.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/server/funding.ts apps/web/src/server/funding.test.ts "apps/web/src/app/api/portal"
git commit -m "feat(web): Add client funding and approval routes"
```
