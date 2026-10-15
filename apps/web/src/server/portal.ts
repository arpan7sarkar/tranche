import "server-only";
import { createHash } from "node:crypto";
import type { ActionStatus, DealStatus, Policy } from "@tranche/contracts";
import { type Db, resolveMagicLink, schema } from "@tranche/db";
import { and, asc, count, eq, inArray, notInArray, sql } from "drizzle-orm";
import { isUuid } from "@/lib/uuid";
import { getDb } from "./db";
import * as money from "./money";

export type AutoReleaseHours = 24 | 72 | 168;
export type ReleaseResult = "submitted" | "already_submitted" | "not_releasable";
export type AgreeResult = "agreed" | "already_agreed" | "not_agreeable" | "plan_changed";
export type PlanMilestone = {
  id: string;
  priceMinor: number;
  startDate: string | null;
  endDate: string | null;
};

const UNSUCCESSFUL: ActionStatus[] = ["failed", "rejected"];

const AGREEABLE: ReadonlySet<DealStatus> = new Set(["sent", "negotiating"]);
const AGREED: ReadonlySet<DealStatus> = new Set(["agreed", "active", "completed"]);

export function resolvePortalToken(token: string) {
  return resolveMagicLink(getDb(), token);
}

// Agents on the client's side never release on their own; the client's clicks and timers do.
export function defaultClientPolicy(): Policy {
  return {
    perActionMaxMinor: 0,
    perMilestoneMaxMinor: 0,
    perDealMaxMinor: 0,
    autoReleaseAfterHours: null,
    cooldownMinutes: 0,
    alwaysAsk: ["release"],
  };
}

// What the client saw: milestone ids, prices and dates in plan order.
export function planVersion(currency: string, milestones: readonly PlanMilestone[]): string {
  const shape = milestones.map((m) => [m.id, m.priceMinor, m.startDate, m.endDate]);
  return createHash("sha256")
    .update(JSON.stringify([currency, shape]))
    .digest("hex")
    .slice(0, 32);
}

async function currentPlanVersion(db: Db, dealId: string): Promise<string> {
  const rows = await db
    .select({
      id: schema.milestone.id,
      priceMinor: schema.milestone.priceMinor,
      startDate: schema.milestone.startDate,
      endDate: schema.milestone.endDate,
      currency: schema.deal.currency,
    })
    .from(schema.milestone)
    .innerJoin(schema.deal, eq(schema.deal.id, schema.milestone.dealId))
    .where(eq(schema.milestone.dealId, dealId))
    .orderBy(asc(schema.milestone.position));
  return planVersion(rows[0]?.currency ?? "", rows);
}

async function dealStatus(db: Db, dealId: string): Promise<DealStatus | undefined> {
  const [row] = await db
    .select({ status: schema.deal.status })
    .from(schema.deal)
    .where(eq(schema.deal.id, dealId));
  return row?.status;
}

export async function agreeFromPortal(
  db: Db,
  input: { dealId: string; planVersion: string },
): Promise<AgreeResult> {
  const { dealId } = input;
  const status = await dealStatus(db, dealId);
  if (status && AGREED.has(status)) return "already_agreed";
  if (!status || !AGREEABLE.has(status)) return "not_agreeable";
  // ponytail: check then agree in two transactions; a plan rewrite landing in between is
  // milliseconds wide. Pass the version into agreeToPlan if H3 adds it.
  if ((await currentPlanVersion(db, dealId)) !== input.planVersion) return "plan_changed";
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
      version: schema.milestone.version,
      heldMinor: schema.milestone.heldMinor,
      releasedMinor: schema.milestone.releasedMinor,
      currency: schema.deal.currency,
    })
    .from(schema.milestone)
    .innerJoin(schema.deal, eq(schema.deal.id, schema.milestone.dealId))
    .where(
      and(eq(schema.milestone.id, input.milestoneId), eq(schema.milestone.dealId, input.dealId)),
    );
  if (m?.state !== "release_pending") return "not_releasable";
  const [tried] = await db
    .select({ n: count() })
    .from(schema.proposedAction)
    .where(
      and(
        ...clientReleasesOf(input.dealId),
        sql`${schema.proposedAction.payload}->>'milestoneId' = ${input.milestoneId}`,
        inArray(schema.proposedAction.status, UNSUCCESSFUL),
      ),
    );

  const { created } = await money.submitHumanAction(db, {
    dealId: input.dealId,
    agent: "human",
    side: "client",
    reasoning: "The client released this milestone in the portal.",
    evidenceIds: [],
    // A failed or rejected attempt, or a new milestone version, makes the next click a new action.
    idempotencyKey: `release:${input.milestoneId}:client:${m.version}.${tried?.n ?? 0}`,
    payload: {
      type: "release",
      milestoneId: input.milestoneId,
      amount: { currency: m.currency, minor: m.heldMinor - m.releasedMinor },
    },
  });
  return created ? "submitted" : "already_submitted";
}

function clientReleasesOf(dealId: string) {
  return [
    eq(schema.proposedAction.dealId, dealId),
    eq(schema.proposedAction.agent, "human"),
    eq(schema.proposedAction.side, "client"),
    eq(schema.proposedAction.type, "release"),
  ];
}

export async function submittedClientReleases(db: Db, dealId: string): Promise<Set<string>> {
  const rows = await db
    .select({ milestoneId: sql<string>`${schema.proposedAction.payload}->>'milestoneId'` })
    .from(schema.proposedAction)
    .where(
      and(...clientReleasesOf(dealId), notInArray(schema.proposedAction.status, UNSUCCESSFUL)),
    );
  return new Set(rows.map((r) => r.milestoneId));
}

export async function setAutoRelease(
  db: Db,
  input: { dealId: string; hours: AutoReleaseHours | null },
): Promise<Policy> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ policy: schema.deal.clientPolicy })
      .from(schema.deal)
      .where(eq(schema.deal.id, input.dealId))
      .for("update");
    if (!row) throw new Error(`Deal ${input.dealId} not found`);
    const policy: Policy = {
      ...(row.policy ?? defaultClientPolicy()),
      autoReleaseAfterHours: input.hours,
    };
    await tx
      .update(schema.deal)
      .set({ clientPolicy: policy, updatedAt: new Date() })
      .where(eq(schema.deal.id, input.dealId));
    return policy;
  });
}
