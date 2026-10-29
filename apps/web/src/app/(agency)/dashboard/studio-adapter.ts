import type { StudioTurn } from "@tranche/agents";
import type { AgAiEvent, AgAiOutputItem, AgLlmAdapter, AgLlmResponse } from "ag-studio";

export function turnToStudio(turn: StudioTurn): { events: AgAiEvent[]; response: AgLlmResponse } {
  const events: AgAiEvent[] = [];
  const output: AgAiOutputItem[] = [];
  if (turn.text) {
    const messageId = `${turn.id}-msg`;
    events.push(
      { type: "TEXT_MESSAGE_START", messageId, role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId, delta: turn.text },
      { type: "TEXT_MESSAGE_END", messageId },
    );
    output.push({
      id: messageId,
      kind: "output",
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "text", text: turn.text, annotations: [] }],
    });
  }
  for (const call of turn.toolCalls) {
    events.push(
      { type: "TOOL_CALL_START", toolCallId: call.callId, toolCallName: call.name },
      { type: "TOOL_CALL_ARGS", toolCallId: call.callId, delta: call.arguments },
      { type: "TOOL_CALL_END", toolCallId: call.callId },
    );
    output.push({
      id: call.callId,
      kind: "output",
      type: "function_call",
      callId: call.callId,
      name: call.name,
      arguments: call.arguments,
      status: "completed",
    });
  }
  return { events, response: { id: turn.id, createdAt: Date.now(), status: "completed", output } };
}

export const trancheAdapter: AgLlmAdapter = {
  executeTurn(request, options) {
    const done = fetch("/api/dashboard/llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      ...(options?.signal ? { signal: options.signal } : {}),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`assistant request failed (${res.status})`);
        return turnToStudio((await res.json()) as StudioTurn);
      })
      .catch((error: Error) => ({
        events: [] as AgAiEvent[],
        response: {
          id: crypto.randomUUID(),
          createdAt: Date.now(),
          status: "failed",
          output: [],
          error: { code: "assistant_unavailable", message: error.message },
        } satisfies AgLlmResponse,
      }));
    return {
      stream: {
        async *[Symbol.asyncIterator]() {
          yield* (await done).events;
        },
      },
      complete: done.then((d) => d.response),
    };
  },
};
