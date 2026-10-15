import { createDb, type Db, migrateDb, schema } from "@tranche/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Decider, decideApproval } from "./approvals";
import { addApproval, createDeal } from "./test-fixtures";

const url = process.env.DATABASE_URL;

describe.runIf(Boolean(url))("decideApproval", { timeout: 20_000 }, () => {
  let db: Db;

  beforeAll(async () => {
    db = createDb(url);
    await migrateDb(db);
  });
  afterAll(async () => {
    await db.$client.end();
  });

  it("lets the first decision win and writes one event", async () => {
    const { workspaceId, deal } = await createDeal(db);
    const approval = await addApproval(db, deal.id, { decision: null });
    const agency = (userId: string) => ({ side: "agency" as const, workspaceId, userId });
    const results = await Promise.all([
      decideApproval(db, { approvalId: approval.id, decision: "approved", decider: agency("u1") }),
      decideApproval(db, { approvalId: approval.id, decision: "rejected", decider: agency("u2") }),
    ]);
    expect(results.sort()).toEqual(["already_decided", "decided"]);
    expect(
      await decideApproval(db, {
        approvalId: approval.id,
        decision: "approved",
        decider: agency("u1"),
      }),
    ).toBe("already_decided");
    const events = await db
      .select()
      .from(schema.event)
      .where(sql`${schema.event.payload}->>'approvalId' = ${approval.id}`);
    expect(events.filter((e) => e.type === "approval.decided")).toHaveLength(1);
  });

  it("refuses the wrong side, workspace or deal", async () => {
    const { workspaceId, clientId, deal } = await createDeal(db);
    const other = await createDeal(db);
    const approval = await addApproval(db, deal.id, { decision: null, side: "client" });
    const decide = (decider: Decider, approvalId = approval.id) =>
      decideApproval(db, { approvalId, decision: "approved", decider });

    expect(await decide({ side: "agency", workspaceId, userId: "u" })).toBe("not_found");
    expect(await decide({ side: "client", dealId: other.deal.id, clientId: other.clientId })).toBe(
      "not_found",
    );
    expect(await decide({ side: "client", dealId: deal.id, clientId }, "not-a-uuid")).toBe(
      "not_found",
    );
    const [untouched] = await db
      .select()
      .from(schema.approval)
      .where(eq(schema.approval.id, approval.id));
    expect(untouched?.decision).toBeNull();
    expect(await decide({ side: "client", dealId: deal.id, clientId })).toBe("decided");
  });
});
