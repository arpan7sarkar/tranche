import { fileURLToPath } from "node:url";
import { createSandboxStore } from "@tranche/db";
import { expect, it } from "vitest";
import { onboardingAdapter } from "./adapters";
import { PrivateSandboxArtifacts } from "./private-artifacts";
import { SandboxRunner } from "./runner";

it.skipIf(process.env.RUN_PAYPAL_P3_SANDBOX_TEST !== "1")(
  "executes one explicitly approved sandbox onboarding stage",
  async () => {
    const operationId = process.env.PAYPAL_P3_OPERATION_ID ?? "";
    const expected = process.env.PAYPAL_P3_EXPECT_STATE;
    if (
      process.env.PAYPAL_ENV !== "sandbox" ||
      !/^[a-f0-9-]{36}$/.test(operationId) ||
      !["waiting_for_browser", "succeeded"].includes(expected ?? "")
    )
      throw new Error("sandbox_test_prerequisites");
    const store = createSandboxStore();
    try {
      const operation = await store.operation(operationId);
      if (
        operation.spec.kind !== "onboard_seller" ||
        !operation.spec.onboarding ||
        !["ready", "waiting_for_browser", "inconclusive"].includes(operation.state)
      )
        throw new Error("sandbox_test_operation");
      const artifacts = new PrivateSandboxArtifacts(
        fileURLToPath(new URL("../../../../.sandbox-private", import.meta.url)),
      );
      const credentials = {
        environment: "sandbox",
        clientId: process.env.PAYPAL_CLIENT_ID ?? "",
        clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? "",
      };
      await new SandboxRunner(store, credentials, [
        onboardingAdapter(store, artifacts, credentials.clientId),
      ]).resume(operationId);
      const state = (await store.operation(operationId)).state;
      expect(state).toBe(expected);
      const resource = await store.onboardingResource(operationId);
      if (state === "succeeded") expect(resource.evidence?.status).toBe("consent_verified");
      else expect(resource.artifactKey).not.toBeNull();
    } catch {
      throw new Error("sandbox_onboarding_test_incomplete");
    } finally {
      await store.db.$client.end().catch(() => {});
    }
  },
  60_000,
);
