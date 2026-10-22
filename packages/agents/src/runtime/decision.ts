import { AgentDecision } from "@tranche/contracts";
import type { LanguageModel } from "ai";
import { generateStructured } from "./llm";
import { untrusted } from "./untrusted";

export async function decideAction(
  input: { instructions: string; context: string },
  model: LanguageModel,
): Promise<AgentDecision> {
  return generateStructured({
    model,
    schema: AgentDecision,
    system: input.instructions,
    prompt: untrusted("deal context", input.context),
  });
}
