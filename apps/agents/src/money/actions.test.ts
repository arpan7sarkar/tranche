import { type Db, schema } from "@tranche/db";
import { createTestDb, truncateAll } from "@tranche/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { decideApproval, processActions, submitHumanAction } from "./actions";
import { ForbiddenError, must } from "./errors";
import { makeHold, makeMilestone, NOW, openPolicy, testDeps } from "./test-helpers";

let db: Db;

const actionOf = async (id: string) =>
  must((await db.select().from(schema.proposedAction).where(eq(schema.proposedAction.id, id)))[0]);

async function proposeRelease(dealId: string, milestoneId: string) {
  const [a] = await db
    .insert(schema.proposedAction)
    .values({
      dealId,
      agent: "negotiator",
      side: "client",
      type: "release",
      payload: { type: "release", milestoneId, amount: { currency: "USD", minor: 100000 } },
      reasoning: "test",
      idempotencyKey: "release:big:1",
    })
    .returning();
  return must(a);
}

async function overLimitRelease() {
  const ids = await makeMilestone(db, {
    state: "release_pending",
    heldMinor: 100000,
    verifiedAt: NOW,
    clientPolicy: { ...openPolicy, perActionMaxMinor: 50000 },
  });
  await makeHold(db, ids.milestoneId, { status: "active", authorizationId: "AUTH-1" });
  const action = await proposeRelease(ids.dealId, ids.milestoneId);
  await processActions(testDeps(db));
  const [approval] = await db.select().from(schema.approval);
  return { ...ids, action, approval: must(approval) };
}

describe.runIf(Boolean(process.env.DATABASE_URL))("processActions", () => {
  beforeAll(async () => {
    db = await createTestDb("agents");
  });
  beforeEach(async () => {
    await truncateAll(db);
  });
  afterAll(async () => {
    await db.$client.end();
  });

  it("holds an over-limit release for approval", async () => {
    const { dealId, clientId, action, approval } = await overLimitRelease();
    expect((await actionOf(action.id)).status).toBe("needs_approval");
    expect(approval).toMatchObject({ proposedActionId: action.id, side: "client", decision: null });
    expect(await db.select().from(schema.outbox)).toHaveLength(0);

    await decideApproval(
      db,
      {
        approvalId: approval.id,
        decision: "approved",
        decider: { side: "client", dealId, clientId },
      },
      NOW,
    );
    await processActions(testDeps(db));
    expect((await actionOf(action.id)).status).toBe("executed");
    expect(await db.select().from(schema.outbox)).toHaveLength(1);
  });

  it("only lets the approval's own side decide it", async () => {
    const { workspaceId, action, approval } = await overLimitRelease();
    const other = await makeMilestone(db);
    const decide = (decider: Parameters<typeof decideApproval>[1]["decider"]) =>
      decideApproval(db, { approvalId: approval.id, decision: "approved", decider }, NOW);

    await expect(decide({ side: "agency", workspaceId, userId: "agency-user" })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(
      decide({ side: "client", dealId: other.dealId, clientId: other.clientId }),
    ).rejects.toThrow(ForbiddenError);
    expect((await actionOf(action.id)).status).toBe("needs_approval");
    expect(must((await db.select().from(schema.approval))[0]).decision).toBeNull();
  });

  it("refuses an action that names another deal's milestone", async () => {
    const mine = await makeMilestone(db, { state: "verifying", heldMinor: 100000 });
    const theirs = await makeMilestone(db, { state: "verifying", heldMinor: 100000 });
    const [ev] = await db
      .insert(schema.evidence)
      .values({
        milestoneId: theirs.milestoneId,
        kind: "ci_green",
        checkIndex: 0,
        passed: false,
        summary: "CI red",
        data: {},
        contentHash: "hash-ci-0001",
      })
      .returning();
    const { id } = await submitHumanAction(db, {
      dealId: mine.dealId,
      agent: "human",
      side: "agency",
      reasoning: "Needs work",
      evidenceIds: [],
      idempotencyKey: "changes:foreign:1",
      payload: {
        type: "request_changes",
        milestoneId: theirs.milestoneId,
        evidenceIds: [must(ev).id],
        missing: ["tests"],
      },
    });
    await processActions(testDeps(db));
    expect(await actionOf(id)).toMatchObject({
      status: "rejected",
      decisionReason: "milestone does not belong to this deal",
    });
    const [m] = await db
      .select()
      .from(schema.milestone)
      .where(eq(schema.milestone.id, theirs.milestoneId));
    expect(m).toMatchObject({ state: "verifying", version: 0 });
  });
});
