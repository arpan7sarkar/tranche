import { timingSafeEqual } from "node:crypto";
import { WorkerSubmission } from "@tranche/contracts";

export type WorkerHttpDeps = {
  token: string;
  active: boolean;
  status: () => Promise<unknown>;
  submit: (name: string, args: unknown[], key: string) => Promise<unknown>;
};
export async function workerRequest(request: Request, deps: WorkerHttpDeps): Promise<Response> {
  const path = new URL(request.url).pathname;
  const json = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${deps.token}`);
  if (
    deps.token.length < 32 ||
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    return json({ error: "unauthorized" }, 401);
  if (path === "/status" && request.method === "GET") {
    try {
      return json(await deps.status());
    } catch {
      return json({ ok: false }, 503);
    }
  }
  if (path !== "/jobs" || request.method !== "POST") return json({ error: "not_found" }, 404);
  if (!deps.active) return json({ error: "worker_paused" }, 503);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return json({ error: "content_type" }, 415);
  const text = await request.text();
  if (Buffer.byteLength(text) > 16384) return json({ error: "payload_too_large" }, 413);
  let input: ReturnType<typeof WorkerSubmission.parse>;
  try {
    input = WorkerSubmission.parse(JSON.parse(text));
  } catch {
    return json({ error: "invalid_job" }, 400);
  }
  try {
    await deps.submit(input.task, input.args, input.key);
    return json({ accepted: true }, 202);
  } catch {
    return json({ error: "queue_unavailable" }, 503);
  }
}
