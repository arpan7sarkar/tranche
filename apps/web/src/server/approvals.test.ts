import { createDb, type Db, migrateDb, schema } from "@tranche/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideApproval } from "./approvals";
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
    const input = {
      approvalId: approval.id,
      side: "agency" as const,
      scope: { workspaceId },
      decidedBy: "user-1",
    };
    const results = await Promise.all([
      decideApproval(db, { ...input, decision: "approved" }),
      decideApproval(db, { ...input, decidedBy: "user-2", decision: "rejected" }),
    ]);
    expect(results.sort()).toEqual(["already_decided", "decided"]);
    expect(await decideApproval(db, { ...input, decision: "approved" })).toBe("already_decided");
    const events = await db
      .select()
      .from(schema.event)
      .where(sql`${schema.event.payload}->>'approvalId' = ${approval.id}`);
    expect(events.filter((e) => e.type === "approval.decided")).toHaveLength(1);
  });

  it("refuses the wrong side, workspace or deal", async () => {
    const { workspaceId, deal } = await createDeal(db);
    const other = await createDeal(db);
    const approval = await addApproval(db, deal.id, { decision: null, side: "client" });
    const base = { approvalId: approval.id, decidedBy: "x", decision: "approved" as const };
    expect(await decideApproval(db, { ...base, side: "agency", scope: { workspaceId } })).toBe(
      "not_found",
    );
    expect(
      await decideApproval(db, { ...base, side: "client", scope: { dealId: other.deal.id } }),
    ).toBe("not_found");
    expect(
      await decideApproval(db, {
        ...base,
        side: "client",
        scope: { workspaceId: other.workspaceId },
      }),
    ).toBe("not_found");
    expect(
      await decideApproval(db, {
        ...base,
        approvalId: "not-a-uuid",
        side: "client",
        scope: { dealId: deal.id },
      }),
    ).toBe("not_found");
    const [untouched] = await db
      .select()
      .from(schema.approval)
      .where(eq(schema.approval.id, approval.id));
    expect(untouched?.decision).toBeNull();
    expect(await decideApproval(db, { ...base, side: "client", scope: { dealId: deal.id } })).toBe(
      "decided",
    );
  });
});
