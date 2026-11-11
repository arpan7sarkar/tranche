import { consumerForJob, isMoneyJob, moneyEnabled, VPS_JOBS } from "./jobs";
import { sendSummary } from "./summary";

process.once("disconnect", () => process.exit(1));

const name = process.argv[2];
if (!name || !VPS_JOBS.some((job) => job.name === name)) process.exit(1);
if (isMoneyJob(name) && !moneyEnabled(process.env)) process.exit(1);

try {
  const consumer = consumerForJob(name);
  if (consumer) {
    const [{ consume }, { agentDb }] = await Promise.all([
      import("../agents/consumers"),
      import("../agents/handlers"),
    ]);
    await consume(agentDb(), consumer);
  } else if (isMoneyJob(name)) {
    const { MONEY_HANDLERS } = await import("../money/handlers");
    if (!process.send) process.exit(1);
    const send = (
      message: Parameters<typeof sendSummary>[0],
      callback: (error: Error | null) => void,
    ) => process.send?.(message, callback);
    if (name === "moneyTick") {
      const result = await MONEY_HANDLERS.moneyTick();
      await sendSummary(
        {
          type: "summary",
          job: "moneyTick",
          timersAttempted: result.timers,
          inboxAttempted: result.inbox,
          actionsAttempted: result.actions,
          outboxAttempted: result.outbox,
        },
        send,
      );
    } else if (name === "reconcile") {
      const result = await MONEY_HANDLERS.reconcile();
      await sendSummary({ type: "summary", job: "reconcile", ...result }, send);
    } else {
      process.exit(1);
    }
  } else {
    const { AGENT_HANDLERS } = await import("../agents/handlers");
    const handler = AGENT_HANDLERS[name];
    if (!handler) process.exit(1);
    await handler();
  }
  process.exit(0);
} catch {
  process.exit(1);
}
