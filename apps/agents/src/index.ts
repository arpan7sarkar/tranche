import { startWorker } from "./runtime/worker";

try {
  await startWorker();
} catch {
  console.error("worker_startup_failed");
  process.exit(1);
}
