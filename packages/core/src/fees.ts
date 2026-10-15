import type { Money } from "@tranche/contracts";

export const PLATFORM_FEE_BPS = 200;

export function platformFee(amount: Money, bps = PLATFORM_FEE_BPS): Money {
  return { currency: amount.currency, minor: Math.floor((amount.minor * bps) / 10000) };
}
