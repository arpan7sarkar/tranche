import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntime, type Lock } from "./scheduler";
import { sendSummary, validateSummary } from "./summary";

const tick = {
  type: "summary",
  job: "moneyTick",
  timersAttempted: 1,
  inboxAttempted: 2,
  actionsAttempted: 3,
  outboxAttempted: 4,
} as const;
const reconciliation = {
  type: "summary",
  job: "reconcile",
  checked: 3,
  mismatches: 1,
  recovered: 0,
  unavailable: 1,
  unknown: 1,
} as const;
const secret = "synthetic-secret-must-never-appear";

class FakeChild extends EventEmitter {
  kill = vi.fn(() => true);
  pid = 123;
  exit(code: number | null = 0, signal: NodeJS.Signals | null = null) {
    this.emit("exit", code, signal);
  }
  close(code: number | null = 0, signal: NodeJS.Signals | null = null) {
    this.emit("close", code, signal);
  }
}

function setup(name = "moneyTick") {
  const child = new FakeChild();
  let lose!: () => void;
  const lock: Lock = {
    lost: new Promise<void>((resolve) => {
      lose = resolve;
    }),
    release: vi.fn(async () => {}),
  };
  const acquireLock = vi.fn(async (): Promise<Lock | null> => lock);
  const log = vi.fn();
  const runtime = createRuntime({
    jobs: [{ name, everyMs: 60_000, timeoutMs: 1_000 }],
    acquireLock,
    spawn: () => child as unknown as ChildProcess,
    log,
    shutdownGraceMs: 100,
    killGraceMs: 50,
  });
  return { child, lock, lose, acquireLock, log, runtime };
}

async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("strict child summary validation", () => {
  it("accepts only matching allowlisted aggregate messages", () => {
    expect(validateSummary("moneyTick", tick)).toEqual(tick);
    expect(validateSummary("reconcile", reconciliation)).toEqual(reconciliation);
    expect(validateSummary("reconcile", tick)).toBeNull();
    expect(validateSummary("moneyTick", reconciliation)).toBeNull();
    expect(validateSummary("unknown", tick)).toBeNull();
    expect(validateSummary("reconcile", { ...reconciliation, unknown: -1 })).toBeNull();
    expect(validateSummary("reconcile", { ...reconciliation, unavailable: secret })).toBeNull();
    expect(validateSummary("reconcile", { ...reconciliation, detail: secret })).toBeNull();
  });

  it.each([
    null,
    [],
    secret,
    {},
    { ...tick, token: secret },
    { ...tick, timersAttempted: -1 },
    { ...tick, timersAttempted: 0.5 },
    { ...tick, timersAttempted: Number.MAX_SAFE_INTEGER + 1 },
    { ...tick, timersAttempted: Number.NaN },
    { ...tick, timersAttempted: Number.POSITIVE_INFINITY },
    { ...tick, timersAttempted: "1" },
    { ...tick, timersAttempted: undefined },
    { ...tick, type: "error" },
    { ...reconciliation, unknown: -1 },
  ])("rejects malformed or overbroad message %j", (message) => {
    expect(validateSummary("moneyTick", message)).toBeNull();
  });

  it("accepts zero and maximum safe integers without treating zero as healthy", () => {
    const input = { ...reconciliation, checked: 0, unknown: Number.MAX_SAFE_INTEGER };
    expect(validateSummary("reconcile", input)).toEqual(input);
  });
});

