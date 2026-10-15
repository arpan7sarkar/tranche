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

export function errorFromResponse(
  status: number,
  body: unknown,
  headerDebugId: string | null,
): PayPalError {
  const b = (body && typeof body === "object" ? body : {}) as ErrorBody;
  return new PayPalError({
    status,
    name: b.name ?? b.error ?? `HTTP_${status}`,
    message:
      b.details?.[0]?.description ??
      b.message ??
      b.error_description ??
      `PayPal returned ${status}`,
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
