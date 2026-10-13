const FALLBACK = "/deals";
const ORIGIN = "http://tranche.invalid";

const hasControlChar = (s: string) => Array.from(s).some((c) => c.charCodeAt(0) < 32);

export function safeNextPath(next: string | null | undefined, fallback = FALLBACK): string {
  if (
    !next?.startsWith("/") ||
    next.startsWith("//") ||
    next.includes("\\") ||
    hasControlChar(next)
  ) {
    return fallback;
  }
  try {
    return new URL(next, ORIGIN).origin === ORIGIN ? next : fallback;
  } catch {
    return fallback;
  }
}
