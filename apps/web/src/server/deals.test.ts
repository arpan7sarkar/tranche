import { createDb, type Db, migrateDb, schema } from "@tranche/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../../../../packages/db/src/seed";
import { getDealView, listDeals } from "./deals";
import { addApproval, createDeal, createWorkspace } from "./test-fixtures";

const url = process.env.DATABASE_URL;

describe.runIf(Boolean(url))("deal read model", () => {
  let db: Db;
  let ids: Awaited<ReturnType<typeof seed>>;

  beforeAll(async () => {
    db = createDb(url);
    await migrateDb(db);
    ids = await seed(db);
  });
  afterAll(async () => {
    await db.$client.end();
  });

  describe("getDealView", () => {
    it("returns milestones, tasks and dependencies for the owning workspace", async () => {
      const view = await getDealView(db, ids.dealId, { workspaceId: ids.workspaceId });
      expect(view?.deal.title).toBe("Acme storefront rebuild");
      expect(view?.milestones.map((m) => m.key)).toEqual(["design", "build", "launch"]);
      expect(view?.tasks).toHaveLength(6);
      expect(view?.dependencies.length).toBeGreaterThan(0);
    });

    it("returns null for another workspace", async () => {
      const other = await createWorkspace(db);
      expect(await getDealView(db, ids.dealId, { workspaceId: other.id })).toBeNull();
    });

    it("returns the deal for its client and null for another client", async () => {
      expect(await getDealView(db, ids.dealId, { clientId: ids.clientId })).not.toBeNull();
      expect(await getDealView(db, ids.dealId, { clientId: crypto.randomUUID() })).toBeNull();
    });

    it("returns null instead of throwing for a dealId that is not a UUID", async () => {
      for (const bad of ["not-a-uuid", "", "1", "' OR 1=1 --"]) {
        expect(await getDealView(db, bad, { workspaceId: ids.workspaceId })).toBeNull();
        expect(await getDealView(db, bad, { clientId: ids.clientId })).toBeNull();
      }
    });

    it("returns null for a well-formed dealId that does not exist", async () => {
      expect(
        await getDealView(db, crypto.randomUUID(), { workspaceId: ids.workspaceId }),
      ).toBeNull();
    });

    it("returns an empty read model for a deal with no milestones", async () => {
      const fx = await createDeal(db);
      const view = await getDealView(db, fx.deal.id, { workspaceId: fx.workspaceId });
      expect(view).toMatchObject({
        milestones: [],
        tasks: [],
        dependencies: [],
        activity: [],
        approvals: [],
      });
    });

    it("lists activity newest first, capped at 50", async () => {
      const fx = await createDeal(db);
      const inserted = await db
        .insert(schema.event)
        .values(
          Array.from({ length: 55 }, (_, n) => ({
            dealId: fx.deal.id,
            type: "deal.created" as const,
            payload: { n },
          })),
        )
        .returning({ id: schema.event.id });
      const newest50 = inserted
        .map((e) => e.id)
        .sort((a, b) => b - a)
        .slice(0, 50);

      const view = await getDealView(db, fx.deal.id, { workspaceId: fx.workspaceId });
      expect(view?.activity.map((e) => e.id)).toEqual(newest50);
    });

    it("keeps activity of other deals out of the view", async () => {
      const mine = await createDeal(db);
      const theirs = await createDeal(db);
      const [own] = await db
        .insert(schema.event)
        .values({ dealId: mine.deal.id, type: "deal.created", payload: {} })
        .returning({ id: schema.event.id });
      await db
        .insert(schema.event)
        .values({ dealId: theirs.deal.id, type: "deal.created", payload: {} });

      const view = await getDealView(db, mine.deal.id, { workspaceId: mine.workspaceId });
      expect(view?.activity.map((e) => e.id)).toEqual([own?.id]);
    });

    it("includes only undecided approvals", async () => {
      const fx = await createDeal(db);
      await addApproval(db, fx.deal.id, { decision: "approved" });
      await addApproval(db, fx.deal.id, { decision: "rejected", side: "client" });
      const pending = await addApproval(db, fx.deal.id, { decision: null, side: "client" });

      const view = await getDealView(db, fx.deal.id, { workspaceId: fx.workspaceId });
      expect(view?.approvals).toHaveLength(1);
      expect(view?.approvals[0]).toMatchObject({
        id: pending.id,
        side: "client",
        actionType: "flag_risk",
        agent: "monitor",
        reasoning: "because",
      });
    });

    it("shows a client only the client-side approvals", async () => {
      const fx = await createDeal(db);
      const agency = await addApproval(db, fx.deal.id, { decision: null, side: "agency" });
      const client = await addApproval(db, fx.deal.id, { decision: null, side: "client" });
      await addApproval(db, fx.deal.id, { decision: "approved", side: "client" });

      const clientView = await getDealView(db, fx.deal.id, { clientId: fx.clientId });
      expect(clientView?.approvals.map((x) => x.id)).toEqual([client.id]);
      expect(clientView?.approvals.every((x) => x.side === "client")).toBe(true);
      expect(JSON.stringify(clientView)).not.toContain(agency.id);
    });

    it("keeps both sides in the agency view", async () => {
      const fx = await createDeal(db);
      const agency = await addApproval(db, fx.deal.id, { decision: null, side: "agency" });
      const client = await addApproval(db, fx.deal.id, { decision: null, side: "client" });

      const agencyView = await getDealView(db, fx.deal.id, { workspaceId: fx.workspaceId });
      expect(agencyView?.approvals.map((x) => x.id).sort()).toEqual([agency.id, client.id].sort());
    });
  });

  describe("listDeals", () => {
    it("lists deals with totals", async () => {
      const deals = await listDeals(db, ids.workspaceId);
      expect(deals.find((d) => d.id === ids.dealId)?.total).toEqual({
        currency: "USD",
        minor: 840000,
      });
    });

    it("totals a deal with zero milestones as 0 rather than dropping it", async () => {
      const fx = await createDeal(db);
      const deals = await listDeals(db, fx.workspaceId);
      expect(deals).toHaveLength(1);
      expect(deals[0]).toMatchObject({
        id: fx.deal.id,
        clientName: "Client",
        total: { currency: "USD", minor: 0 },
      });
    });

    it("sums milestone prices per deal", async () => {
      const fx = await createDeal(db, { milestones: 3 });
      const deals = await listDeals(db, fx.workspaceId);
      expect(deals[0]?.total).toEqual({ currency: "USD", minor: 1000 + 2000 + 3000 });
    });

    it("returns nothing for a workspace without deals and never another workspace's deals", async () => {
      const empty = await createWorkspace(db);
      expect(await listDeals(db, empty.id)).toEqual([]);
    });
  });
});
