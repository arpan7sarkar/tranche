import type { ChildProcess } from "node:child_process";
import { type JobSummary, validateSummary } from "./summary";

export type Job = { name: string; everyMs: number; timeoutMs: number };
export type Lock = { lost: Promise<void>; release(): Promise<void> };
export type RuntimeOptions = {
  jobs: readonly Job[];
  acquireLock(name: string): Promise<Lock | null>;
  spawn(name: string): ChildProcess;
  log(event: string, job?: string, summary?: JobSummary): void;
  shutdownGraceMs?: number;
  killGraceMs?: number;
};

type Running = { child?: ChildProcess; done: Promise<void>; terminate?: () => void };

export function createRuntime(options: RuntimeOptions): { start(): void; stop(): Promise<void> } {
  const running = new Map<string, Running>();
  const intervals: NodeJS.Timeout[] = [];
  const killGraceMs = options.killGraceMs ?? 5_000;
  let started = false;
  let stopping = false;
  let stopped: Promise<void> | undefined;

  async function run(job: Job, state: Running): Promise<void> {
    let lock: Lock | null = null;
    try {
      lock = await options.acquireLock(job.name);
      if (!lock) {
        options.log("lock_unavailable", job.name);
        return;
      }
      if (stopping) return;
      let lost = false;
      void lock.lost.then(() => {
        lost = true;
        options.log("lock_lost", job.name);
        state.child?.kill("SIGKILL");
      });
      await Promise.resolve();
      if (lost || stopping) return;
      const child = options.spawn(job.name);
      state.child = child;
      options.log("started", job.name);
      await new Promise<void>((resolve) => {
        let escalation: NodeJS.Timeout | undefined;
        let completed = false;
        let terminated = false;
        let messages = 0;
        let summary: JobSummary | null = null;
        const needsSummary = job.name === "moneyTick" || job.name === "reconcile";
        child.on("message", (message: unknown) => {
          messages++;
          if (messages === 1) summary = validateSummary(job.name, message);
        });
        const terminate = () => {
          if (completed || escalation) return;
          terminated = true;
          child.kill("SIGTERM");
          escalation = setTimeout(() => child.kill("SIGKILL"), killGraceMs);
        };
        state.terminate = terminate;
        const timeout = setTimeout(() => {
          options.log("timeout", job.name);
          terminate();
        }, job.timeoutMs);
        const finish = (event: string) => {
          if (completed) return;
          completed = true;
          clearTimeout(timeout);
          if (escalation) clearTimeout(escalation);
          options.log(event, job.name);
          resolve();
        };
        child.once("error", () => {
          if (child.pid === undefined) finish("spawn_failed");
          else {
            terminated = true;
            options.log("child_error", job.name);
          }
        });
        child.once("exit", (code, signal) => {
          if (code !== 0 || signal || lost || terminated) finish("failed");
          else if (!needsSummary) finish("completed");
        });
        child.once("close", (code, signal) => {
          if (completed) return;
          if (code !== 0 || signal || lost || terminated) return finish("failed");
          if (messages !== 1 || !summary) return finish("summary_invalid");
          options.log("summary", job.name, summary);
          finish("completed");
        });
        if (lost) child.kill("SIGKILL");
      });
    } catch {
      options.log("job_error", job.name);
    } finally {
      if (lock) await lock.release().catch(() => options.log("lock_release_failed", job.name));
    }
  }

  function launch(job: Job) {
    if (stopping || running.has(job.name)) return;
    const state: Running = { done: Promise.resolve() };
    running.set(job.name, state);
    state.done = run(job, state).finally(() => running.delete(job.name));
  }

  return {
    start() {
      if (started || stopping) return;
      started = true;
      for (const job of options.jobs) {
        launch(job);
        intervals.push(setInterval(() => launch(job), job.everyMs));
      }
    },
    stop() {
      stopped ??= (async () => {
        stopping = true;
        for (const interval of intervals) clearInterval(interval);
        if (!running.size) return;
        const done = Promise.all([...running.values()].map((state) => state.done));
        let timer: NodeJS.Timeout | undefined;
        await Promise.race([
          done,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, options.shutdownGraceMs ?? 20_000);
          }),
        ]);
        if (timer) clearTimeout(timer);
        for (const state of running.values()) state.terminate?.();
        if (!running.size) return;
        await Promise.race([
          done,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, killGraceMs + 1_000);
          }),
        ]);
        if (timer) clearTimeout(timer);
      })();
      return stopped;
    },
  };
}
