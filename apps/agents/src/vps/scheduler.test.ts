import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertConsumerRegistry, consumerForJob, selectVpsJobs, VPS_JOBS } from "./jobs";
import { createRuntime, type Job, type Lock } from "./scheduler";

const { moneyModuleLoaded, agentModuleLoaded, consumerModuleLoaded, fakeAcquireLock, registry } =
  vi.hoisted(() => ({
    moneyModuleLoaded: vi.fn(),
    agentModuleLoaded: vi.fn(),
    consumerModuleLoaded: vi.fn(),
    fakeAcquireLock: vi.fn(),
    registry: [{ name: "planner" }, { name: "verifier" }, { name: "negotiator" }],
  }));
vi.mock("../agents/handlers", () => {
  agentModuleLoaded();
  return { AGENT_HANDLERS: {} };
});
vi.mock("../agents/consumers", () => {
  consumerModuleLoaded();
  return { consumers: registry };
});
vi.mock("./lock", () => ({ acquireJobLock: fakeAcquireLock }));
vi.mock("../money/handlers", () => {
  moneyModuleLoaded();
  return { MONEY_HANDLERS: { moneyTick: vi.fn(), reconcile: vi.fn() } };
});

const jobs: Job[] = VPS_JOBS.map((job) => ({ ...job, timeoutMs: 600_000 }));

function required<T>(value: T | undefined): T {
  assert(value !== undefined);
  return value;
}

class FakeChild extends EventEmitter {
  constructor(private readonly job: string) {
    super();
  }
  kill = vi.fn((_signal?: NodeJS.Signals | number) => true);
  exit(code = 0, signal: NodeJS.Signals | null = null) {
    if (code === 0 && signal === null && this.job === "moneyTick") {
      this.emit("message", {
        type: "summary",
        job: "moneyTick",
        timersAttempted: 0,
        inboxAttempted: 0,
        actionsAttempted: 0,
        outboxAttempted: 0,
      });
    }
    if (code === 0 && signal === null && this.job === "reconcile") {
      this.emit("message", {
        type: "summary",
        job: "reconcile",
        checked: 0,
        mismatches: 0,
        recovered: 0,
        unavailable: 0,
        unknown: 0,
      });
    }
    this.emit("exit", code, signal);
    this.emit("close", code, signal);
  }
}

function makeLock() {
  let lose!: () => void;
  const lost = new Promise<void>((resolve) => {
    lose = resolve;
  });
  const release = vi.fn(async () => {});
  return { lock: { lost, release } satisfies Lock, lose, release };
}

function setup(selectedJobs = jobs) {
  const children: { name: string; child: FakeChild }[] = [];
  const locks: ReturnType<typeof makeLock>[] = [];
  const acquireLock = vi.fn(async (_name: string): Promise<Lock | null> => {
    const entry = makeLock();
    locks.push(entry);
    return entry.lock;
  });
  const spawn = vi.fn((name: string) => {
    const child = new FakeChild(name);
    children.push({ name, child });
    return child as unknown as ChildProcess;
  });
  const log = vi.fn();
  const runtime = createRuntime({
    jobs: selectedJobs,
    acquireLock,
    spawn,
    log,
    shutdownGraceMs: 100,
    killGraceMs: 50,
  });
  return { runtime, children, locks, acquireLock, spawn, log };
}

async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

