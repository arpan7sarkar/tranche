import { z } from "zod";
import { Id } from "./ids";
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
