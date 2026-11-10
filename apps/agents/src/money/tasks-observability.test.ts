import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  task: vi.fn(),
  assertMoneyConfig: vi.fn(),
  moneyTick: vi.fn(async () => ({
    timersAttempted: 1,
    inboxAttempted: 2,
    actionsAttempted: 3,
    outboxAttempted: 4,
  })),
  reconcile: vi.fn(async () => ({
    checked: 1,
    mismatches: 0,
    recovered: 0,
    unavailable: 0,
    unknown: 0,
  })),
}));
vi.mock("@renderinc/sdk/workflows", () => ({ task: mocks.task }));
vi.mock("./deps", () => ({ assertMoneyConfig: mocks.assertMoneyConfig }));
vi.mock("./handlers", () => ({
  MONEY_HANDLERS: { moneyTick: mocks.moneyTick, reconcile: mocks.reconcile },
}));

it("registers and executes both Render money tasks with aggregate-returning handlers", async () => {
  await import("./tasks");
  expect(mocks.assertMoneyConfig).toHaveBeenCalledOnce();
  expect(mocks.task).toHaveBeenCalledTimes(2);
  expect(mocks.task.mock.calls.map(([config]) => config.name)).toEqual(["moneyTick", "reconcile"]);
  for (const [, run] of mocks.task.mock.calls) {
    expect(await run({})).toBeUndefined();
  }
  expect(mocks.moneyTick).toHaveBeenCalledOnce();
  expect(mocks.reconcile).toHaveBeenCalledOnce();
});
