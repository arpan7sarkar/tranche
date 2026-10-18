import { afterEach, expect, it, vi } from "vitest";

const startTask = vi.hoisted(() => vi.fn());
vi.mock("@renderinc/sdk", () => ({
  Render: class {
    workflows = { startTask };
  },
}));

import { launch } from "./launch";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it("uses the same task identity when launching remotely", async () => {
  vi.stubEnv("RENDER_WORKFLOW_SLUG", "agents");
  vi.stubEnv("RENDER_API_KEY", "test");
  const inline = vi.fn();
  await launch("consume", ["monitor"], "stable-key", inline);
  expect(startTask).toHaveBeenCalledWith("agents/consume", ["monitor"], {
    idempotencyKey: "stable-key",
  });
  expect(inline).not.toHaveBeenCalled();
});
it("allows explicit local execution but refuses partial remote configuration", async () => {
  vi.stubEnv("RENDER_WORKFLOW_SLUG", "");
  vi.stubEnv("RENDER_API_KEY", "");
  vi.stubEnv("NODE_ENV", "test");
  const inline = vi.fn();
  await launch("consume", [], "local-key", inline);
  expect(inline).toHaveBeenCalledOnce();
  vi.stubEnv("RENDER_WORKFLOW_SLUG", "agents");
  await expect(launch("consume", [], "key", inline)).rejects.toThrow(
    "incomplete_workflow_configuration",
  );
});
