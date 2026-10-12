import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { SandboxApprovalSummary, SandboxOperationSpec } from "@tranche/contracts";
import { createSandboxStore, type SandboxStore } from "@tranche/db";
import { SandboxRunner } from "./runner";

export const sandboxHelp =
  "Sandbox runner: start <private-spec-file> | inspect <run-id> | report <run-id> | approve <operation-id> <payload-hash> <attempt> | resume <operation-id>. No real capability adapters are installed yet.";

export async function sandboxCli(
  args: string[],
  store: SandboxStore,
  runner: SandboxRunner,
): Promise<unknown> {
  const [command, first, second, third] = args;
  if (command === "start" && args.length === 2 && first) {
    const spec = SandboxOperationSpec.parse(JSON.parse(await readFile(first, "utf8")));
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
      }),
      report: await store.report(runId),
    };
  }
  if (command === "inspect" && args.length === 2 && first) return store.inspect(first);
  if (command === "report" && args.length === 2 && first) return store.report(first);
  if (command === "approve" && args.length === 4 && first && second && third) {
    await store.approve(first, second, Number(third));
    return { approvalRecorded: true };
  }
  if (command === "resume" && args.length === 2 && first) {
    await runner.resume(first);
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
    const runner = new SandboxRunner(
      store,
      {
        environment: process.env.PAYPAL_ENV ?? "",
        clientId: process.env.PAYPAL_CLIENT_ID ?? "",
        clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? "",
      },
      [],
    );
    console.log(JSON.stringify(await sandboxCli(args, store, runner), null, 2));
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
