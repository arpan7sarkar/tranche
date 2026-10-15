export class PermanentError extends Error {}

// The caller may not do this; routes map it to 403.
export class ForbiddenError extends Error {}

export function errorMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 2000);
}

export function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a value");
  return value;
}
