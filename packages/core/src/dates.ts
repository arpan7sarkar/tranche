const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parse(isoDate: string): Date {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (
    !ISO_DATE.test(isoDate) ||
    Number.isNaN(d.getTime()) ||
    d.toISOString().slice(0, 10) !== isoDate
  ) {
    throw new Error(`Invalid date: ${isoDate}`);
  }
  return d;
}

export function addDays(isoDate: string, days: number): string {
  const d = parse(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / DAY_MS);
}

export function minDate(a: string, b: string): string {
  return a < b ? a : b;
}

export function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}
