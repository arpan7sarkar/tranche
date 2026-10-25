import { z } from "zod";
import { Id, IsoDate, Key } from "./ids";
import { PlanDraft } from "./plan";

export const NegotiationStatus = z.enum(["open", "agreed", "escalated", "failed"]);
export const TurnKind = z.enum(["offer", "accept", "reject", "escalate"]);

export const Offer = z.object({ plan: PlanDraft, note: z.string().max(2000) });
export type Offer = z.infer<typeof Offer>;

export const NegotiationTurnInput = z.object({
  negotiationId: Id,
  round: z.number().int().min(1).max(12),
  side: z.enum(["agency", "client"]),
  kind: TurnKind,
  offer: Offer.nullable(),
  message: z.string().max(2000),
});
export type NegotiationTurnInput = z.infer<typeof NegotiationTurnInput>;

export const Adjustment = z.object({
  milestonePrices: z.array(z.object({ key: Key, priceMinor: z.number().int().positive() })).max(12),
  taskDurations: z
    .array(z.object({ key: Key, durationDays: z.number().int().min(1).max(120) }))
    .max(80),
});
export type Adjustment = z.infer<typeof Adjustment>;
export const NegotiationDecision = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("offer"), adjustment: Adjustment, message: z.string().max(1000) }),
  z.object({ kind: z.literal("accept"), message: z.string().max(1000) }),
  z.object({ kind: z.literal("escalate"), message: z.string().max(1000) }),
]);
export type NegotiationDecision = z.infer<typeof NegotiationDecision>;
export const StartNegotiationInput = z.object({
  dealId: Id,
  client: z.object({
    limitMinor: z.number().int().positive(),
    latestEndDate: IsoDate.nullable(),
    maxRounds: z.number().int().min(1).max(12),
  }),
  agencyFloorMinor: z.number().int().positive().optional(),
  agencyMaxRounds: z.number().int().min(1).max(12).optional(),
});
export type StartNegotiationInput = z.infer<typeof StartNegotiationInput>;
