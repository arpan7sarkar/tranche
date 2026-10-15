import { type TaskContext, task } from "@renderinc/sdk/workflows";
import "./money/tasks";

task({ name: "ping" }, function ping(_ctx: TaskContext): string {
  return "pong";
});
