import { type TaskContext, task } from "@renderinc/sdk/workflows";
import { planDeal, runNegotiation, verifyMilestone } from "@tranche/agents";
import type { PlanDealInput } from "@tranche/contracts";
import { consume, consumers } from "./consumers";
import { agentDb } from "./handlers";
export const runNegotiationTask = task(
  { name: "runNegotiation", timeoutSeconds: 1800 },
  async (_ctx: TaskContext, id: string) => runNegotiation(agentDb(), id),
);
export const planDealTask = task(
  { name: "planDeal", timeoutSeconds: 600 },
  async (_ctx: TaskContext, input: PlanDealInput) => planDeal(agentDb(), input),
);
export const verifyMilestoneTask = task(
  { name: "verifyMilestone", timeoutSeconds: 1800 },
  async (_ctx: TaskContext, eventId: number) => verifyMilestone(agentDb(), eventId),
);
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
