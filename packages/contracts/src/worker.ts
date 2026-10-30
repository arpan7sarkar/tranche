import { z } from "zod";
import { Id } from "./ids";

// Only wakeups needed by the web app are remotely callable.
export const WorkerSubmission = z.discriminatedUnion("task", [
  z
    .object({ task: z.literal("moneyTick"), args: z.tuple([]), key: z.string().min(1).max(200) })
    .strict(),
  z
    .object({
      task: z.literal("runNegotiation"),
      args: z.tuple([Id]),
      key: z.string().min(1).max(200),
    })
    .strict(),
]);
