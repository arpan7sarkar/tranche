import { z } from "zod";

export const CurrencyCode = z.string().regex(/^[A-Z]{3}$/);
export const Money = z.object({
  currency: CurrencyCode,
  minor: z.number().int().nonnegative(),
});
export type Money = z.infer<typeof Money>;

const ZERO_DECIMAL = new Set(["HUF", "JPY", "TWD"]);

export function minorUnitExponent(currency: string): 0 | 2 {
  return ZERO_DECIMAL.has(currency) ? 0 : 2;
}

export function toPayPalValue(m: Money): string {
  if (minorUnitExponent(m.currency) === 0) return String(m.minor);
  const s = String(m.minor).padStart(3, "0");
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

export function fromPayPalValue(currency: string, value: string): Money {
  const exponent = minorUnitExponent(currency);
  const pattern = exponent === 0 ? /^\d+$/ : /^\d+(\.\d{1,2})?$/;
  if (!pattern.test(value)) throw new Error(`Cannot represent ${value} ${currency} exactly`);
  if (exponent === 0) return { currency, minor: Number(value) };
  const [whole = "0", fraction = ""] = value.split(".");
  return { currency, minor: Number(whole) * 100 + Number(fraction.padEnd(2, "0")) };
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency)
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  return { currency: a.currency, minor: a.minor + b.minor };
}
