const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function formatDay(iso: string): string {
  return DAY.format(new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso));
}

const INSTANT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatInstant(at: Date | string): string {
  return INSTANT.format(new Date(at));
}
