import type { ProposedActionInput } from "@tranche/contracts";
import { type Db, schema } from "@tranche/db";
import { truncateAll } from "@tranche/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAgentTestDb } from "../testing/database";
import { makeDeal } from "../testing/fixture";
import { consumeEvents } from "./dispatcher";
import { ModelDisabledError } from "./models";
import { proposeAction, recordEvidence } from "./persistence";

let db: Db;
const types = ["deal.created"] as const;
describe.runIf(Boolean(process.env.TEST_DATABASE_URL))("agent persistence and consumption", () => {
  beforeAll(async () => {
    db = await createAgentTestDb("agent_runtime");
  });
  beforeEach(async () => {
    await truncateAll(db);
  });
  afterAll(async () => {
    await db?.$client.end();
  });
  const input = (dealId: string): ProposedActionInput => ({
    dealId,
    agent: "monitor",
    side: "agency",
    reasoning: "A risk",
    evidenceIds: [],
    idempotencyKey: "test-risk-key",
    payload: { type: "flag_risk", milestoneId: null, severity: "low", message: "Review" },
  });
  const event = async () => {
    const [row] = await db
      .insert(schema.event)
      .values({ type: "deal.created", payload: {} })
      .returning();
    if (!row) throw new Error("event missing");
    return row;
  };
  it("stores one pending proposal on concurrent duplicate delivery", async () => {
    const { dealId } = await makeDeal(db);
    const results = await Promise.all([
      proposeAction(db, input(dealId)),
      proposeAction(db, input(dealId)),
    ]);
    expect(results[0]?.id).toBe(results[1]?.id);
    expect(results.filter((row) => row.created)).toHaveLength(1);
    expect((await db.select().from(schema.proposedAction))[0]?.status).toBe("pending");
    await expect(proposeAction(db, { ...input(dealId), reasoning: "Changed" })).rejects.toThrow(
      "proposal_identity_conflict",
    );
  });
  it("rejects privileged identity and foreign resources", async () => {
    const a = await makeDeal(db);
    const b = await makeDeal(db);
    for (const agent of ["human", "system"] as const)
      await expect(proposeAction(db, { ...input(a.dealId), agent })).rejects.toThrow(
        "agent_identity_required",
      );
    await expect(
      proposeAction(db, {
        ...input(a.dealId),
        payload: {
          type: "release",
          milestoneId: b.milestoneId,
          amount: { currency: "USD", minor: 100 },
        },
      }),
    ).rejects.toThrow("foreign_milestone");
    await proposeAction(db, input(a.dealId));
    await expect(proposeAction(db, input(b.dealId))).rejects.toThrow("proposal_identity_conflict");
  });
  it("deduplicates null-index evidence and rejects conflicting or foreign evidence", async () => {
    const a = await makeDeal(db);
    const b = await makeDeal(db);
    const evidence = {
      milestoneId: a.milestoneId,
      kind: "screenshot" as const,
      checkIndex: null,
      passed: null,
      summary: "Screenshot",
      data: {},
      contentHash: "hash-123456",
    };
    const rows = await Promise.all([
      recordEvidence(db, evidence, a.dealId),
      recordEvidence(db, evidence, a.dealId),
    ]);
    const first = rows[0];
    if (!first) throw new Error("missing_evidence");
    expect(first.id).toBe(rows[1]?.id);
    await expect(recordEvidence(db, { ...evidence, summary: "changed" }, a.dealId)).rejects.toThrow(
      "evidence_identity_conflict",
    );
    await expect(recordEvidence(db, evidence, b.dealId)).rejects.toThrow("foreign_milestone");
    await expect(
      proposeAction(db, { ...input(b.dealId), evidenceIds: [first.id] }),
    ).rejects.toThrow("foreign_evidence");
  });
  it("rejects unresolved task, negotiation, and dispute references", async () => {
    const { dealId, milestoneId } = await makeDeal(db);
    const evidence = await recordEvidence(
      db,
      {
        milestoneId,
        kind: "screenshot",
        checkIndex: null,
        passed: null,
        summary: "Test",
        data: {},
        contentHash: "hash-123456",
      },
      dealId,
    );
    await expect(
      proposeAction(db, {
        ...input(dealId),
        payload: {
          type: "reschedule",
          shifts: [{ taskId: crypto.randomUUID(), start: "2026-10-20" }],
          reason: "Move",
        },
      }),
    ).rejects.toThrow("foreign_task");
    await expect(
      proposeAction(db, {
        ...input(dealId),
        payload: { type: "escalate", negotiationId: crypto.randomUUID(), reason: "Review" },
      }),
    ).rejects.toThrow("foreign_negotiation");
    await expect(
      proposeAction(db, {
        ...input(dealId),
        payload: {
          type: "submit_dispute_evidence",
          disputeId: "UNOWNED",
          notes: "Test",
          evidenceIds: [evidence.id],
        },
      }),
    ).rejects.toThrow("foreign_dispute");
    expect(await db.select().from(schema.proposedAction)).toHaveLength(0);
  });
  it("retries a failed event without replaying committed earlier events", async () => {
    const a = await event();
    const b = await event();
    const seen: number[] = [];
    expect(
      await consumeEvents(db, "retry", types, async (row) => {
        if (row.id === b.id) throw new Error("fail");
        seen.push(row.id);
      }),
    ).toBe(1);
    expect(
      await consumeEvents(db, "retry", types, async (row) => {
        seen.push(row.id);
      }),
    ).toBe(1);
    expect(seen).toEqual([a.id, b.id]);
    expect(await consumeEvents(db, "retry", types, async () => {})).toBe(0);
  });
  it("leaves model-disabled events pending for a later run", async () => {
    await event();
    expect(
      await consumeEvents(db, "disabled", types, async () => {
        throw new ModelDisabledError();
      }),
    ).toBe(0);
    expect(await db.select().from(schema.agentEventReceipt)).toHaveLength(0);
    expect(await consumeEvents(db, "disabled", types, async () => {})).toBe(1);
  });
  it("excludes overlapping runs for the same consumer", async () => {
    await event();
    let unlock!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const first = consumeEvents(db, "overlap", types, async () => {
      entered();
      await gate;
    });
    await started;
    try {
      expect(
        await consumeEvents(db, "overlap", types, async () => {
          throw new Error("must not execute");
        }),
      ).toBe(0);
    } finally {
      unlock();
    }
    expect(await first).toBe(1);
  });
  it("processes a lower event ID that commits after a higher ID", async () => {
    let commit!: () => void;
    let inserted!: () => void;
    const gate = new Promise<void>((resolve) => {
      commit = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      inserted = resolve;
    });
    const slow = db.transaction(async (tx) => {
      await tx.insert(schema.event).values({ type: "deal.created", payload: {} });
      inserted();
      await gate;
    });
    await ready;
    try {
      await event();
      expect(await consumeEvents(db, "late", types, async () => {})).toBe(1);
    } finally {
      commit();
      await slow;
    }
    expect(await consumeEvents(db, "late", types, async () => {})).toBe(1);
    expect(await db.select().from(schema.agentEventReceipt)).toHaveLength(2);
  });
  it("rotates independent work past paused events and retries them without losing receipts", async () => {
    const paused = await event();
    const machine = await event();
    const seen: number[] = [];
    const handler = async (row: { id: number }) => {
      if (row.id === paused.id) throw new ModelDisabledError();
      seen.push(row.id);
    };
    expect(await consumeEvents(db, "independent", types, handler, 1, true)).toBe(0);
    expect(await consumeEvents(db, "independent", types, handler, 1, true)).toBe(1);
    expect(seen).toEqual([machine.id]);
    expect(
      await consumeEvents(
        db,
        "independent",
        types,
        async (row) => {
          seen.push(row.id);
        },
        1,
        true,
      ),
    ).toBe(1);
    expect(seen).toEqual([machine.id, paused.id]);
    expect(await db.select().from(schema.agentEventReceipt)).toHaveLength(2);
  });
});
