import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const TOKEN_ENDPOINT = "https://api-m.sandbox.paypal.com/v1/oauth2/token";
const HELP = `PayPal sandbox preflight (P1)

Usage: pnpm --filter @tranche/agents-service run f0:preflight [mode]

  --help           Show help (default; no network request)
  --check-config   Validate local configuration (no network request)
  --authenticate   Perform one sandbox OAuth token exchange

Required configuration: PAYPAL_ENV=sandbox, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET.
The command loads the repository-root .env if present; process values take precedence.
Never pass credentials as arguments. Payment capabilities are not tested.
`;

type ExitCode = 0 | 1 | 2 | 3 | 4;
type PreflightResult = { exitCode: ExitCode; output: string };
type Environment = Readonly<Record<string, string | undefined>>;

function result(
  exitCode: ExitCode,
  mode: string,
  outcome: string,
  details: Record<string, string | number | string[]> = {},
): PreflightResult {
  return {
    exitCode,
    output: JSON.stringify({
      mode,
      outcome,
      timestamp: new Date().toISOString(),
      ...details,
    }),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validCredential(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0 && !/[\r\n]/.test(value);
}

export async function runPreflight(
  args: readonly string[],
  env: Environment,
  transport: typeof fetch = fetch,
): Promise<PreflightResult> {
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
    return { exitCode: 0, output: HELP };
  }
  const mode = args[0];
  if (args.length !== 1 || (mode !== "--check-config" && mode !== "--authenticate")) {
    return result(1, "arguments", "invalid_arguments");
  }

  const invalidVariables: string[] = [];
  if (env.PAYPAL_ENV !== "sandbox") invalidVariables.push("PAYPAL_ENV");
  if (!validCredential(env.PAYPAL_CLIENT_ID) || env.PAYPAL_CLIENT_ID.includes(":")) {
    invalidVariables.push("PAYPAL_CLIENT_ID");
  }
  if (!validCredential(env.PAYPAL_CLIENT_SECRET)) invalidVariables.push("PAYPAL_CLIENT_SECRET");
  if (invalidVariables.length > 0) {
    return result(1, mode.slice(2), "invalid_configuration", { invalidVariables });
  }
  if (mode === "--check-config") {
    return result(0, "check-config", "valid_configuration", { environment: "sandbox" });
  }

  const basicAuth = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString(
    "base64",
  );
  const signal = AbortSignal.timeout(15_000);
  let response: Response;
  let body: unknown;
  try {
    response = await transport(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
      redirect: "manual",
      signal,
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      return result(4, "authenticate", "unexpected_redirect", { httpStatus: response.status });
    }
    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel();
      return result(3, "authenticate", "provider_unavailable", { httpStatus: response.status });
    }
    try {
      body = await response.json();
    } catch {
      if (signal.aborted) return result(3, "authenticate", "request_inconclusive");
      return result(4, "authenticate", "unexpected_response", { httpStatus: response.status });
    }
  } catch {
    return result(3, "authenticate", "request_inconclusive");
  }

  if (!response.ok) {
    const rejected =
      (response.status === 400 || response.status === 401) &&
      isObject(body) &&
      (body.error === "invalid_client" || body.error === "invalid_client_credentials");
    return result(
      rejected ? 2 : 4,
      "authenticate",
      rejected ? "authentication_rejected" : "unexpected_response",
      {
        httpStatus: response.status,
      },
    );
  }
  if (
    !isObject(body) ||
    typeof body.access_token !== "string" ||
    body.access_token.trim().length === 0 ||
    body.token_type !== "Bearer" ||
    typeof body.expires_in !== "number" ||
    !Number.isSafeInteger(body.expires_in) ||
    body.expires_in <= 0
  ) {
    return result(4, "authenticate", "unexpected_response", { httpStatus: response.status });
  }

  return result(0, "authenticate", "authenticated", {
    environment: "sandbox",
    httpStatus: response.status,
    expiresInSeconds: body.expires_in,
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const check = await runPreflight(process.argv.slice(2), process.env);
    if (check.exitCode === 0) console.log(check.output);
    else console.error(check.output);
    process.exitCode = check.exitCode;
  } catch {
    console.error(JSON.stringify({ mode: "preflight", outcome: "unexpected_failure" }));
    process.exitCode = 4;
  }
}
