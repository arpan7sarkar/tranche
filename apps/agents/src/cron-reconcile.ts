import { dispatchCron } from "./deployment/cron";

try {
  const result = await dispatchCron("reconcile");
  console.log(JSON.stringify(result));
  process.exitCode = result.failed.length ? 1 : 0;
} catch {
  console.error("cron_reconcile_failed: check deployment configuration and workflow access");
  process.exitCode = 1;
}
