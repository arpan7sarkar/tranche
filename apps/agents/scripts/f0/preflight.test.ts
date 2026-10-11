import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { runPreflight } from "./preflight";

const credentials = {
  PAYPAL_ENV: "sandbox",
  PAYPAL_CLIENT_ID: "fake-client-id",
  PAYPAL_CLIENT_SECRET: "fake-client-secret",
};
const token = "fake-access-token";
const tokenResponse = { access_token: token, token_type: "Bearer", expires_in: 3600 };

function transportFor(body: unknown = tokenResponse, status = 200) {
  return vi.fn<typeof fetch>().mockResolvedValue(Response.json(body, { status }));
}

describe("sandbox preflight", () => {
  it.each([[], ["--help"]].map((args) => ({ args })))(
    "shows help without configuration or network access: $args",
    async ({ args }) => {
      const transport = transportFor();
      const check = await runPreflight(args, {}, transport);
      expect(check.exitCode).toBe(0);
      expect(check.output).toContain("--authenticate");
      expect(transport).not.toHaveBeenCalled();
    },
  );

  it.each(
    [
      ["--live"],
      ["--authenticate", "--check-config"],
      ["--help", "--authenticate"],
      ["--authenticate", credentials.PAYPAL_CLIENT_SECRET],
      ["--endpoint=https://api-m.paypal.com"],
    ].map((args) => ({ args })),
  )("rejects arguments without echoing them or calling PayPal: $args", async ({ args }) => {
    const transport = transportFor();
    const check = await runPreflight(args, credentials, transport);
    expect(check.exitCode).toBe(1);
    expect(check.output).toContain("invalid_arguments");
    for (const arg of args) expect(check.output).not.toContain(arg);
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "live", "SANDBOX", " sandbox"])(
    "rejects missing or non-sandbox environments: %s",
    async (environment) => {
      const transport = transportFor();
      const check = await runPreflight(
        ["--authenticate"],
        { ...credentials, PAYPAL_ENV: environment },
        transport,
      );
      expect(check.exitCode).toBe(1);
      expect(JSON.parse(check.output).invalidVariables).toContain("PAYPAL_ENV");
      expect(transport).not.toHaveBeenCalled();
    },
  );

  it.each(["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"])(
    "rejects invalid %s before sending a request",
    async (variable) => {
      for (const value of [undefined, "", "  ", "bad\rcredential", "bad\ncredential"]) {
        const transport = transportFor();
        const check = await runPreflight(
          ["--authenticate"],
          { ...credentials, [variable]: value },
          transport,
        );
        expect(check.exitCode).toBe(1);
        expect(JSON.parse(check.output).invalidVariables).toContain(variable);
        expect(transport).not.toHaveBeenCalled();
      }
    },
  );

  it("rejects a colon in the Basic-auth client ID", async () => {
    const transport = transportFor();
    expect(
      (
        await runPreflight(
          ["--authenticate"],
          { ...credentials, PAYPAL_CLIENT_ID: "a:b" },
          transport,
        )
      ).exitCode,
    ).toBe(1);
    expect(transport).not.toHaveBeenCalled();
  });

  it("validates configuration without attempting authentication", async () => {
    const transport = transportFor();
    const check = await runPreflight(["--check-config"], credentials, transport);
    expect(check.exitCode).toBe(0);
    expect(JSON.parse(check.output).outcome).toBe("valid_configuration");
    expect(transport).not.toHaveBeenCalled();
  });

  it("authenticates only at the fixed endpoint without exposing the response", async () => {
    const transport = transportFor({
      ...tokenResponse,
      nonce: "fake-private-nonce",
      scope: credentials.PAYPAL_CLIENT_SECRET,
      app_id: credentials.PAYPAL_CLIENT_ID,
    });
    const check = await runPreflight(["--authenticate"], credentials, transport);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith(
      "https://api-m.sandbox.paypal.com/v1/oauth2/token",
      expect.objectContaining({
        method: "POST",
        body: "grant_type=client_credentials",
        redirect: "manual",
        signal: expect.any(AbortSignal),
        headers: {
          Authorization: `Basic ${Buffer.from(`${credentials.PAYPAL_CLIENT_ID}:${credentials.PAYPAL_CLIENT_SECRET}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
      }),
    );
    expect(check.exitCode).toBe(0);
    expect(JSON.parse(check.output)).toEqual({
      mode: "authenticate",
      outcome: "authenticated",
      timestamp: expect.any(String),
      environment: "sandbox",
      httpStatus: 200,
      expiresInSeconds: 3600,
    });
  });

  it.each([400, 401])("recognizes a documented invalid client response (%i)", async (status) => {
    const transport = transportFor(
      { error: "invalid_client", error_description: credentials.PAYPAL_CLIENT_SECRET },
      status,
    );
    const check = await runPreflight(["--authenticate"], credentials, transport);
    expect(check.exitCode).toBe(2);
    expect(check.output).toContain("authentication_rejected");
    expect(check.output).not.toContain(credentials.PAYPAL_CLIENT_SECRET);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 403, 404, 422])(
    "does not mislabel other client failures (%i)",
    async (status) => {
      const check = await runPreflight(
        ["--authenticate"],
        credentials,
        transportFor({ error: "unknown" }, status),
      );
      expect(check.exitCode).toBe(4);
      expect(check.output).not.toContain("authentication_rejected");
    },
  );

  it.each([429, 500, 502, 503])(
    "does not retry provider or rate-limit failures (%i)",
    async (status) => {
      const transport = transportFor({ error: credentials.PAYPAL_CLIENT_SECRET }, status);
      const check = await runPreflight(["--authenticate"], credentials, transport);
      expect(check.exitCode).toBe(3);
      expect(transport).toHaveBeenCalledTimes(1);
      expect(check.output).not.toContain(credentials.PAYPAL_CLIENT_SECRET);
    },
  );

  it.each([301, 302, 307, 308])(
    "rejects redirects without forwarding credentials (%i)",
    async (status) => {
      const transport = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(null, {
          status,
          headers: { Location: "https://api-m.paypal.com/v1/oauth2/token" },
        }),
      );
      const check = await runPreflight(["--authenticate"], credentials, transport);
      expect(check.exitCode).toBe(4);
      expect(check.output).toContain("unexpected_redirect");
      expect(transport).toHaveBeenCalledTimes(1);
      expect(transport.mock.calls[0]?.[1]?.redirect).toBe("manual");
    },
  );

  it.each(
    [
      {},
      null,
      [],
      { ...tokenResponse, access_token: " " },
      { ...tokenResponse, access_token: 123 },
      { ...tokenResponse, token_type: "Other" },
      { ...tokenResponse, expires_in: 0 },
      { ...tokenResponse, expires_in: -1 },
      { ...tokenResponse, expires_in: "3600" },
      { ...tokenResponse, expires_in: 0.5 },
    ].map((body) => ({ body })),
  )("rejects an invalid successful response: $body", async ({ body }) => {
    expect((await runPreflight(["--authenticate"], credentials, transportFor(body))).exitCode).toBe(
      4,
    );
  });

  it("rejects malformed JSON without printing its contents", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(credentials.PAYPAL_CLIENT_SECRET));
    const check = await runPreflight(["--authenticate"], credentials, transport);
    expect(check.exitCode).toBe(4);
    expect(check.output).not.toContain(credentials.PAYPAL_CLIENT_SECRET);
  });

  it.each(["TypeError", "TimeoutError", "AbortError"])(
    "suppresses exception contents and does not retry (%s)",
    async (name) => {
      const transport = vi
        .fn<typeof fetch>()
        .mockRejectedValue(
          Object.assign(new Error(`${credentials.PAYPAL_CLIENT_SECRET} ${token}`), { name }),
        );
      const check = await runPreflight(["--authenticate"], credentials, transport);
      expect(check.exitCode).toBe(3);
      expect(transport).toHaveBeenCalledTimes(1);
      expect(check.output).not.toContain(credentials.PAYPAL_CLIENT_SECRET);
      expect(check.output).not.toContain(token);
    },
  );

  it("sets a 15-second deadline for the entire request", async () => {
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, "timeout");
    try {
      await runPreflight(["--authenticate"], credentials, transportFor());
      expect(timeout).toHaveBeenCalledWith(15_000);
    } finally {
      timeout.mockRestore();
      vi.useRealTimers();
    }
  });

  it("classifies a deadline reached while reading the response as inconclusive", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const response = new Response("{}");
    vi.spyOn(response, "json").mockImplementation(async () => {
      controller.abort();
      throw new DOMException("private response", "AbortError");
    });
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response);
    try {
      const check = await runPreflight(["--authenticate"], credentials, transport);
      expect(check.exitCode).toBe(3);
      expect(check.output).toContain("request_inconclusive");
      expect(check.output).not.toContain("private response");
      expect(transport).toHaveBeenCalledTimes(1);
    } finally {
      timeout.mockRestore();
    }
  });

  it("does not expose secrets from any provider-controlled fields", async () => {
    const transport = transportFor({
      ...tokenResponse,
      access_token: token,
      debug_id: credentials.PAYPAL_CLIENT_SECRET,
      error_description: credentials.PAYPAL_CLIENT_ID,
    });
    const check = await runPreflight(["--authenticate"], credentials, transport);
    for (const secret of [credentials.PAYPAL_CLIENT_ID, credentials.PAYPAL_CLIENT_SECRET, token]) {
      expect(check.output).not.toContain(secret);
    }
  });
});

