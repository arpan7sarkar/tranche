import { type TaskContext, task } from "@renderinc/sdk/workflows";
import { consume, consumers } from "./consumers";
import { agentDb } from "./handlers";
export const consumeTask = task(
  { name: "consume", timeoutSeconds: 1800 },
  async (_ctx: TaskContext, name: string) => consume(agentDb(), name),
);
export const consumeAllTask = task(
  { name: "consumeAll", timeoutSeconds: 1800 },
  async (ctx: TaskContext) => {
    const counts = await Promise.all(
      consumers.map((consumer) => ctx.run(consumeTask, consumer.name)),
    );
    return counts.reduce((sum, count) => sum + count, 0);
  },
);
