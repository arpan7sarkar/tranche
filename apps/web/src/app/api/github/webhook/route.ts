import { getDb } from "@/server/db";
import { recordGitHubDelivery, verifyGitHubSignature } from "@/server/github-deliveries";
import { kickMoneyTick } from "@/server/kick";

export async function POST(request: Request) {
  if (!process.env.GITHUB_WEBHOOK_SECRET)
    return Response.json({ error: "Webhook is not configured" }, { status: 503 });
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1_000_000) {
      await reader.cancel();
      return new Response(null, { status: 413 });
    }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  if (
    !verifyGitHubSignature(
      process.env.GITHUB_WEBHOOK_SECRET,
      body,
      request.headers.get("x-hub-signature-256"),
    )
  )
    return new Response(null, { status: 401 });
  if (request.headers.get("x-github-event") !== "pull_request")
    return new Response(null, { status: 204 });
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response(null, { status: 400 });
  }
  const recorded = await recordGitHubDelivery(getDb(), payload);
  if (recorded) kickMoneyTick();
  return Response.json({ recorded }, { status: 202 });
}
