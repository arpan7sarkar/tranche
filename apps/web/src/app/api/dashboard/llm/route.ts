import {
  runStudioTurn,
  StudioLlmRequest,
  StudioRateLimitError,
} from "@tranche/agents/dashboard/llm";
import { selectModels } from "@tranche/agents/models";
import { memberOrNull } from "@/server/session";

export async function POST(request: Request) {
  if (!(await memberOrNull(request)))
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "invalid_request" }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 256 * 1024) {
      await reader.cancel();
      return Response.json({ error: "request_too_large" }, { status: 413 });
    }
    chunks.push(value);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = StudioLlmRequest.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    return Response.json(await runStudioTurn(parsed.data, selectModels().fast), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof StudioRateLimitError)
      return Response.json({ error: "model_rate_limited" }, { status: 429 });
    console.error("Dashboard assistant unavailable", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return Response.json({ error: "model_unavailable" }, { status: 503 });
  }
}
