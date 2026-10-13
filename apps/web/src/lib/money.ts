import { type Money, minorUnitExponent } from "@tranche/contracts";

export function formatMoney(m: Money, locale = "en-US"): string {
  const exponent = minorUnitExponent(m.currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: m.currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(m.minor / 10 ** exponent);
}

export function totalOf(currency: string, minors: number[]): Money {
  return { currency, minor: minors.reduce((sum, n) => sum + n, 0) };
}
