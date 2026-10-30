import { WorkerSubmission } from "@tranche/contracts";

export async function launch(
  taskName: string,
  args: unknown[],
  idempotencyKey: string,
  inline: () => Promise<unknown>,
): Promise<void> {
  const body = WorkerSubmission.parse({ task: taskName, args, key: idempotencyKey });
  const origin = process.env.WORKER_URL;
  const token = process.env.WORKER_TOKEN;
  if (!origin && !token && process.env.NODE_ENV !== "production") {
    await inline();
    return;
  }
  if (!origin || !token || token.length < 32) throw new Error("worker_configuration_required");
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password)
    throw new Error("worker_https_origin_required");
  const response = await fetch(`${origin}/jobs`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(5000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status !== 202) throw new Error("worker_submission_failed");
}
