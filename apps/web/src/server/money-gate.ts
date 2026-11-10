import "server-only";

export class WebMoneyDisabledError extends Error {
  constructor() {
    super("payments_disabled");
  }
}

export function requireWebMoneyEnabled(): void {
  if (process.env.WEB_MONEY_ENABLED !== "true") throw new WebMoneyDisabledError();
}

export function withWebMoneyGate<T extends unknown[]>(
  handler: (...args: T) => Promise<Response>,
): (...args: T) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof WebMoneyDisabledError) {
        return Response.json({ error: "payments_disabled" }, { status: 503 });
      }
      throw error;
    }
  };
}