describe("preflight process boundary", () => {
  const script = fileURLToPath(new URL("./preflight.ts", import.meta.url));

  it("imports without stdout, stderr, or network activity", () => {
    const child = spawnSync(
      process.execPath,
      [
        "--import=tsx",
        "--input-type=module",
        "-e",
        `globalThis.fetch = () => { throw new Error('unexpected network'); }; await import(${JSON.stringify(new URL("./preflight.ts", import.meta.url).href)});`,
      ],
      { encoding: "utf8", timeout: 10_000, env: { ...process.env, ...credentials } },
    );
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toBe("");
    expect(child.stderr).toBe("");
  });

  it.each([[], ["--help"], ["--check-config"]].map((args) => ({ args })))(
    "runs the real CLI offline: $args",
    ({ args }) => {
      const child = spawnSync(process.execPath, ["--import=tsx", script, ...args], {
        encoding: "utf8",
        timeout: 10_000,
        env: { ...process.env, ...credentials },
      });
      expect(child.status, child.stderr).toBe(0);
      expect(child.stdout.length).toBeGreaterThan(0);
      expect(child.stderr).toBe("");
      expect(child.stdout).not.toContain(credentials.PAYPAL_CLIENT_SECRET);
    },
  );

  it("prints safe configuration errors only to stderr", () => {
    const child = spawnSync(process.execPath, ["--import=tsx", script, "--authenticate"], {
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, ...credentials, PAYPAL_ENV: "live" },
    });
    expect(child.status).toBe(1);
    expect(child.stdout).toBe("");
    expect(JSON.parse(child.stderr).outcome).toBe("invalid_configuration");
    expect(child.stderr).not.toContain(credentials.PAYPAL_CLIENT_SECRET);
  });
});
