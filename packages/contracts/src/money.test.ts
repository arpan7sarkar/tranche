import { describe, expect, it } from "vitest";
import { addMoney, fromPayPalValue, Money, minorUnitExponent, toPayPalValue } from "./money";

describe("money", () => {
  it("formats two-decimal currencies", () => {
    expect(toPayPalValue({ currency: "USD", minor: 0 })).toBe("0.00");
    expect(toPayPalValue({ currency: "USD", minor: 5 })).toBe("0.05");
    expect(toPayPalValue({ currency: "USD", minor: 123456 })).toBe("1234.56");
  });

  it("formats zero-decimal currencies", () => {
    expect(toPayPalValue({ currency: "JPY", minor: 1500 })).toBe("1500");
  });

  it("parses PayPal values", () => {
    expect(fromPayPalValue("USD", "1234.5")).toEqual({ currency: "USD", minor: 123450 });
    expect(fromPayPalValue("USD", "7")).toEqual({ currency: "USD", minor: 700 });
    expect(fromPayPalValue("JPY", "1500")).toEqual({ currency: "JPY", minor: 1500 });
  });

  it("rejects values it cannot represent exactly", () => {
    expect(() => fromPayPalValue("USD", "10.005")).toThrow();
    expect(() => fromPayPalValue("JPY", "10.50")).toThrow();
    expect(() => fromPayPalValue("USD", "-1.00")).toThrow();
    expect(() => fromPayPalValue("USD", "abc")).toThrow();
  });

  it("round-trips", () => {
    for (const minor of [0, 1, 99, 100, 101, 999999]) {
      const m = { currency: "EUR", minor };
      expect(fromPayPalValue("EUR", toPayPalValue(m))).toEqual(m);
    }
  });

  it("refuses to add different currencies", () => {
    expect(addMoney({ currency: "USD", minor: 1 }, { currency: "USD", minor: 2 })).toEqual({
      currency: "USD",
      minor: 3,
    });
    expect(() => addMoney({ currency: "USD", minor: 1 }, { currency: "EUR", minor: 2 })).toThrow();
  });
});

describe("money edge cases", () => {
  it("throws on a three-decimal value without rounding", () => {
    expect(() => fromPayPalValue("USD", "10.005")).toThrow(/10\.005/);
    expect(() => fromPayPalValue("EUR", "0.001")).toThrow();
  });

  it("throws on cents for every zero-decimal currency", () => {
    for (const currency of ["JPY", "HUF", "TWD"]) {
      expect(() => fromPayPalValue(currency, "10.50")).toThrow();
      expect(() => fromPayPalValue(currency, "10.0")).toThrow();
    }
  });

  it("throws on empty, whitespace and signed values", () => {
    for (const value of ["", " ", "1.", ".5", "+1.00", "1,00"]) {
      expect(() => fromPayPalValue("USD", value)).toThrow();
    }
  });

  it("reports the exponent per currency", () => {
    expect(minorUnitExponent("USD")).toBe(2);
    expect(minorUnitExponent("EUR")).toBe(2);
    expect(minorUnitExponent("JPY")).toBe(0);
  });

  it("validates the Money shape", () => {
    expect(Money.safeParse({ currency: "USD", minor: 100 }).success).toBe(true);
    expect(Money.safeParse({ currency: "usd", minor: 100 }).success).toBe(false);
    expect(Money.safeParse({ currency: "USD", minor: -1 }).success).toBe(false);
    expect(Money.safeParse({ currency: "USD", minor: 1.5 }).success).toBe(false);
  });
});
