import assert from "node:assert/strict";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireJobLock, type LockSession, type OpenLockSession } from "./lock";

function session() {
  let onClose = () => {};
  const adapter = {
    acquire: vi.fn(async (_name: string) => true),
    heartbeat: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  } satisfies LockSession;
  const open: OpenLockSession = async (closed) => {
    onClose = closed;
    return adapter;
  };
  return { adapter, open, disconnect: () => onClose() };
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("dedicated job lock", () => {
  it("closes its session when the lock is unavailable or acquisition errors", async () => {
    const unavailable = session();
    unavailable.adapter.acquire.mockResolvedValueOnce(false);
    expect(await acquireJobLock("moneyTick", unavailable.open)).toBeNull();
    expect(unavailable.adapter.acquire).toHaveBeenCalledWith("moneyTick");
    expect(unavailable.adapter.close).toHaveBeenCalledOnce();

    const error = session();
    error.adapter.acquire.mockRejectedValueOnce(new Error("private database detail"));
    await expect(acquireJobLock("moneyTick", error.open)).rejects.toThrow();
    expect(error.adapter.close).toHaveBeenCalledOnce();
  });

  it("fails closed if the session closes while acquisition is pending", async () => {
    const ctx = session();
    let resolveAcquire!: (acquired: boolean) => void;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    ctx.adapter.acquire.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAcquire = resolve;
          signalStarted();
        }),
    );
    const acquiring = acquireJobLock("moneyTick", ctx.open);
    await started;
    ctx.disconnect();
    resolveAcquire(true);
    await expect(acquiring).rejects.toThrow();
    expect(ctx.adapter.close).toHaveBeenCalledOnce();
  });

  it("times out a stuck session open and closes a late session", async () => {
    vi.useFakeTimers();
    const ctx = session();
    let resolveOpen!: (session: LockSession) => void;
    const opening = acquireJobLock(
      "consume:planner",
      () =>
        new Promise((resolve) => {
          resolveOpen = resolve;
        }),
    );
    const rejected = expect(opening).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    resolveOpen(ctx.adapter);
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.adapter.close).toHaveBeenCalledOnce();
    expect(ctx.adapter.acquire).not.toHaveBeenCalled();
  });

  it("times out stuck lock acquisition and closes its session", async () => {
    vi.useFakeTimers();
    const ctx = session();
    ctx.adapter.acquire.mockImplementationOnce(() => new Promise(() => {}));
    const acquiring = acquireJobLock("consume:verifier", ctx.open);
    const rejected = expect(acquiring).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(ctx.adapter.acquire).toHaveBeenCalledWith("consume:verifier");
    expect(ctx.adapter.close).toHaveBeenCalledOnce();
  });

  it("signals loss immediately when the session closes", async () => {
    vi.useFakeTimers();
    const ctx = session();
    const lock = await acquireJobLock("moneyTick", ctx.open);
    assert(lock);
    const lost = vi.fn();
    void lock.lost.then(lost);
    ctx.disconnect();
    await vi.advanceTimersByTimeAsync(0);
    expect(lost).toHaveBeenCalledOnce();
    await lock.release();
  });

  it("signals loss when heartbeat rejects", async () => {
    vi.useFakeTimers();
    const ctx = session();
    ctx.adapter.heartbeat.mockRejectedValueOnce(new Error("heartbeat failed"));
    const lock = await acquireJobLock("moneyTick", ctx.open);
    assert(lock);
    const lost = vi.fn();
    void lock.lost.then(lost);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(lost).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.adapter.heartbeat).toHaveBeenCalledOnce();
    expect(lost).toHaveBeenCalledOnce();
    await lock.release();
  });

  it("signals loss when a heartbeat exceeds its five-second deadline", async () => {
    vi.useFakeTimers();
    const ctx = session();
    ctx.adapter.heartbeat.mockImplementationOnce(() => new Promise(() => {}));
    const lock = await acquireJobLock("moneyTick", ctx.open);
    assert(lock);
    const lost = vi.fn();
    void lock.lost.then(lost);
    await vi.advanceTimersByTimeAsync(6_999);
    expect(lost).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(lost).toHaveBeenCalledOnce();
    await lock.release();
  });

  it("continues successful heartbeats and stops monitoring after release", async () => {
    vi.useFakeTimers();
    const ctx = session();
    const lock = await acquireJobLock("moneyTick", ctx.open);
    assert(lock);
    const lost = vi.fn();
    void lock.lost.then(lost);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(ctx.adapter.heartbeat).toHaveBeenCalledTimes(2);
    await lock.release();
    await lock.release();
    ctx.disconnect();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ctx.adapter.heartbeat).toHaveBeenCalledTimes(2);
    expect(ctx.adapter.close).toHaveBeenCalledOnce();
    expect(lost).not.toHaveBeenCalled();
  });
});
