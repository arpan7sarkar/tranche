import "server-only";
import * as money from "@tranche/agents-service/money";
import type { DealStatus, Policy } from "@tranche/contracts";
import { type Db, resolveMagicLink, schema } from "@tranche/db";
import { and, eq, sql } from "drizzle-orm";
import { isUuid } from "@/lib/uuid";
import { getDb } from "./db";

export type AutoReleaseHours = 24 | 72 | 168;
export type ReleaseResult = "submitted" | "already_submitted" | "not_releasable";
export type AgreeResult = "agreed" | "already_agreed" | "not_agreeable";

const AGREEABLE: ReadonlySet<DealStatus> = new Set(["sent", "negotiating"]);
const AGREED: ReadonlySet<DealStatus> = new Set(["agreed", "active", "completed"]);

export function resolvePortalToken(token: string) {
  return resolveMagicLink(getDb(), token);
}

export function defaultClientPolicy(totalMinor: number): Policy {
  return {
    perActionMaxMinor: totalMinor,
    perMilestoneMaxMinor: totalMinor,
    perDealMaxMinor: totalMinor,
    autoReleaseAfterHours: null,
    cooldownMinutes: 0,
    alwaysAsk: [],
  };
}

async function dealStatus(db: Db, dealId: string): Promise<DealStatus | undefined> {
  const [row] = await db
    .select({ status: schema.deal.status })
    .from(schema.deal)
    .where(eq(schema.deal.id, dealId));
  return row?.status;
}

export async function agreeFromPortal(db: Db, dealId: string): Promise<AgreeResult> {
  const status = await dealStatus(db, dealId);
  if (status && AGREED.has(status)) return "already_agreed";
  if (!status || !AGREEABLE.has(status)) return "not_agreeable";
  try {
    await money.agreeToPlan(db, dealId);
    return "agreed";
  } catch (error) {
    const now = await dealStatus(db, dealId);
    if (now && AGREED.has(now)) return "already_agreed";
    throw error;
  }
}

export async function submitClientRelease(
  db: Db,
  input: { dealId: string; milestoneId: string },
): Promise<ReleaseResult> {
  if (!isUuid(input.milestoneId)) return "not_releasable";
  const [m] = await db
    .select({
      state: schema.milestone.state,
      heldMinor: schema.milestone.heldMinor,
      releasedMinor: schema.milestone.releasedMinor,
      currency: schema.deal.currency,
    })
    .from(schema.milestone)
    .innerJoin(schema.deal, eq(schema.deal.id, schema.milestone.dealId))
    .where(
      and(eq(schema.milestone.id, input.milestoneId), eq(schema.milestone.dealId, input.dealId)),
    );
  if (!m || m.state !== "release_pending") return "not_releasable";

  const { created } = await money.submitHumanAction(db, {
    dealId: input.dealId,
    agent: "human",
    side: "client",
    reasoning: "The client released this milestone in the portal.",
    evidenceIds: [],
    idempotencyKey: `release:${input.milestoneId}:client`,
    payload: {
      type: "release",
      milestoneId: input.milestoneId,
      amount: { currency: m.currency, minor: m.heldMinor - m.releasedMinor },
    },
  });
  return created ? "submitted" : "already_submitted";
}

export async function submittedClientReleases(db: Db, dealId: string): Promise<Set<string>> {
  const rows = await db
    .select({ milestoneId: sql<string>`${schema.proposedAction.payload}->>'milestoneId'` })
    .from(schema.proposedAction)
    .where(
      and(
        eq(schema.proposedAction.dealId, dealId),
        eq(schema.proposedAction.agent, "human"),
        eq(schema.proposedAction.side, "client"),
        eq(schema.proposedAction.type, "release"),
      ),
    );
  return new Set(rows.map((r) => r.milestoneId));
}

export async function setAutoRelease(
  db: Db,
  input: { dealId: string; hours: AutoReleaseHours | null },
): Promise<Policy> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        policy: schema.deal.clientPolicy,
        total: sql<number>`coalesce((select sum(${schema.milestone.priceMinor}) from ${schema.milestone} where ${schema.milestone.dealId} = ${schema.deal.id}), 0)::bigint`.mapWith(
          Number,
        ),
      })
      .from(schema.deal)
      .where(eq(schema.deal.id, input.dealId))
      .for("update", { of: schema.deal });
    if (!row) throw new Error(`Deal ${input.dealId} not found`);
    const policy: Policy = {
      ...(row.policy ?? defaultClientPolicy(row.total)),
      autoReleaseAfterHours: input.hours,
    };
    await tx
      .update(schema.deal)
      .set({ clientPolicy: policy, updatedAt: new Date() })
      .where(eq(schema.deal.id, input.dealId));
    return policy;
  });
}
