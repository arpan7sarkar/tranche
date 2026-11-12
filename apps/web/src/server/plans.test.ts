import assert from "node:assert/strict";
import { type Db, schema } from "@tranche/db";
import { createTestDb, truncateAll } from "@tranche/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDraftDeal, draftStatus, saveDraft } from "./plans";

describe.runIf(Boolean(process.env.DATABASE_URL))("draft planning", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createTestDb("web_plans");
  });
  beforeEach(async () => {
    await truncateAll(db);
  });
  afterAll(async () => {
    await db?.$client.end();
  });
  it("persists the brief once, scopes status, and saves a reviewed draft without sending", async () => {
    const [ws] = await db
      .insert(schema.workspace)
      .values({
        name: "Test",
        rateCard: { currency: "USD", dailyRateMinor: 10000, minimumProjectMinor: 10000 },
      })
      .returning();
    assert(ws);
    const input = {
      requestId: crypto.randomUUID(),
      title: "Website",
      clientName: "Client",
      clientEmail: "client@example.com",
      brief: "Build a website with a working cart and useful navigation.",
      repo: null,
      stagingUrl: "https://example.com",
      startDate: "2026-11-02",
    };
    const [a, b] = await Promise.all([
      createDraftDeal(db, ws.id, input),
      createDraftDeal(db, ws.id, input),
    ]);
    expect(a).toEqual(b);
    await expect(createDraftDeal(db, ws.id, { ...input, title: "Other" })).rejects.toThrow(
      "draft_request_conflict",
    );
    expect(await draftStatus(db, crypto.randomUUID(), a.dealId)).toBeNull();
    const plan = {
      summary: "Site",
      currency: "USD",
      milestones: [
        {
          key: "build",
          title: "Build",
          price: { currency: "USD", minor: 10000 },
          criteria: { checks: [{ kind: "url_live" as const, url: input.stagingUrl }], prose: [] },
          payees: [{ kind: "agency" as const, shareBps: 10000 }],
        },
      ],
      tasks: [
        { key: "build", title: "Build", durationDays: 1, dependsOn: [], milestoneKey: "build" },
      ],
    };
    const [proposal] = await db
      .insert(schema.proposedAction)
      .values({
        dealId: a.dealId,
        agent: "planner",
        side: "agency",
        type: "create_plan",
        payload: { type: "create_plan", plan },
        reasoning: "Plan",
        idempotencyKey: crypto.randomUUID(),
      })
      .returning();
    assert(proposal);
    await expect(saveDraft(db, crypto.randomUUID(), a.dealId, proposal.id, plan)).rejects.toThrow(
      "draft_not_editable",
    );
    await saveDraft(db, ws.id, a.dealId, proposal.id, plan);
    const [deal] = await db.select().from(schema.deal).where(eq(schema.deal.id, a.dealId));
    expect(deal?.status).toBe("draft");
    const [ms] = await db
      .select()
      .from(schema.milestone)
      .where(eq(schema.milestone.dealId, a.dealId));
    expect(ms?.startDate).toBe(input.startDate);
    expect(ms?.endDate).toBe("2026-11-03");
    expect(
      await db
        .select()
        .from(schema.event)
        .where(and(eq(schema.event.dealId, a.dealId), eq(schema.event.type, "deal.plan_sent"))),
    ).toHaveLength(0);
    await expect(saveDraft(db, ws.id, a.dealId, proposal.id, plan)).rejects.toThrow(
      "draft_proposal_changed",
    );
  });
});

describe.runIf(Boolean(process.env.DATABASE_URL))("reference-only drafts", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createTestDb("web_reference_plans");
  });
  afterAll(async () => {
    await db.$client.end();
  });
  it.each([null, "https://www.figma.com/design/example"])(
    "saves a reviewable plan without a deployment URL: %s",
    async (referenceUrl) => {
      const [ws] = await db
        .insert(schema.workspace)
        .values({
          name: "Reference test",
          rateCard: { currency: "USD", dailyRateMinor: 10000, minimumProjectMinor: 10000 },
        })
        .returning();
      assert(ws);
      const { dealId } = await createDraftDeal(db, ws.id, {
        requestId: crypto.randomUUID(),
        title: "Portfolio",
        clientName: "Client",
        clientEmail: "client@example.com",
        brief: "Build an accessible portfolio website with projects and contact details.",
        repo: null,
        referenceUrl,
        startDate: "2026-11-12",
      });
      const plan = {
        summary: "Portfolio",
        currency: "USD",
        milestones: [
          {
            key: "build",
            title: "Build",
            price: { currency: "USD", minor: 20000 },
            criteria: { checks: [{ kind: "url_live" as const }], prose: [] },
            payees: [{ kind: "agency" as const, shareBps: 10000 }],
          },
        ],
        tasks: [
          { key: "build", title: "Build", durationDays: 2, dependsOn: [], milestoneKey: "build" },
        ],
      };
      const [proposal] = await db
        .insert(schema.proposedAction)
        .values({
          dealId,
          agent: "planner",
          side: "agency",
          type: "create_plan",
          payload: { type: "create_plan", plan },
          reasoning: "Validated",
          idempotencyKey: crypto.randomUUID(),
        })
        .returning();
      assert(proposal);
      expect(await draftStatus(db, ws.id, dealId)).toMatchObject({ status: "ready" });
      await saveDraft(db, ws.id, dealId, proposal.id, plan);
      const milestones = await db
        .select()
        .from(schema.milestone)
        .where(eq(schema.milestone.dealId, dealId));
      expect(milestones[0]?.criteria.checks).toEqual([{ kind: "url_live" }]);
      const events = await db.select().from(schema.event).where(eq(schema.event.dealId, dealId));
      expect(events.find((e) => e.type === "deal.created")?.payload.planning).toMatchObject({
        referenceUrl,
        stagingUrl: null,
      });
      expect(events.some((e) => e.type === "deal.plan_sent")).toBe(false);
    },
  );
});
