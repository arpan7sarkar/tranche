import { dispatchCron } from "./deployment/cron";

try {
  const result = await dispatchCron("tick");
  console.log(JSON.stringify(result));
  process.exitCode = result.failed.length ? 1 : 0;
} catch {
  console.error("cron_tick_failed: check deployment configuration and workflow access");
  process.exitCode = 1;
}
