import assert from "node:assert/strict";
import { agreeToPlan } from "@tranche/agents-service/money";
import type { AcceptanceCriteria, Policy } from "@tranche/contracts";
import { planVersion } from "@tranche/core";
import { createMagicLink, type Db, schema } from "@tranche/db";
import { asc, eq } from "drizzle-orm";
import { workspaceId } from "./environment";
import { type JourneyDeal, type SeedState, STAGING } from "./state";

const policy: Policy = {
  perActionMaxMinor: 1_000_000,
  perMilestoneMaxMinor: 1_000_000,
  perDealMaxMinor: 5_000_000,
  autoReleaseAfterHours: null,
  cooldownMinutes: 0,
  alwaysAsk: ["release"],
};

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, d: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);

async function deal(
  db: Db,
  workspaceId: string,
  title: string,
  criteria: AcceptanceCriteria,
  tasks: { key: string; days: number; after?: string }[],
  offset = 0,
): Promise<JourneyDeal> {
  const [client] = await db
    .insert(schema.client)
    .values({
      workspaceId,
      name: `${title} client`,
      email: `${title.toLowerCase().replace(/\W+/g, "-")}@client.test`,
    })
    .returning();
  const [d] = await db
    .insert(schema.deal)
    .values({
      workspaceId,
      clientId: must(client).id,
      title,
      brief: title,
      currency: "USD",
      status: "draft",
      agencyPolicy: policy,
      clientPolicy: policy,
    })
    .returning();
  const [m] = await db
    .insert(schema.milestone)
    .values({
      dealId: must(d).id,
      key: "work",
      position: 0,
      title: "Work",
      priceMinor: 100_000,
      criteria,
      payees: [{ kind: "agency", shareBps: 10000 }],
    })
    .returning();

  const taskIds: Record<string, string> = {};
  const ends: Record<string, string> = {};
  for (const [i, t] of tasks.entries()) {
    const start = t.after ? must(ends[t.after]) : addDays(today(), offset);
    ends[t.key] = addDays(start, t.days);
    const [row] = await db
      .insert(schema.task)
      .values({
        dealId: must(d).id,
        milestoneId: must(m).id,
        key: t.key,
        title: t.key,
        durationDays: t.days,
        startDate: start,
        position: i,
      })
      .returning();
    taskIds[t.key] = must(row).id;
    if (t.after)
      await db
        .insert(schema.taskDependency)
        .values({ fromTaskId: must(taskIds[t.after]), toTaskId: must(row).id });
  }

  assert(client && d && m);
  await db
    .update(schema.milestone)
    .set({
      startDate: addDays(today(), offset),
      endDate: Object.values(ends).sort().at(-1) ?? today(),
    })
    .where(eq(schema.milestone.id, m.id));
  const { token: portalToken } = await createMagicLink(db, {
    clientId: client.id,
    dealId: d.id,
    ttlDays: 7,
  });
  if (offset) {
    await db.update(schema.deal).set({ status: "sent" }).where(eq(schema.deal.id, d.id));
    await db
      .insert(schema.event)
      .values({ type: "deal.plan_sent", dealId: d.id, payload: { clientId: client.id } });
    const milestones = await db
      .select()
      .from(schema.milestone)
      .where(eq(schema.milestone.dealId, d.id))
      .orderBy(asc(schema.milestone.position));
    assert.equal(await agreeToPlan(db, d.id, planVersion("USD", milestones)), "agreed");
  }
  return { dealId: d.id, milestoneId: m.id, portalToken, taskIds };
}

export async function seedE2E(db: Db): Promise<SeedState> {
  const [ws] = await db
    .insert(schema.workspace)
    .values({
      id: workspaceId,
      name: "E2E Studio",
      paypalMerchantId: process.env.E2E_PAYPAL_MERCHANT_ID ?? "FAKEMERCHANT1",
      paypalOnboarding: "active",
      rateCard: { currency: "USD", dailyRateMinor: 60000, minimumProjectMinor: 0 },
    })
    .returning();
  const good: AcceptanceCriteria = {
    checks: [
      { kind: "url_live", url: `${STAGING}/good` },
      { kind: "lighthouse", url: `${STAGING}/good`, category: "performance", min: 90 },
    ],
    prose: [],
  };
  const missing: AcceptanceCriteria = {
    checks: [{ kind: "url_live", url: `${STAGING}/missing` }],
    prose: [],
  };

  return {
    workspaceId: must(ws).id,
    recovery: await deal(db, must(ws).id, "Delivery recovery", good, [{ key: "build", days: 3 }]),
    pullRequest: await deal(
      db,
      must(ws).id,
      "PR delivery",
      {
        checks: [
          { kind: "pr_merged", repo: "test/site", base: "main" },
          { kind: "ci_green", repo: "test/site" },
        ],
        prose: [],
      },
      [{ key: "build", days: 3 }],
    ),
    happy: await deal(db, must(ws).id, "Happy path", good, [{ key: "build", days: 3 }]),
    rejected: await deal(db, must(ws).id, "Rejected delivery", missing, [
      { key: "build", days: 3 },
    ]),
    slip: await deal(
      db,
      must(ws).id,
      "Slip and replan",
      good,
      [
        { key: "design", days: 5 },
        { key: "build", days: 5, after: "design" },
      ],
      7,
    ),
  };
}

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("fixture_missing");
  return value;
}
