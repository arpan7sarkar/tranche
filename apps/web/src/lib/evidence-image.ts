// Screenshots load only from the verifier's own storage, so a delivered page can't make the
// client's browser call a host the agency controls.
export function trustedImageUrl(raw: unknown, allowedOrigin: string | undefined): string | null {
  if (typeof raw !== "string" || !allowedOrigin) return null;
  const url = URL.parse(raw);
  const allowed = URL.parse(allowedOrigin);
  if (!url || !allowed || url.protocol !== "https:" || allowed.protocol !== "https:") return null;
  return url.origin === allowed.origin ? url.href : null;
}
