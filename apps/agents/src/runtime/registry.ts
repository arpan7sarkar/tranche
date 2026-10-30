import { planDeal, runNegotiation, verifyMilestone } from "@tranche/agents";
import { Id, PlanDealInput } from "@tranche/contracts";
import { z } from "zod";
import { consume, consumers } from "../agents/consumers";
import { AGENT_HANDLERS, agentDb } from "../agents/handlers";
import { MONEY_HANDLERS } from "../money/handlers";

export const taskNames = [
  "moneyTick",
  "reconcile",
  "notifications",
  "monitor",
  "consumeAll",
  "consume",
  "runNegotiation",
  "planDeal",
  "verifyMilestone",
] as const;
export type TaskName = (typeof taskNames)[number];

export function validateTask(name: string, args: unknown[]): TaskName {
  const task = z.enum(taskNames).parse(name);
  switch (task) {
    case "runNegotiation":
      z.tuple([Id]).parse(args);
      break;
    case "planDeal":
      z.tuple([PlanDealInput]).parse(args);
      break;
    case "verifyMilestone":
      z.tuple([z.number().int().positive()]).parse(args);
      break;
    case "consume":
      z.tuple([z.enum(["planner", "verifier", "negotiator"])]).parse(args);
      break;
    default:
      z.tuple([]).parse(args);
  }
  return task;
}

export async function runTask(name: string, args: unknown[]): Promise<void> {
  const task = validateTask(name, args);
  if (task === "consumeAll") {
    const results = await Promise.allSettled(consumers.map((c) => consume(agentDb(), c.name)));
    if (results.some((r) => r.status === "rejected")) throw new Error("consumer_task_failed");
  } else if (task === "consume") await consume(agentDb(), String(args[0]));
  else if (task === "runNegotiation") await runNegotiation(agentDb(), Id.parse(args[0]));
  else if (task === "planDeal") await planDeal(agentDb(), PlanDealInput.parse(args[0]));
  else if (task === "verifyMilestone") await verifyMilestone(agentDb(), Number(args[0]));
  else {
    const handler = MONEY_HANDLERS[task] ?? AGENT_HANDLERS[task];
    if (!handler) throw new Error("unknown_task");
    await handler();
  }
}
