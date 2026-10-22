import { z } from "zod";
import { ActionPayload } from "./actions";
import { Id } from "./ids";
export const AgentDecision = z.object({
  reasoning: z.string().min(1).max(4000),
  evidenceIds: z.array(Id),
  payload: ActionPayload,
});
export type AgentDecision = z.infer<typeof AgentDecision>;