describe("child summary delivery", () => {
  it("waits for the sender callback before resolving", async () => {
    let callback!: (error: Error | null) => void;
    const send = vi.fn((_message: unknown, done: (error: Error | null) => void) => {
      callback = done;
    });
    let settled = false;
    const sending = sendSummary(tick, send).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(send).toHaveBeenCalledWith(tick, expect.any(Function));
    expect(settled).toBe(false);
    callback(null);
    await sending;
    expect(settled).toBe(true);
  });

  it("rejects callback and synchronous send errors", async () => {
    const failure = new Error("synthetic send failure");
    await expect(sendSummary(tick, (_message, callback) => callback(failure))).rejects.toBe(
      failure,
    );
    await expect(
      sendSummary(tick, () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });
});

describe("scheduler IPC observability", () => {
  it.each([
    ["moneyTick", tick],
    ["reconcile", reconciliation],
  ] as const)("logs the valid %s aggregate only after successful exit", async (job, summary) => {
    const test = setup(job);
    test.runtime.start();
    await flush();
    test.child.emit("message", summary);
    expect(test.log).not.toHaveBeenCalledWith("summary", job, expect.anything());
    expect(test.log).not.toHaveBeenCalledWith("completed", job);
    test.child.exit();
    await flush();
    expect(test.log).not.toHaveBeenCalledWith("summary", job, expect.anything());
    expect(test.log).not.toHaveBeenCalledWith("completed", job);
    test.child.close();
    await flush();
    expect(test.log).toHaveBeenCalledWith("summary", job, summary);
    expect(test.log).toHaveBeenCalledWith("completed", job);
    const events = test.log.mock.calls.map(([event]) => event);
    expect(events.indexOf("summary")).toBeLessThan(events.indexOf("completed"));
    await test.runtime.stop();
  });

  it.each([
    ["absent", []],
    ["duplicate", [tick, tick]],
    ["extra data", [{ ...tick, token: secret }]],
    ["wrong job", [reconciliation]],
    ["invalid count", [{ ...tick, timersAttempted: secret }]],
    ["valid followed by invalid", [tick, { ...tick, token: secret }]],
    ["invalid followed by valid", [{ ...tick, token: secret }, tick]],
  ])("rejects %s without logging untrusted content", async (_label, messages) => {
    const test = setup();
    test.runtime.start();
    await flush();
    for (const message of messages) test.child.emit("message", message);
    test.child.exit();
    test.child.close();
    await flush();
    expect(test.log).toHaveBeenCalledWith("summary_invalid", "moneyTick");
    expect(test.log).not.toHaveBeenCalledWith("summary", expect.anything(), expect.anything());
    expect(test.log).not.toHaveBeenCalledWith("completed", "moneyTick");
    expect(JSON.stringify(test.log.mock.calls)).not.toContain(secret);
    await test.runtime.stop();
  });

  it("accepts a valid message arriving between exit and close", async () => {
    const test = setup();
    test.runtime.start();
    await flush();
    test.child.exit();
    await flush();
    expect(test.log).not.toHaveBeenCalledWith("summary_invalid", "moneyTick");
    test.child.emit("message", tick);
    test.child.close();
    await flush();
    expect(test.log).toHaveBeenCalledWith("summary", "moneyTick", tick);
    expect(test.log).toHaveBeenCalledWith("completed", "moneyTick");
    await test.runtime.stop();
  });

  it("rejects a duplicate arriving between exit and close", async () => {
    const test = setup();
    test.runtime.start();
    await flush();
    test.child.emit("message", tick);
    test.child.exit();
    test.child.emit("message", tick);
    test.child.close();
    await flush();
    expect(test.log).toHaveBeenCalledWith("summary_invalid", "moneyTick");
    expect(test.log).not.toHaveBeenCalledWith("completed", "moneyTick");
    expect(test.log).not.toHaveBeenCalledWith("summary", expect.anything(), expect.anything());
    await test.runtime.stop();
  });

  it.each([
    [1, null],
    [null, "SIGTERM"],
  ] as const)("does not log a summary for failure exit %s/%s", async (code, signal) => {
    const test = setup();
    test.runtime.start();
    await flush();
    test.child.emit("message", tick);
    test.child.exit(code, signal);
    await flush();
    expect(test.log).toHaveBeenCalledWith("failed", "moneyTick");
    expect(test.log).not.toHaveBeenCalledWith("summary", expect.anything(), expect.anything());
    expect(test.log).not.toHaveBeenCalledWith("completed", "moneyTick");
    await test.runtime.stop();
  });

  it("does not report success after timeout even if the child exits zero", async () => {
    const test = setup();
    test.runtime.start();
    await flush();
    test.child.emit("message", tick);
    await vi.advanceTimersByTimeAsync(1_000);
    test.child.exit();
    await flush();
    expect(test.log).toHaveBeenCalledWith("timeout", "moneyTick");
    expect(test.log).toHaveBeenCalledWith("failed", "moneyTick");
    expect(test.log).not.toHaveBeenCalledWith("completed", "moneyTick");
    expect(test.log).not.toHaveBeenCalledWith("summary", expect.anything(), expect.anything());
    await test.runtime.stop();
  });

  it("does not report success after lock loss even if the child exits zero", async () => {
    const test = setup();
    test.runtime.start();
    await flush();
    test.child.emit("message", tick);
    test.lose();
    await flush();
    test.child.exit();
    await flush();
    expect(test.log).toHaveBeenCalledWith("lock_lost", "moneyTick");
    expect(test.log).toHaveBeenCalledWith("failed", "moneyTick");
    expect(test.log).not.toHaveBeenCalledWith("completed", "moneyTick");
    expect(test.log).not.toHaveBeenCalledWith("summary", expect.anything(), expect.anything());
    await test.runtime.stop();
  });

  it("does not report success after shutdown termination even if the child exits zero", async () => {
    const test = setup();
    test.runtime.start();
    await flush();
    test.child.emit("message", tick);
    const stopping = test.runtime.stop();
    await vi.advanceTimersByTimeAsync(100);
    expect(test.child.kill).toHaveBeenCalledWith("SIGTERM");
    test.child.exit();
    await flush();
    await stopping;
    expect(test.log).toHaveBeenCalledWith("failed", "moneyTick");
    expect(test.log).not.toHaveBeenCalledWith("completed", "moneyTick");
    expect(test.log).not.toHaveBeenCalledWith("summary", expect.anything(), expect.anything());
  });

  it("does not spawn or report success when the lock is unavailable", async () => {
    const test = setup();
    test.acquireLock.mockResolvedValueOnce(null);
    test.runtime.start();
    await flush();
    expect(test.log).toHaveBeenCalledWith("lock_unavailable", "moneyTick");
    expect(test.child.eventNames()).toEqual([]);
    expect(test.log).not.toHaveBeenCalledWith("completed", "moneyTick");
    await test.runtime.stop();
  });

  it("keeps ordinary non-money jobs independent of money summary messages", async () => {
    const test = setup("monitor");
    test.runtime.start();
    await flush();
    test.child.emit("message", { error: secret });
    test.child.exit();
    await flush();
    expect(test.log).toHaveBeenCalledWith("completed", "monitor");
    expect(test.log).not.toHaveBeenCalledWith("summary", expect.anything(), expect.anything());
    expect(JSON.stringify(test.log.mock.calls)).not.toContain(secret);
    await test.runtime.stop();
  });
});
