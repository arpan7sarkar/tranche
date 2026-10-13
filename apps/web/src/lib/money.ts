import { type Money, minorUnitExponent, toPayPalValue } from "@tranche/contracts";

export function formatMoney(m: Money, locale = "en-US"): string {
  const exponent = minorUnitExponent(m.currency);
  // Intl formats decimal strings exactly; lib typings only declare number
  const value = toPayPalValue(m) as unknown as number;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: m.currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(value);
}

export function totalOf(currency: string, minors: number[]): Money {
  return { currency, minor: minors.reduce((sum, n) => sum + n, 0) };
}
