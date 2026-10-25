import { createHash, randomUUID } from "node:crypto";
import { type EvidenceInput, Id, InboxMessage } from "@tranche/contracts";
import { verificationGate } from "@tranche/core";
import { type Db, schema } from "@tranche/db";
import {
  type CheckDeps,
  createGitHubReader,
  type Delivery,
  defaultCheckDeps,
  repositoryAllowed,
  runCheck,
  type Shot,
  UnsafeUrlError,
} from "@tranche/verifiers";
import type { LanguageModel } from "ai";
import { and, desc, eq, sql } from "drizzle-orm";
import { selectModels } from "../runtime/models";
import { canonical, proposeAction, recordEvidence } from "../runtime/persistence";
import { judgeDelivery } from "./judge";

export type VerifyDeps = {
  checks: CheckDeps;
  capture: (urls: string[]) => Promise<Shot[]>;
  model: () => LanguageModel;
};
export function defaultVerifyDeps(): VerifyDeps {
  return {
    checks: defaultCheckDeps(() => createGitHubReader()),
    model: () => selectModels().judge,
    capture: async (urls) =>
      (await import("@tranche/verifiers/screenshots")).captureScreenshots(urls),
  };
}
export async function verifyMilestone(db: Db, eventId: number, injectedDeps?: VerifyDeps) {
  const deps = injectedDeps ?? defaultVerifyDeps();
  if (!Number.isSafeInteger(eventId) || eventId < 1) throw new Error("invalid_verification_event");
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`verify:${eventId}`}, 0))`,
    );
    const [event] = await tx
      .select()
      .from(schema.event)
      .where(
        and(
          eq(schema.event.id, eventId),
          eq(schema.event.type, "milestone.verification_requested"),
        ),
      );
    if (!event?.milestoneId || !event.dealId) throw new Error("verification_event_missing");
    const deliveryId = Id.parse(event.payload.deliveryId);
    const key = `verify:${eventId}:${deliveryId}`;
    const [prior] = await tx
      .select()
      .from(schema.proposedAction)
      .where(eq(schema.proposedAction.idempotencyKey, key));
    if (prior) return { outcome: prior.type, proposalId: prior.id };
    const [milestone] = await tx
      .select()
      .from(schema.milestone)
      .where(
        and(eq(schema.milestone.id, event.milestoneId), eq(schema.milestone.dealId, event.dealId)),
      );
    if (!milestone || !["delivered", "verifying"].includes(milestone.state))
      return { outcome: "skipped" };
    const [latest] = await tx
      .select({ id: schema.event.id })
      .from(schema.event)
      .where(
        and(
          eq(schema.event.milestoneId, milestone.id),
          eq(schema.event.type, "milestone.verification_requested"),
        ),
      )
      .orderBy(desc(schema.event.id))
      .limit(1);
    if (latest?.id !== eventId) return { outcome: "skipped" };
    const [inbox] = await tx.select().from(schema.inbox).where(eq(schema.inbox.id, deliveryId));
    const message = InboxMessage.parse(inbox?.message);
    if (
      !inbox?.processedAt ||
      message.type !== "delivery.detected" ||
      message.milestoneId !== milestone.id
    )
      throw new Error("foreign_delivery");
    if (!injectedDeps && message.repo) {
      const [deal] = await tx.select().from(schema.deal).where(eq(schema.deal.id, event.dealId));
      if (!deal || !repositoryAllowed(deal.workspaceId, message.repo))
        throw new Error("repository_not_connected");
    }
    const delivery: Delivery = {
      inboxId: deliveryId,
      repo: message.repo,
      sha: message.sha,
      prNumber: message.prNumber,
      urls: message.urls,
      ...(message.notes ? { notes: message.notes } : {}),
    };
    const records: EvidenceInput[] = [];
    const images: Array<{ evidenceId: string; base64: string }> = [];
    const now = new Date().toISOString();
    const missing: string[] = [];
    const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
    for (const [index, check] of milestone.criteria.checks.entries()) {
      const result = await runCheck(check, delivery, deps.checks);
      records.push({
        milestoneId: milestone.id,
        kind: check.kind,
        checkIndex: index,
        ...result,
        contentHash: hash([deliveryId, index, check, result]),
      });
      if (!result.passed) missing.push(result.summary);
    }
    const gate = verificationGate(
      milestone.criteria,
      records.map((record) => ({
        checkIndex: record.checkIndex,
        passed: record.passed,
        createdAt: now,
      })),
    );
    if (gate.passed && milestone.criteria.prose.length) {
      const urls = [
        ...new Set([
          ...message.urls,
          ...milestone.criteria.checks.flatMap((c) => ("url" in c ? [c.url] : [])),
        ]),
      ];
      let shots: Shot[] = [];
      try {
        shots = await deps.capture(urls);
      } catch (error) {
        if (!(error instanceof UnsafeUrlError)) throw error;
        missing.push("Screenshot URL safety check failed");
      }
      for (const shot of shots) {
        if (
          shot.base64.length > 3_000_000 ||
          !Buffer.from(shot.base64, "base64")
            .subarray(0, 2)
            .equals(Buffer.from([0xff, 0xd8]))
        )
          throw new Error("invalid_screenshot");
        const id = randomUUID();
        images.push({ evidenceId: id, base64: shot.base64 });
        records.push({
          milestoneId: milestone.id,
          kind: "screenshot",
          checkIndex: null,
          passed: null,
          summary: `${shot.viewport} screenshot`,
          data: {
            imageUrl: `/api/evidence/images/${id}`,
            imageId: id,
            url: shot.url,
            viewport: shot.viewport,
          },
          contentHash: hash([deliveryId, shot]),
        });
      }
      if (!missing.length) {
        let prText: string | null = null;
        if (delivery.repo && delivery.prNumber) {
          const reader = deps.checks.github();
          const pull = await reader.getPull(delivery.repo, delivery.prNumber);
          if (pull.merged && pull.sha === delivery.sha)
            prText = `${pull.title}\n${pull.body}\n${await reader.getPullFiles(delivery.repo, delivery.prNumber)}`;
        }
        const verdict = await judgeDelivery(
          { prose: milestone.criteria.prose, shots, prText, notes: message.notes },
          deps.model(),
        );
        records.push({
          milestoneId: milestone.id,
          kind: "ai_verdict",
          checkIndex: null,
          passed: verdict.overall === "pass",
          summary:
            verdict.overall === "pass"
              ? "Written criteria met"
              : "Written criteria not established",
          data: { judgement: verdict, deliveryId },
          contentHash: hash([deliveryId, verdict]),
        });
        if (verdict.overall !== "pass")
          missing.push(...verdict.criteria.filter((c) => !c.met).map((c) => c.reason));
        if (verdict.overall !== "pass" && !missing.length)
          missing.push("Judge did not confirm the delivery");
      }
    }
    const [current] = await tx
      .select()
      .from(schema.milestone)
      .where(eq(schema.milestone.id, milestone.id))
      .for("update");
    if (current?.version !== milestone.version || current.state !== milestone.state)
      return { outcome: "skipped" };
    const ids: string[] = [];
    for (const record of records) {
      const image = images.find((i) => i.evidenceId === record.data.imageId);
      if (image) {
        await tx.insert(schema.evidence).values({ ...record, id: image.evidenceId });
        await tx.insert(schema.evidenceImage).values(image);
        ids.push(image.evidenceId);
      } else ids.push((await recordEvidence(tx, record, event.dealId)).id);
    }
    const outcome = gate.passed && !missing.length ? "mark_verified" : "request_changes";
    const proposal = await proposeAction(tx, {
      dealId: event.dealId,
      agent: "verifier",
      side: "agency",
      evidenceIds: ids,
      idempotencyKey: key,
      reasoning:
        outcome === "mark_verified"
          ? "Machine checks and written criteria passed for the applied delivery."
          : "The applied delivery needs changes.",
      payload:
        outcome === "mark_verified"
          ? { type: outcome, milestoneId: milestone.id, evidenceIds: ids, deliveryId }
          : {
              type: outcome,
              milestoneId: milestone.id,
              evidenceIds: ids,
              deliveryId,
              missing: (missing.length ? missing : ["Required checks did not pass"]).map((s) =>
                s.slice(0, 500),
              ),
            },
    });
    return { outcome, proposalId: proposal.id };
  });
}
