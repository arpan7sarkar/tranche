import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  onboardingApprovalSummary,
  SandboxApprovalSummary,
  SandboxOperationSpec,
  SandboxReferralRecoveryInput,
  SandboxVoidInput,
} from "@tranche/contracts";
import { paymentApproval } from "@tranche/core";
import { createSandboxStore, type SandboxStore } from "@tranche/db";
import { onboardingSpec, paymentSpec } from "@tranche/paypal";
import { onboardingAdapter } from "./adapters";
import { paymentAdapters } from "./payment-adapters";
import { PrivateSandboxArtifacts } from "./private-artifacts";
import { SandboxRunner } from "./runner";

export const sandboxHelp =
  "Recovery: adopt-order <operation-id> <known-order-id> <payload-hash> (counted read-only adoption) | retry-undispatched <operation-id> (fresh approval required) | prepare-void <authorization-operation-id> <private-fee-input-file> (separate approval required). " +
  "Read-only maintenance: maintenance <operation-id> <private-input-file> | approve-maintenance <id> <approval-hash> | apply-maintenance <id>. " +
  "Sandbox runner: onboard <private-input-file> | protect <private-input-file> | buyer-change <order-operation-id> <private-input-file> | approve-buyer-change <change-id> <approval-hash> | apply-buyer-change <change-id> | payment-next <operation-id> | checkout-file <operation-id> | referral-recovery <operation-id> <private-input-file> | approve-referral-recovery <id> <approval-hash> | apply-referral-recovery <id> | start <private-spec-file> | inspect <run-id> | report <run-id> | approve <operation-id> <payload-hash> <attempt> | resume <operation-id> | consent-file <operation-id> | refresh-consent <operation-id>. Onboarding and authorization/capture adapters are available; delayed disbursement is blocked. All writes require approval.";

