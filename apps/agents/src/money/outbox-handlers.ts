import type { Payee } from "@tranche/contracts";
import { platformFee } from "@tranche/core";
import { schema } from "@tranche/db";
import type { PlaceHoldResult } from "@tranche/paypal";
import { desc, eq, inArray } from "drizzle-orm";
import type { Deps } from "./deps";
import { errorMessage, must } from "./errors";
import { activateHold, confirmRelease, getHold, type HoldRow } from "./holds";
import { advanceMilestone } from "./milestones";
import type { OutboxHandler, OutboxKind } from "./outbox";
import { timerOutboxHandlers } from "./timer-outbox-handlers";

type Sub = Extract<Payee, { kind: "subcontractor" }>;
const splitMode = () => process.env.SUBCONTRACTOR_SPLIT ?? "agency_pays";

async function merchantOf(deps: Deps, milestoneId: string): Promise<string | undefined> {
  const [r] = await deps.db
    .select({ merchantId: schema.workspace.paypalMerchantId })
    .from(schema.milestone)
    .innerJoin(schema.deal, eq(schema.deal.id, schema.milestone.dealId))
    .innerJoin(schema.workspace, eq(schema.workspace.id, schema.deal.workspaceId))
    .where(eq(schema.milestone.id, milestoneId));
  return r?.merchantId ?? undefined;
}

const amountOf = (hold: HoldRow, minor: number) => ({ currency: hold.currency, minor });

const placeHold: OutboxHandler = {
  async call(deps, row) {
    const hold = await getHold(deps.db, String(row.request.holdId));
    if (hold.status !== "pending") return { skipped: true };
    return deps.paypal.placeHold({
      requestId: row.requestId,
      orderId: hold.paypalOrderId,
      mechanism: hold.mechanism,
    });
  },
  async settle(tx, deps, row, res) {
    if (res.skipped) return;
    const r = res as PlaceHoldResult;
    const hold = await getHold(tx, String(row.request.holdId));
    if (r.vaultId) {
      const [m] = await tx
        .select({ clientId: schema.deal.clientId })
        .from(schema.milestone)
        .innerJoin(schema.deal, eq(schema.deal.id, schema.milestone.dealId))
        .where(eq(schema.milestone.id, hold.milestoneId));
      if (m) {
        await tx
          .update(schema.client)
          .set({ paypalVaultId: r.vaultId })
          .where(eq(schema.client.id, m.clientId));
      }
    }
    // Funds in review are not guaranteed: the hold stays pending and the milestone in funding
    // until PAYMENT.CAPTURE.COMPLETED or a CREATED authorization arrives by webhook.
    if (r.status === "pending") return;
    await activateHold(
      tx,
      hold,
      {
        captureId: r.captureId,
        authorizationId: r.authorizationId,
        anchorAt: deps.now(),
        expiresAt: new Date(r.expiresAt),
        amountMinor: hold.amountMinor,
      },
      deps.now(),
    );
  },
  async fail(tx, deps, row, err) {
    const hold = await getHold(tx, String(row.request.holdId));
    if (hold.status !== "pending") return;
    await tx.update(schema.hold).set({ status: "failed" }).where(eq(schema.hold.id, hold.id));
    await advanceMilestone(
      tx,
      hold.milestoneId,
      { type: "funding_failed", reason: errorMessage(err) },
      { now: deps.now() },
    );
  },
};

const release: OutboxHandler = {
  async call(deps, row) {
    const hold = await getHold(deps.db, String(row.request.holdId));
    if (hold.status === "released") return { releaseRef: hold.paypalCaptureId };
    const amount = amountOf(hold, Number(row.request.amountMinor));
    return deps.paypal.releaseHold({
      requestId: row.requestId,
      mechanism: hold.mechanism,
      captureId: hold.paypalCaptureId,
      authorizationId: hold.paypalAuthorizationId,
      amount,
      // Delayed disbursement already charged the fee when the order was captured.
      platformFee: hold.mechanism === "authorization" ? platformFee(amount) : undefined,
      payeeMerchantId: await merchantOf(deps, hold.milestoneId),
    });
  },
  async settle(tx, deps, row, res) {
    const hold = await getHold(tx, String(row.request.holdId));
    const captureId =
      hold.mechanism === "authorization" && res.releaseRef ? String(res.releaseRef) : null;
    await confirmRelease(
      tx,
      hold,
      { captureId, amountMinor: Number(row.request.amountMinor) },
      deps.now(),
    );
  },
  async fail(tx, deps, row, err) {
    const hold = await getHold(tx, String(row.request.holdId));
    await advanceMilestone(
      tx,
      hold.milestoneId,
      { type: "release_failed", reason: errorMessage(err) },
      { now: deps.now(), payload: { holdId: hold.id, error: errorMessage(err) } },
    );
  },
};

