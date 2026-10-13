import { fileURLToPath } from "node:url";
import { createSandboxStore } from "@tranche/db";
import { expect, it } from "vitest";
import { paymentAdapters } from "./payment-adapters";
import { PrivateSandboxArtifacts } from "./private-artifacts";
import { SandboxRunner } from "./runner";

it.skipIf(process.env.RUN_PAYPAL_P4_SANDBOX_TEST !== "1")(
  "executes one explicitly approved sandbox payment stage",
  async () => {
    const operationId = process.env.PAYPAL_P4_OPERATION_ID ?? "";
    const expected = process.env.PAYPAL_P4_EXPECT_STATE ?? "";
    if (
      process.env.PAYPAL_ENV !== "sandbox" ||
      !/^[a-f0-9-]{36}$/.test(operationId) ||
      !["waiting_for_browser", "succeeded", "inconclusive"].includes(expected)
    )
      throw new Error("sandbox_test_prerequisites");
    const store = createSandboxStore();
    try {
      const op = await store.operation(operationId);
      if (
        op.spec.payment?.context.path !== "authorization_capture" ||
        !["ready", "waiting_for_browser", "inconclusive"].includes(op.state)
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
      await new SandboxRunner(
        store,
        credentials,
        paymentAdapters(store, artifacts, credentials.clientId),
      ).resume(operationId);
      expect((await store.operation(operationId)).state).toBe(expected);
      const r = await store.paymentResource(op.commitmentId);
      if (expected === "waiting_for_browser") expect(r.result.artifactKey).toBeDefined();
      if (expected === "succeeded")
        expect(r.result.evidence).toBe(
          {
            create_order: "buyer_approved",
            authorize_order: "authorized",
            capture_order: "captured_immediate",
          }[op.spec.payment.stage],
        );
    } catch {
      throw new Error("sandbox_payment_test_incomplete");
    } finally {
      await store.db.$client.end().catch(() => {});
    }
  },
  60000,
);
