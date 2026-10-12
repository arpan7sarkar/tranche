export class SandboxTransportError extends Error {
  constructor(readonly code: "configuration" | "destination" | "network" | "http" | "response") {
    super(`sandbox_${code}`);
  }
}

export type SandboxRequest = { method: "GET" | "POST"; path: string; body?: unknown };
export type SandboxRequestAccounting = {
  reserve(kind: "oauth" | "read" | "recovery"): Promise<string>;
  finish(id: string, success: boolean): Promise<void>;
};
export type SandboxWritePermit = { requestId: string; beforeDispatch(): Promise<void> };

const origin = "https://api-m.sandbox.paypal.com";

export class SandboxClient {
  private token: { value: string; until: number } | undefined;
  private authentication: Promise<string> | undefined;

  constructor(
    private readonly config: { environment: string; clientId: string; clientSecret: string },
    private readonly accounting: SandboxRequestAccounting,
    private readonly fetcher: typeof fetch = fetch,
    private readonly clock: () => number = Date.now,
  ) {
    if (
      config.environment !== "sandbox" ||
      !/^[A-Za-z0-9_-]+$/.test(config.clientId) ||
      !/^[A-Za-z0-9_-]+$/.test(config.clientSecret)
    )
      throw new SandboxTransportError("configuration");
  }

  private async raw(path: string, init: RequestInit): Promise<unknown> {
    try {
      const response = await this.fetcher(`${origin}${path}`, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.any([
          AbortSignal.timeout(15_000),
          ...(init.signal ? [init.signal] : []),
        ]),
      });
      if (!response.ok) throw new SandboxTransportError("http");
      const body: unknown = await response.json();
      return body;
    } catch (error) {
      if (error instanceof SandboxTransportError) throw error;
      throw new SandboxTransportError("network");
    }
  }

  private async accessToken(signal?: AbortSignal): Promise<string> {
    if (this.token && this.token.until > this.clock()) return this.token.value;
    if (this.authentication) return this.authentication;
    this.authentication = this.authenticate(signal);
    try {
      return await this.authentication;
    } finally {
      this.authentication = undefined;
    }
  }

  private async authenticate(signal?: AbortSignal): Promise<string> {
    const id = await this.accounting.reserve("oauth");
    try {
      const body = await this.raw("/v1/oauth2/token", {
        method: "POST",
        ...(signal ? { signal } : {}),
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      });
      if (
        !body ||
        typeof body !== "object" ||
        !("access_token" in body) ||
        typeof body.access_token !== "string" ||
        !/^[A-Za-z0-9._~-]+$/.test(body.access_token) ||
        !("token_type" in body) ||
        body.token_type !== "Bearer" ||
        !("expires_in" in body) ||
        typeof body.expires_in !== "number" ||
        !Number.isSafeInteger(body.expires_in) ||
        body.expires_in <= 0 ||
        body.expires_in > 86400
      ) {
        throw new SandboxTransportError("response");
      }
      this.token = {
        value: body.access_token,
        until: this.clock() + Math.max(0, body.expires_in - 30) * 1000,
      };
      await this.accounting.finish(id, true);
      return body.access_token;
    } catch (error) {
      await this.accounting.finish(id, false);
      throw error;
    }
  }

  async request(
    request: SandboxRequest,
    options: { permit?: SandboxWritePermit; recovery?: boolean; signal?: AbortSignal } = {},
  ): Promise<unknown> {
    if (
      !/^\/v[12]\/[A-Za-z0-9/_-]+$/.test(request.path) ||
      request.path.includes("//") ||
      request.path === "/v1/oauth2/token" ||
      !["GET", "POST"].includes(request.method)
    ) {
      throw new SandboxTransportError("destination");
    }
    if (
      request.method === "POST" &&
      (!options.permit || !/^[a-f0-9-]{36}$/.test(options.permit.requestId))
    )
      throw new SandboxTransportError("configuration");
    if (request.method === "GET" && request.body !== undefined)
      throw new SandboxTransportError("configuration");
    options.signal?.throwIfAborted();
    const token = await this.accessToken(options.signal);
    options.signal?.throwIfAborted();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    let attempt: string | undefined;
    if (options.permit) {
      if (request.method === "POST") headers["PayPal-Request-Id"] = options.permit.requestId;
      await options.permit.beforeDispatch();
    } else {
      attempt = await this.accounting.reserve(options.recovery ? "recovery" : "read");
    }
    try {
      const body = await this.raw(request.path, {
        method: request.method,
        headers,
        ...(options.signal ? { signal: options.signal } : {}),
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      });
      if (attempt) await this.accounting.finish(attempt, true);
      return body;
    } catch (error) {
      if (attempt) await this.accounting.finish(attempt, false);
      throw error;
    }
  }
}
