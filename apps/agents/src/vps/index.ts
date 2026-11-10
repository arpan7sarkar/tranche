import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { consumers } from "../agents/consumers";
import { assertConsumerRegistry, moneyEnabled, selectVpsJobs, VPS_JOBS } from "./jobs";
import { acquireJobLock } from "./lock";
import { createRuntime } from "./scheduler";

try {
  assertConsumerRegistry(consumers);
} catch {
  console.error(JSON.stringify({ component: "vps_runtime", event: "consumer_registry_diverged" }));
  process.exit(1);
}
if (!moneyEnabled(process.env)) {
  console.log(JSON.stringify({ component: "vps_runtime", event: "money_disabled" }));
}

const runtime = createRuntime({
  jobs: selectVpsJobs(process.env),
  acquireLock: acquireJobLock,
  spawn: (name) =>
    spawn(process.execPath, [fileURLToPath(new URL("./job.mjs", import.meta.url)), name], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    }),
  log: (event, job, summary) => {
    if (!job || !VPS_JOBS.some((entry) => entry.name === job)) return;
    console.log(
      JSON.stringify({
        component: "vps_runtime",
        event,
        job,
        timestamp: new Date().toISOString(),
        ...(summary ? { summary } : {}),
      }),
    );
  },
});

runtime.start();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void runtime.stop().then(() => process.exit(0));
  });
}
