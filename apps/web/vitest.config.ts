import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": src("./src"),
      "server-only": src("./src/test/empty-module.ts"),
    },
  },
  test: { include: ["src/**/*.test.{ts,tsx}"], fileParallelism: false },
});
