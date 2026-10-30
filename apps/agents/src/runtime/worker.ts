import { createServer } from "node:http";
import { sql } from "drizzle-orm";
import { agentDb, closeAgentDb } from "../agents/handlers";
import { assertDeployment } from "../deployment/config";
import { deploymentHealth } from "../deployment/health";
import { workerRequest } from "./http";
import { configureSchedules, createQueue, enqueue, initializeQueues } from "./queue";
import { runTask, taskNames } from "./registry";

export async function startWorker() {
  assertDeployment("worker");
  const boss = createQueue();
  boss.on("error", () => console.error("queue_error"));
  const active = process.env.WORKER_MODE === "active";
  const mode = process.env.WORKER_MODE;
  await boss.start();
  await initializeQueues(boss);
  await configureSchedules(boss, active);
  // Health queues prove scheduler delivery even when payment processing is paused.
  for (const [name, cron] of [
    ["healthTick", "* * * * *"],
    ["healthReconcile", "0 * * * *"],
  ] as const) {
    await boss.createQueue(name, {
      policy: "exclusive",
      retryLimit: 2,
      expireInSeconds: 60,
      deleteAfterSeconds: 86400,
    });
    await boss.schedule(name, cron, {}, { singletonKey: name, tz: "UTC" });
    await boss.work(name, async () => {
      const health = await deploymentHealth(agentDb(), "smoke");
      if (!health.ok) throw new Error("worker_unhealthy");
    });
  }
  if (active) {
    for (const name of taskNames) {
      await boss.work<{ args: unknown[] }>(name, { batchSize: 1 }, async ([job]) => {
        if (!job) return;
        try {
          await runTask(name, job.data.args);
        } catch {
          console.error(JSON.stringify({ event: "task_failed", task: name, id: job.id }));
          throw new Error("task_failed");
        }
      });
    }
    // Recover overdue domain timers/events after downtime without replaying every missed cron slot.
    for (const name of ["moneyTick", "consumeAll", "monitor", "notifications", "reconcile"]) {
      await enqueue(boss, name, [], `scheduled:${name}`);
    }
  }
  let closing = false;
  const status = async () => {
    const health = await deploymentHealth(agentDb(), "smoke");
    const rows = await agentDb().execute<{ name: string; observed_at: Date }>(sql`
      select name, max(completed_on) as observed_at from tranche_jobs.job
      where name in ('healthTick', 'healthReconcile') and state = 'completed' group by name`);
    return {
      ...health,
      ok: health.ok && !closing,
      mode,
      cron: rows.map((row) => ({
        ...health,
        source: row.name === "healthTick" ? "cron:tick" : "cron:reconcile",
        observedAt: new Date(row.observed_at).toISOString(),
      })),
    };
  };
  const server = createServer(async (req, res) => {
    const reply = (code: number) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false }));
    };
    if (closing) {
      reply(503);
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16384) {
          reply(413);
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers))
        if (typeof value === "string") headers.set(key, value);
      const request = new Request(`http://worker${req.url ?? "/"}`, {
        method: req.method ?? "GET",
        headers,
        ...(["GET", "HEAD"].includes(req.method ?? "GET") ? {} : { body }),
      });
      const response = await workerRequest(request, {
        token: process.env.WORKER_TOKEN ?? "",
        active,
        status,
        submit: (name, args, key) => enqueue(boss, name, args, key),
      });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    } catch {
      reply(503);
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  const port = Number(process.env.PORT ?? 8080);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", resolve);
  });
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    server.close();
    const kill = setTimeout(() => process.exit(1), 35000);
    kill.unref();
    try {
      await boss.stop({ graceful: true, timeout: 25000 });
      await closeAgentDb();
    } finally {
      clearTimeout(kill);
      process.exit(0);
    }
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  console.log(JSON.stringify({ event: "worker_started", mode, port }));
  return { boss, server };
}