export async function sandboxCli(
  args: string[],
  store: SandboxStore,
  runner: SandboxRunner,
  artifacts = new PrivateSandboxArtifacts(
    fileURLToPath(new URL("../../../../.sandbox-private", import.meta.url)),
  ),
): Promise<unknown> {
  const [command, first, second, third] = args;
  if (command === "adopt-order" && args.length === 4 && first && second && third) {
    await runner.adoptOrder(first, second, third);
    return store.inspect((await store.operation(first)).runId);
  }
  if (command === "retry-undispatched" && args.length === 2 && first) {
    await store.retryUndispatched(first);
    return store.inspect((await store.operation(first)).runId);
  }
  if (command === "prepare-void" && args.length === 3 && first && second) {
    const input = SandboxVoidInput.parse(JSON.parse(await readFile(second, "utf8")));
    const source = await store.operation(first);
    if (source.state !== "succeeded" || source.spec.payment?.stage !== "authorize_order")
      throw new Error("authorization_stage_required");
    const payment = await store.paymentResource(source.commitmentId);
    if (!payment.result.orderId || !payment.result.authorizationId)
      throw new Error("authorization_reference_required");
    const cleanup = await store.prepare(
      source.runId,
      randomUUID(),
      paymentSpec(payment.context, source.commitmentId, "void_authorization", {
        orderId: payment.result.orderId,
        authorizationId: payment.result.authorizationId,
        cleanupFeeBoundCents: input.feeBoundCents,
      }),
    );
    return { operationId: cleanup.id, inspection: await store.inspect(source.runId) };
  }
  if (command === "maintenance" && args.length === 3 && first && second)
    return store.proposeMaintenance(first, JSON.parse(await readFile(second, "utf8")));
  if (command === "approve-maintenance" && args.length === 3 && first && second) {
    await store.approveMaintenance(first, second);
    return { approvalRecorded: true };
  }
  if (command === "apply-maintenance" && args.length === 2 && first) {
    await runner.maintain(first);
    return store.maintenanceSummary(await store.maintenanceRecord(first));
  }
  if (command === "buyer-change" && args.length === 3 && first && second)
    return store.proposeBuyerChange(first, JSON.parse(await readFile(second, "utf8")));
  if (command === "approve-buyer-change" && args.length === 3 && first && second) {
    await store.approveBuyerChange(first, second);
    return { approvalRecorded: true };
  }
  if (command === "apply-buyer-change" && args.length === 2 && first) {
    await runner.changeBuyer(first);
    return store.buyerChangeSummary(await store.buyerChange(first));
  }
  if (command === "referral-recovery" && args.length === 3 && first && second) {
    const input = SandboxReferralRecoveryInput.parse(JSON.parse(await readFile(second, "utf8")));
    return store.proposeReferralRecovery(first, input.referralId);
  }
  if (command === "approve-referral-recovery" && args.length === 3 && first && second) {
    await store.approveReferralRecovery(first, second);
    return { approvalRecorded: true };
  }
  if (command === "apply-referral-recovery" && args.length === 2 && first) {
    await runner.recoverReferral(first);
    return { applied: true };
  }
  if (["start", "onboard", "protect"].includes(command ?? "") && args.length === 2 && first) {
    const input: unknown = JSON.parse(await readFile(first, "utf8"));
    const spec =
      command === "onboard"
        ? onboardingSpec(input)
        : command === "protect"
          ? paymentSpec(input)
          : SandboxOperationSpec.parse(input);
    if (command === "protect" && !spec.payment?.context.checkout)
      throw new Error("checkout_destinations_required");
    const runId = await store.start();
    const op = await store.prepare(runId, randomUUID(), spec);
    return {
      runId,
      approval: SandboxApprovalSummary.parse({
        operationId: op.id,
        payloadHash: op.payloadHash,
        nextAttempt: op.attempts + 1,
        purpose: op.spec.kind,
        sender: op.spec.sender,
        recipients: op.spec.recipients,
        feeBoundCents: op.spec.feeBoundCents,
        ...(op.spec.payment
          ? { payment: paymentApproval(op.spec.payment.context, op.spec.payment) }
          : {}),
        ...(op.spec.onboarding
          ? { onboarding: onboardingApprovalSummary(op.spec.onboarding) }
          : {}),
      }),
      report: await store.report(runId),
    };
  }
  if (command === "inspect" && args.length === 2 && first) return store.inspect(first);
  if (command === "report" && args.length === 2 && first) return store.report(first);
  if (command === "payment-next" && args.length === 2 && first) {
    const previous = await store.operation(first);
    if (
      previous.state !== "succeeded" ||
      !previous.spec.payment ||
      !["create_order", "authorize_order"].includes(previous.spec.payment.stage)
    )
      throw new Error("payment_not_advanceable");
    const r = await store.paymentResource(previous.commitmentId);
    const next =
      previous.spec.payment.stage === "create_order" ? "authorize_order" : "capture_order";
    const references = {
      ...(r.result.orderId ? { orderId: r.result.orderId } : {}),
      ...(r.result.authorizationId ? { authorizationId: r.result.authorizationId } : {}),
    };
    const op = await store.prepare(
      previous.runId,
      randomUUID(),
      paymentSpec(r.context, previous.commitmentId, next, references),
    );
    return { operationId: op.id, inspection: await store.inspect(previous.runId) };
  }
  if (command === "checkout-file" && args.length === 2 && first) {
    const op = await store.operation(first);
    const r = await store.paymentResource(op.commitmentId);
    if (!op.spec.payment || op.state !== "waiting_for_browser" || !r.result.artifactKey)
      throw new Error("checkout_unavailable");
    await artifacts.readBrowserUrl(r.result.artifactKey);
    return { buyer: "buyer", privateFile: artifacts.filePath(r.result.artifactKey) };
  }
  if (command === "consent-file" && args.length === 2 && first) {
    const consent = await store.consentArtifact(first);
    await artifacts.readBrowserUrl(consent.artifactKey);
    return {
      seller: consent.seller,
      privateFile: artifacts.filePath(consent.artifactKey),
    };
  }
  if (command === "approve" && args.length === 4 && first && second && third) {
    await store.approve(first, second, Number(third));
    return { approvalRecorded: true };
  }
  if ((command === "resume" || command === "refresh-consent") && args.length === 2 && first) {
    if (command === "refresh-consent" && !(await store.operation(first)).spec.onboarding)
      throw new Error("not_onboarding");
    await runner.resume(first, { refreshConsent: command === "refresh-consent" });
    return { report: await store.report((await store.operation(first)).runId) };
  }
  throw new Error("invalid_command");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || (args.length === 1 && ["--help", "help"].includes(args[0] ?? ""))) {
    console.log(sandboxHelp);
    return;
  }
  const store = createSandboxStore();
  try {
    const artifacts = new PrivateSandboxArtifacts(
      fileURLToPath(new URL("../../../../.sandbox-private", import.meta.url)),
    );
    const runner = new SandboxRunner(
      store,
      {
        environment: process.env.PAYPAL_ENV ?? "",
        clientId: process.env.PAYPAL_CLIENT_ID ?? "",
        clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? "",
      },
      [
        onboardingAdapter(store, artifacts, process.env.PAYPAL_CLIENT_ID ?? ""),
        ...paymentAdapters(store, artifacts, process.env.PAYPAL_CLIENT_ID ?? ""),
      ],
    );
    console.log(JSON.stringify(await sandboxCli(args, store, runner, artifacts), null, 2));
  } finally {
    await store.db.$client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error(
      "Sandbox runner stopped. Check command, database, approval and adapter prerequisites privately.",
    );
    process.exitCode = 1;
  });
}
