import { type TaskContext, task } from "@renderinc/sdk/workflows";

task({ name: "ping" }, function ping(_ctx: TaskContext): string {
  return "pong";
});
