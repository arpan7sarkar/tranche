import { z } from "zod";
import { ActionType } from "./actions";
import { CurrencyCode } from "./money";

export const RateCard = z.object({
  currency: CurrencyCode,
  dailyRateMinor: z.number().int().positive(),
  minimumProjectMinor: z.number().int().nonnegative(),
});
export type RateCard = z.infer<typeof RateCard>;

export const Policy = z.object({
  perActionMaxMinor: z.number().int().nonnegative(),
  perMilestoneMaxMinor: z.number().int().nonnegative(),
  perDealMaxMinor: z.number().int().nonnegative(),
  autoReleaseAfterHours: z.number().int().positive().nullable(),
  cooldownMinutes: z.number().int().nonnegative(),
  alwaysAsk: z.array(ActionType),
});
export type Policy = z.infer<typeof Policy>;

export const Mandate = z.object({
  side: z.enum(["agency", "client"]),
  limitMinor: z.number().int().nonnegative(),
  latestEndDate: z.iso.date().nullable(),
  maxRounds: z.number().int().min(1).max(12),
});
export type Mandate = z.infer<typeof Mandate>;
