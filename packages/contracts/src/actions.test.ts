import { describe, expect, it } from "vitest";
import { ACTION_EXECUTOR, ACTION_TYPES, ProposedActionInput } from "./actions";

const dealId = "6f1d7c4e-1b9a-4d55-9c3e-2a7b8e9f0a11";
const milestoneId = "0b7f3a2c-5d4e-4f61-8a9b-1c2d3e4f5a6b";
const evidenceId = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

describe("ProposedActionInput", () => {
  it("parses a verifier proposal", () => {
    const parsed = ProposedActionInput.parse({
      dealId,
      agent: "verifier",
      side: "agency",
      reasoning: "All checks passed",
      evidenceIds: [evidenceId],
      idempotencyKey: `verify:${milestoneId}:abc123`,
      payload: { type: "mark_verified", milestoneId, evidenceIds: [evidenceId] },
    });
    expect(parsed.payload.type).toBe("mark_verified");
  });

  it("rejects unknown action types", () => {
    const result = ProposedActionInput.safeParse({
      dealId,
      agent: "monitor",
      side: "system",
      reasoning: "x",
      evidenceIds: [],
      idempotencyKey: "monitor:12345678",
      payload: { type: "capture_everything" },
    });
    expect(result.success).toBe(false);
  });

  it("maps every action type to an executor", () => {
    for (const t of ACTION_TYPES) expect(ACTION_EXECUTOR[t]).toBeDefined();
  });
});

describe("ProposedActionInput edge cases", () => {
  const base = {
    dealId,
    agent: "verifier",
    side: "agency",
    reasoning: "All checks passed",
    evidenceIds: [evidenceId],
    idempotencyKey: `verify:${milestoneId}:abc123`,
  };

  it("parses a release proposal with an amount", () => {
    const parsed = ProposedActionInput.parse({
      ...base,
      agent: "system",
      side: "system",
      payload: { type: "release", milestoneId, amount: { currency: "USD", minor: 50000 } },
    });
    expect(parsed.payload.type).toBe("release");
  });

  it("rejects mark_verified without evidence", () => {
    const result = ProposedActionInput.safeParse({
      ...base,
      payload: { type: "mark_verified", milestoneId, evidenceIds: [] },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an idempotency key that is too short", () => {
    const result = ProposedActionInput.safeParse({
      ...base,
      idempotencyKey: "short",
      payload: { type: "mark_verified", milestoneId, evidenceIds: [evidenceId] },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-uuid deal id", () => {
    const result = ProposedActionInput.safeParse({
      ...base,
      dealId: "not-a-uuid",
      payload: { type: "mark_verified", milestoneId, evidenceIds: [evidenceId] },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown agent name", () => {
    const result = ProposedActionInput.safeParse({
      ...base,
      agent: "wizard",
      payload: { type: "mark_verified", milestoneId, evidenceIds: [evidenceId] },
    });
    expect(result.success).toBe(false);
  });

  it("routes money-moving action types to the money executor", () => {
    expect(ACTION_EXECUTOR.release).toBe("money");
    expect(ACTION_EXECUTOR.submit_dispute_evidence).toBe("money");
  });

  it("lists each action type once", () => {
    expect(new Set(ACTION_TYPES).size).toBe(ACTION_TYPES.length);
    expect(ACTION_TYPES).toContain("create_plan");
  });
});
