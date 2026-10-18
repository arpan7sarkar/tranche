import { MockLanguageModelV4 } from "ai/test";
export function scriptedModel(responses: readonly unknown[]) {
  let index = 0;
  return new MockLanguageModelV4({
    modelId: "tranche-scripted",
    doGenerate: async () => {
      if (index >= responses.length) throw new Error("scripted_responses_exhausted");
      const response = responses[index++];
      return {
        content: [
          {
            type: "text",
            text: typeof response === "string" ? response : JSON.stringify(response),
          },
        ],
        finishReason: { unified: "stop", raw: undefined },
        warnings: [],
        usage: {
          inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 0, text: 0, reasoning: 0 },
        },
      };
    },
  });
}
