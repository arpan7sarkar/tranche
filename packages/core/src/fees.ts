import type { Money } from "@tranche/contracts";

export const PLATFORM_FEE_BPS = 200;
export const PENDING_ORDER_TTL_HOURS = 3;

export function platformFee(amount: Money, bps = PLATFORM_FEE_BPS): Money {
  if (!Number.isInteger(bps) || bps < 0) throw new Error(`Invalid fee bps: ${bps}`);
  return { currency: amount.currency, minor: Math.floor((amount.minor * bps) / 10000) };
}

export const PENDING_ORDER_TTL_HOURS = 3;
