import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
export type Models = { judge: LanguageModel; fast: LanguageModel };
export class ModelDisabledError extends Error {
  constructor() {
    super("model_disabled");
    this.name = "ModelDisabledError";
  }
}
export function assertModelEnabled(): void {
  if (process.env.TRANCHE_LLM === "off") throw new ModelDisabledError();
}
export function selectModels(env: NodeJS.ProcessEnv = process.env): Models {
  if (env.TRANCHE_LLM === "off") throw new ModelDisabledError();
  if (env.AI_FALLBACK && env.AI_FALLBACK !== "openai") throw new Error("invalid_model_provider");
  return env.AI_FALLBACK === "openai"
    ? {
        judge: openai(env.OPENAI_JUDGE_MODEL ?? "gpt-5.4-mini"),
        fast: openai(env.OPENAI_FAST_MODEL ?? "gpt-5.4-nano"),
      }
    : {
        judge: google(env.GEMINI_JUDGE_MODEL ?? "gemini-3.5-flash-lite"),
        fast: google(env.GEMINI_FAST_MODEL ?? "gemini-3.5-flash-lite"),
      };
}
