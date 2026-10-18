import type { TaskContext } from "@renderinc/sdk/workflows";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ consume: vi.fn(async () => 2), db: {} }));
vi.mock("./handlers", () => ({ agentDb: () => mocks.db }));
vi.mock("./consumers", () => ({
  consume: mocks.consume,
  consumers: [{ name: "one" }, { name: "two" }],
}));

import { consumeAllTask, consumeTask } from "./tasks";

it("registers executable Render tasks and fans out each named consumer", async () => {
  const run = vi.fn(async () => 2);
  const ctx = { metadata: {}, run } as TaskContext;
  expect(await consumeTask.func(ctx, "one")).toBe(2);
  expect(mocks.consume).toHaveBeenCalledWith(mocks.db, "one");
  expect(await consumeAllTask.func(ctx)).toBe(4);
  expect(run).toHaveBeenNthCalledWith(1, consumeTask, "one");
  expect(run).toHaveBeenNthCalledWith(2, consumeTask, "two");
});
