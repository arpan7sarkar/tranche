import "server-only";
import type { ActionStatus, Policy } from "@tranche/contracts";
import { type Db, resolveMagicLink, schema } from "@tranche/db";
import { and, count, eq, inArray, notInArray, sql } from "drizzle-orm";
import { isUuid } from "@/lib/uuid";
import { getDb } from "./db";
import * as money from "./money";

export type AutoReleaseHours = 24 | 72 | 168;
export type ReleaseResult = "submitted" | "already_submitted" | "not_releasable";
export type AgreeResult = money.AgreeToPlanResult;

const UNSUCCESSFUL: ActionStatus[] = ["failed", "rejected"];

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

export function agreeFromPortal(
  db: Db,
  input: { dealId: string; planVersion: string },
): Promise<AgreeResult> {
  return money.agreeToPlan(db, input.dealId, input.planVersion);
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