const voidHold: OutboxHandler = {
  async call(deps, row) {
    const hold = await getHold(deps.db, String(row.request.holdId));
    if (hold.status !== "active") return { skipped: true };
    await deps.paypal.voidHold({
      requestId: row.requestId,
      mechanism: hold.mechanism,
      authorizationId: hold.paypalAuthorizationId,
      captureId: hold.paypalCaptureId,
      // A delayed hold is refunded, and the buyer gets the platform fee back too.
      platformFee:
        hold.mechanism === "delayed_disbursement"
          ? platformFee(amountOf(hold, hold.amountMinor))
          : undefined,
      payeeMerchantId: await merchantOf(deps, hold.milestoneId),
    });
    return { voided: true };
  },
  async settle(tx, _deps, row, res) {
    if (res.skipped) return;
    await tx
      .update(schema.hold)
      .set({ status: "voided" })
      .where(eq(schema.hold.id, String(row.request.holdId)));
  },
};

const payout: OutboxHandler = {
  async call(deps, row) {
    const milestoneId = String(row.request.milestoneId);
    const [r] = await deps.db
      .select({ m: schema.milestone, currency: schema.deal.currency })
      .from(schema.milestone)
      .innerJoin(schema.deal, eq(schema.deal.id, schema.milestone.dealId))
      .where(eq(schema.milestone.id, milestoneId));
    const subs = (r?.m.payees ?? []).filter((p): p is Sub => p.kind === "subcontractor");
    if (!r || subs.length === 0 || splitMode() !== "payouts") return { batchId: null };
    return deps.paypal.sendPayouts({
      requestId: row.requestId,
      items: subs.map((p) => ({
        email: p.email,
        amount: {
          currency: r.currency,
          minor: Math.floor((r.m.releasedMinor * p.shareBps) / 10000),
        },
        note: `Tranche milestone: ${r.m.title}`,
      })),
    });
  },
  async settle(tx, deps, row, res) {
    const milestoneId = String(row.request.milestoneId);
    if (res.batchId === null) {
      await advanceMilestone(tx, milestoneId, { type: "payout_confirmed" }, { now: deps.now() });
      return;
    }
    const [r] = await tx
      .select({ m: schema.milestone, currency: schema.deal.currency })
      .from(schema.milestone)
      .innerJoin(schema.deal, eq(schema.deal.id, schema.milestone.dealId))
      .where(eq(schema.milestone.id, milestoneId));
    const { m, currency } = must(r);
    const [hold] = await tx
      .select({ id: schema.hold.id })
      .from(schema.hold)
      .where(eq(schema.hold.milestoneId, milestoneId))
      .orderBy(desc(schema.hold.createdAt))
      .limit(1);
    const subs = m.payees.filter((p): p is Sub => p.kind === "subcontractor");
    await tx.insert(schema.payout).values(
      subs.map((p) => ({
        milestoneId,
        holdId: must(hold).id,
        payee: p,
        amountMinor: Math.floor((m.releasedMinor * p.shareBps) / 10000),
        currency,
        paypalRef: String(res.batchId),
        status: "sent" as const,
      })),
    );
  },
};

const disputeEvidence: OutboxHandler = {
  async call(deps, row) {
    const r = row.request as {
      disputeId: string;
      notes: string;
      evidenceIds: string[];
    };
    const evidence = await deps.db
      .select()
      .from(schema.evidence)
      .where(inArray(schema.evidence.id, r.evidenceIds));
    const facts = evidence.map((e) => `- ${e.kind}: ${e.summary}`).join("\n");
    await deps.paypal.submitDisputeEvidence({
      requestId: row.requestId,
      disputeId: r.disputeId,
      notes: `${r.notes}\n\nVerified evidence:\n${facts}`.slice(0, 2000),
      payeeMerchantId: evidence[0] ? await merchantOf(deps, evidence[0].milestoneId) : undefined,
    });
    return { submitted: true };
  },
  async settle() {},
};

export const outboxHandlers: Partial<Record<OutboxKind, OutboxHandler>> = {
  place_hold: placeHold,
  release,
  void_hold: voidHold,
  payout,
  dispute_evidence: disputeEvidence,
  ...timerOutboxHandlers,
};