async function finishAll(children: { child: FakeChild }[]) {
  for (const { child } of children) child.exit();
  await flush();
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("VPS scheduler", () => {
  it("defaults money jobs off and only enables them with an explicit opt-in", () => {
    const expected = [
      "consume:planner",
      "consume:verifier",
      "consume:negotiator",
      "notifications",
      "monitor",
    ].sort();
    for (const value of [undefined, "", "0", "true", "yes"]) {
      expect(
        selectVpsJobs({ VPS_MONEY_ENABLED: value })
          .map(({ name }) => name)
          .sort(),
      ).toEqual(expected);
    }
    expect(
      selectVpsJobs({ VPS_MONEY_ENABLED: "1" })
        .map(({ name }) => name)
        .sort(),
    ).toEqual([...expected, "moneyTick", "reconcile"].sort());
  });

  it("does not lock or spawn money jobs on a default runtime tick", async () => {
    vi.useFakeTimers();
    const ctx = setup([...selectVpsJobs({})]);
    ctx.runtime.start();
    await flush();
    const names = ctx.children.map(({ name }) => name).sort();
    expect(names).toEqual([
      "consume:negotiator",
      "consume:planner",
      "consume:verifier",
      "monitor",
      "notifications",
    ]);
    expect(ctx.acquireLock.mock.calls.map(([name]) => name).sort()).toEqual(names);
    await finishAll(ctx.children);
    await ctx.runtime.stop();
  });

  it("rejects direct money child dispatch without importing money handlers by default", async () => {
    const argv = process.argv;
    const listeners = process.listeners("disconnect");
    const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit:${code}`);
    });
    try {
      for (const name of ["moneyTick", "reconcile"]) {
        for (const enabled of [undefined, "0", "true"]) {
          vi.resetModules();
          vi.stubEnv("VPS_MONEY_ENABLED", enabled);
          process.argv = [process.execPath, "job", name];
          await expect(import("./job")).rejects.toThrow("exit:1");
          expect(moneyModuleLoaded).not.toHaveBeenCalled();
        }
      }
    } finally {
      process.argv = argv;
      vi.unstubAllEnvs();
      exit.mockRestore();
      for (const listener of process.listeners("disconnect")) {
        if (!listeners.includes(listener)) process.removeListener("disconnect", listener);
      }
    }
  });

  it("rejects unknown and legacy child jobs before importing any handlers", async () => {
    const argv = process.argv;
    const listeners = process.listeners("disconnect");
    const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit:${code}`);
    });
    try {
      for (const name of ["unknown", "consumeAll", "consume:unknown"]) {
        vi.resetModules();
        vi.stubEnv("VPS_MONEY_ENABLED", "1");
        process.argv = [process.execPath, "job", name];
        await expect(import("./job")).rejects.toThrow("exit:1");
        expect(moneyModuleLoaded).not.toHaveBeenCalled();
        expect(agentModuleLoaded).not.toHaveBeenCalled();
        expect(consumerModuleLoaded).not.toHaveBeenCalled();
      }
    } finally {
      process.argv = argv;
      vi.unstubAllEnvs();
      exit.mockRestore();
      for (const listener of process.listeners("disconnect")) {
        if (!listeners.includes(listener)) process.removeListener("disconnect", listener);
      }
    }
  });

  it("rejects missing, duplicate, and extra consumer registry entries", () => {
    const valid = [{ name: "planner" }, { name: "verifier" }, { name: "negotiator" }];
    expect(() => assertConsumerRegistry(valid)).not.toThrow();
    for (const invalid of [
      valid.slice(1),
      [{ name: "planner" }, { name: "verifier" }, { name: "verifier" }],
      [...valid, { name: "extra" }],
    ]) {
      expect(() => assertConsumerRegistry(invalid)).toThrow("consumer_registry_diverged");
    }
  });

  it("fails startup on registry divergence before constructing a runtime or acquiring locks", async () => {
    vi.resetModules();
    registry.pop();
    const currentScheduler = await import("./scheduler");
    const create = vi.spyOn(currentScheduler, "createRuntime");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit:${code}`);
    });
    try {
      await expect(import("./index")).rejects.toThrow("exit:1");
      expect(error).toHaveBeenCalledWith(
        JSON.stringify({ component: "vps_runtime", event: "consumer_registry_diverged" }),
      );
      expect(create).not.toHaveBeenCalled();
      expect(fakeAcquireLock).not.toHaveBeenCalled();
    } finally {
      registry.push({ name: "negotiator" });
      create.mockRestore();
      error.mockRestore();
      exit.mockRestore();
    }
  });

  it("schedules each known consumer separately with a bounded deadline", () => {
    const consumers = VPS_JOBS.filter(({ name }) => name.startsWith("consume:"));
    expect(consumers.map(({ name }) => name).sort()).toEqual([
      "consume:negotiator",
      "consume:planner",
      "consume:verifier",
    ]);
    for (const job of consumers) {
      expect(consumerForJob(job.name)).toBe(job.name.slice("consume:".length));
      expect(job.everyMs).toBe(60_000);
      expect(job.timeoutMs).toBe(1_800_000);
    }
    expect(consumerForJob("consume:unknown")).toBeUndefined();
  });

  it("runs all explicitly enabled jobs immediately and at their configured cadence", async () => {
    vi.useFakeTimers();
    const ctx = setup();
    ctx.runtime.start();
    await flush();
    expect(ctx.children.map(({ name }) => name).sort()).toEqual(
      jobs.map(({ name }) => name).sort(),
    );
    await finishAll(ctx.children);
    for (let minute = 1; minute <= 60; minute++) {
      await vi.advanceTimersByTimeAsync(60_000);
      await finishAll(ctx.children.slice());
    }
    const counts = Object.fromEntries(
      jobs.map(({ name }) => [name, ctx.children.filter((child) => child.name === name).length]),
    );
    expect(counts).toEqual({
      moneyTick: 61,
      "consume:planner": 61,
      "consume:verifier": 61,
      "consume:negotiator": 61,
      notifications: 61,
      monitor: 13,
      reconcile: 2,
    });
    await ctx.runtime.stop();
  });

  it("does not overlap a hung consumer or block other consumers and enabled money jobs", async () => {
    vi.useFakeTimers();
    const ctx = setup();
    ctx.runtime.start();
    await flush();
    await finishAll(ctx.children.filter(({ name }) => name !== "consume:planner"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ctx.children.filter(({ name }) => name === "consume:planner")).toHaveLength(1);
    expect(ctx.children.filter(({ name }) => name === "consume:verifier")).toHaveLength(2);
    expect(ctx.children.filter(({ name }) => name === "consume:negotiator")).toHaveLength(2);
    expect(ctx.children.filter(({ name }) => name === "moneyTick")).toHaveLength(2);
    await finishAll(ctx.children);
    await ctx.runtime.stop();
  });

  it("fails closed if the lock is unavailable or acquisition throws, then retries", async () => {
    vi.useFakeTimers();
    const ctx = setup([required(jobs[0])]);
    ctx.acquireLock
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("lock unavailable"));
    ctx.runtime.start();
    await flush();
    expect(ctx.spawn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ctx.spawn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ctx.spawn).toHaveBeenCalledTimes(1);
    await finishAll(ctx.children);
    await ctx.runtime.stop();
  });

  it("does not spawn a child when shutdown races with lock acquisition", async () => {
    vi.useFakeTimers();
    const ctx = setup([required(jobs[0])]);
    let resolveLock!: (lock: Lock | null) => void;
    ctx.acquireLock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLock = resolve;
        }),
    );
    ctx.runtime.start();
    await flush();
    const stopping = ctx.runtime.stop();
    const entry = makeLock();
    resolveLock(entry.lock);
    await flush();
    await stopping;
    expect(ctx.spawn).not.toHaveBeenCalled();
    expect(entry.release).toHaveBeenCalledOnce();
  });

  it("kills the child immediately on lock loss and releases the lock after exit", async () => {
    vi.useFakeTimers();
    const ctx = setup([required(jobs[0])]);
    ctx.runtime.start();
    await flush();
    const child = required(ctx.children[0]).child;
    const lock = required(ctx.locks[0]);
    lock.lose();
    await flush();
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(lock.release).not.toHaveBeenCalled();
    child.exit(null as unknown as number, "SIGKILL");
    await flush();
    expect(lock.release).toHaveBeenCalledOnce();
    await ctx.runtime.stop();
  });

  it("retries after a failed exit or child process error", async () => {
    vi.useFakeTimers();
    const ctx = setup([required(jobs[0])]);
    ctx.runtime.start();
    await flush();
    required(ctx.children[0]).child.exit(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ctx.spawn).toHaveBeenCalledTimes(2);
    required(ctx.children[1]).child.emit("error", new Error("spawn failed"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ctx.spawn).toHaveBeenCalledTimes(3);
    await finishAll(ctx.children);
    await ctx.runtime.stop();
  });

  it("sends SIGTERM at timeout and escalates to SIGKILL after the configured grace", async () => {
    vi.useFakeTimers();
    const ctx = setup([{ ...required(jobs[0]), timeoutMs: 1_000 }]);
    ctx.runtime.start();
    await flush();
    const child = required(ctx.children[0]).child;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(child.kill).not.toHaveBeenCalledWith("SIGKILL");
    await vi.advanceTimersByTimeAsync(50);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    child.exit(null as unknown as number, "SIGKILL");
    await flush();
    await vi.advanceTimersByTimeAsync(60_000 - 1_050);
    expect(ctx.spawn).toHaveBeenCalledTimes(2);
    await finishAll(ctx.children);
    await ctx.runtime.stop();
  });

  it("stops scheduling, allows grace, then terminates and escalates before shutdown completes", async () => {
    vi.useFakeTimers();
    const ctx = setup([required(jobs[0])]);
    ctx.runtime.start();
    await flush();
    const child = required(ctx.children[0]).child;
    const stopping = ctx.runtime.stop();
    await vi.advanceTimersByTimeAsync(99);
    expect(child.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    await vi.advanceTimersByTimeAsync(50);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    child.exit(null as unknown as number, "SIGKILL");
    await flush();
    await stopping;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(ctx.spawn).toHaveBeenCalledTimes(1);
    expect(required(ctx.locks[0]).release).toHaveBeenCalledOnce();
  });
});
