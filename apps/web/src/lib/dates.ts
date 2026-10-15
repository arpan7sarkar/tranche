const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function formatDay(iso: string): string {
  return DAY.format(new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso));
}
