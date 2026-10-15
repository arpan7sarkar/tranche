import type { Money } from "@tranche/contracts";

export const PLATFORM_FEE_BPS = 250;

export function platformFeeFor(amount: Money): Money {
  return {
    currency: amount.currency,
    minor: Math.floor((amount.minor * PLATFORM_FEE_BPS) / 10_000),
  };
}
