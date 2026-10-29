import "./agents/tasks";
import { type TaskContext, task } from "@renderinc/sdk/workflows";
import "./money/tasks";
import { agentDb } from "./agents/handlers";
import { assertDeployment } from "./deployment/config";
import { deploymentHealth } from "./deployment/health";

if (process.env.TRANCHE_DEPLOYMENT === "1") assertDeployment("workflow");

task(
  { name: "deploymentHealth", timeoutSeconds: 60 },
  async (_ctx: TaskContext, source: string = "smoke") => deploymentHealth(agentDb(), source),
);

task({ name: "ping" }, function ping(_ctx: TaskContext): string {
  return "pong";
});
