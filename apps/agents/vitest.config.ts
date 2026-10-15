import { defineConfig } from "vitest/config";

// Test files queue on a per-database lock (see @tranche/db/testing), so setup may wait for a
// concurrent run's file to finish.
export default defineConfig({ test: { fileParallelism: false, hookTimeout: 120_000 } });
