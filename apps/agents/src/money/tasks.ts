import { type TaskContext, task } from "@renderinc/sdk/workflows";
import { assertMoneyConfig } from "./deps";
import { MONEY_HANDLERS } from "./handlers";

assertMoneyConfig();

for (const [name, run] of Object.entries(MONEY_HANDLERS)) {
  task({ name }, async (_ctx: TaskContext) => {
    await run();
  });
}
