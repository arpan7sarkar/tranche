import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  onboardingApprovalSummary,
  SandboxApprovalSummary,
  SandboxOperationSpec,
  SandboxReferralRecoveryInput,
} from "@tranche/contracts";
import { createSandboxStore, type SandboxStore } from "@tranche/db";
import { onboardingSpec } from "@tranche/paypal";
import { onboardingAdapter } from "./adapters";
import { PrivateSandboxArtifacts } from "./private-artifacts";
import { SandboxRunner } from "./runner";

export const sandboxHelp =
  "Sandbox runner: onboard <private-input-file> | start <private-spec-file> | inspect <run-id> | report <run-id> | approve <operation-id> <payload-hash> <attempt> | resume <operation-id> | consent-file <operation-id> | refresh-consent <operation-id> | referral-recovery <operation-id> <private-input-file> | approve-referral-recovery <id> <approval-hash> | apply-referral-recovery <id>. Only seller onboarding has a real adapter; all writes require approval.";

export async function sandboxCli(
  args: string[],
  store: SandboxStore,
  runner: SandboxRunner,
  artifacts = new PrivateSandboxArtifacts(
    fileURLToPath(new URL("../../../../.sandbox-private", import.meta.url)),
  ),
): Promise<unknown> {
  const [command, first, second, third] = args;
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
  if (["start", "onboard"].includes(command ?? "") && args.length === 2 && first) {
    const input: unknown = JSON.parse(await readFile(first, "utf8"));
    const spec = command === "onboard" ? onboardingSpec(input) : SandboxOperationSpec.parse(input);
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
        ...(op.spec.onboarding
          ? { onboarding: onboardingApprovalSummary(op.spec.onboarding) }
          : {}),
      }),
      report: await store.report(runId),
    };
  }
  if (command === "inspect" && args.length === 2 && first) return store.inspect(first);
  if (command === "report" && args.length === 2 && first) return store.report(first);
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
      [onboardingAdapter(store, artifacts, process.env.PAYPAL_CLIENT_ID ?? "")],
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
