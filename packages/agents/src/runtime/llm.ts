import {
  generateText,
  type LanguageModel,
  type ModelMessage,
  NoObjectGeneratedError,
  Output,
} from "ai";
import type { z } from "zod";
import { assertModelEnabled } from "./models";
import { UNTRUSTED_RULES } from "./untrusted";

export async function generateStructured<S extends z.ZodType>(args: {
  model: LanguageModel;
  schema: S;
  system: string;
  prompt: string | ModelMessage[];
  maxAttempts?: number;
  timeoutMs?: number;
}): Promise<z.infer<S>> {
  assertModelEnabled();
  const attempts = args.maxAttempts ?? 2;
  const timeout = args.timeoutMs ?? 30_000;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 3)
    throw new Error("invalid_attempt_limit");
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120_000)
    throw new Error("invalid_timeout");
  const signal = AbortSignal.timeout(timeout);
  for (let attempt = 1; ; attempt++) {
    assertModelEnabled();
    try {
      const result = await generateText({
        model: args.model,
        instructions: `${args.system}\n${UNTRUSTED_RULES}`,
        ...(typeof args.prompt === "string" ? { prompt: args.prompt } : { messages: args.prompt }),
        output: Output.object({ schema: args.schema }),
        maxRetries: 0,
        maxOutputTokens: 4096,
        abortSignal: signal,
      });
      const output = args.schema.parse(result.output);
      console.info(
        JSON.stringify({
          msg: "agent.model_call",
          attempt,
          inputTokens: result.totalUsage.inputTokens,
          outputTokens: result.totalUsage.outputTokens,
        }),
      );
      return output;
    } catch (error) {
      if (attempt >= attempts || !NoObjectGeneratedError.isInstance(error)) throw error;
    }
  }
}
