import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type MilestoneEvent, type MilestoneSnapshot, transition } from "./milestone";

const fresh: MilestoneSnapshot = {
  state: "draft",
  priceMinor: 100000,
  heldMinor: 0,
  releasedMinor: 0,
  verifiedAt: null,
  releaseAuthorizedAt: null,
};

const AT = "2026-10-10T10:00:00Z";

function run(events: MilestoneEvent[], from = fresh): MilestoneSnapshot {
  let s = from;
  for (const e of events) {
    const r = transition(s, e);
    if (!r.ok) throw new Error(`${e.type}: ${r.reason}`);
    s = r.next;
  }
  return s;
}

const happy: MilestoneEvent[] = [
  { type: "plan_agreed" },
  { type: "funding_requested" },
  { type: "hold_confirmed", amountMinor: 100000 },
  { type: "work_started" },
  { type: "delivered" },
  { type: "verification_started" },
  { type: "verification_passed", at: AT },
  { type: "release_approved", at: AT },
  { type: "release_confirmed", amountMinor: 100000 },
  { type: "payout_confirmed" },
];

describe("transition", () => {
  it("walks the happy path", () => {
    const s = run(happy);
    expect(s).toEqual({
      state: "paid_out",
      priceMinor: 100000,
      heldMinor: 100000,
      releasedMinor: 100000,
      verifiedAt: AT,
      releaseAuthorizedAt: AT,
    });
  });

  it("emits the domain events the agents listen for", () => {
    const delivered = run(happy.slice(0, 5));
    const r = transition(delivered, { type: "verification_started" });
    expect(r.ok && r.effects).toContainEqual({
      type: "emit",
      event: "milestone.verification_requested",
    });
  });

  it("asks for release money and auto-release timer at the right steps", () => {
    const verifying = run(happy.slice(0, 6));
    const passed = transition(verifying, { type: "verification_passed", at: AT });
    expect(passed.ok && passed.effects).toContainEqual({ type: "schedule_auto_release" });
    const pending = run(happy.slice(0, 7));
    const approved = transition(pending, { type: "release_approved", at: AT });
    expect(approved.ok && approved.effects).toContainEqual({
      type: "release_funds",
      amountMinor: 100000,
    });
  });

  it("allows auto-release instead of a client approval", () => {
    const pending = run(happy.slice(0, 7));
    const s = run(
      [
        { type: "auto_release_due", at: AT },
        { type: "release_confirmed", amountMinor: 100000 },
      ],
      pending,
    );
    expect(s.state).toBe("released");
  });

  it("loops back on failed verification and clears the old verdict on redelivery", () => {
    const verifying = run(happy.slice(0, 6));
    const s = run(
      [
        { type: "verification_failed", missing: ["Lighthouse 82 < 90"] },
        { type: "delivered" },
        { type: "verification_started" },
      ],
      verifying,
    );
    expect(s.state).toBe("verifying");
    expect(s.verifiedAt).toBeNull();
  });

  it("rejects releasing before verification", () => {
    const inProgress = run(happy.slice(0, 4));
    expect(transition(inProgress, { type: "release_approved", at: AT }).ok).toBe(false);
    expect(transition(inProgress, { type: "release_confirmed", amountMinor: 100000 }).ok).toBe(
      false,
    );
  });

  it("rejects a release confirmation without authorization", () => {
    const pending = run(happy.slice(0, 7));
    expect(transition(pending, { type: "release_confirmed", amountMinor: 100000 }).ok).toBe(false);
  });

  it("rejects a duplicate release confirmation", () => {
    const released = run(happy.slice(0, 9));
    const r = transition(released, { type: "release_confirmed", amountMinor: 100000 });
    expect(r.ok).toBe(false);
    expect(released.releasedMinor).toBe(100000);
  });

  it("rejects a hold smaller than the price", () => {
    const funding = run(happy.slice(0, 2));
    expect(transition(funding, { type: "hold_confirmed", amountMinor: 99999 }).ok).toBe(false);
  });

  it("rejects a second release authorization", () => {
    const authorized = run(happy.slice(0, 8));
    expect(transition(authorized, { type: "auto_release_due", at: AT }).ok).toBe(false);
  });

  it("voids the hold when a funded milestone is cancelled", () => {
    const held = run(happy.slice(0, 3));
    const r = transition(held, { type: "cancel" });
    expect(r.ok && r.next.state).toBe("cancelled");
    expect(r.ok && r.effects).toContainEqual({ type: "void_hold" });
  });

  it("resolves a dispute for the merchant back to where the money is", () => {
    const released = run(happy.slice(0, 9));
    const s = run(
      [{ type: "dispute_opened" }, { type: "dispute_resolved", outcome: "merchant" }],
      released,
    );
    expect(s.state).toBe("released");
    const held = run(happy.slice(0, 3));
    const s2 = run(
      [{ type: "dispute_opened" }, { type: "dispute_resolved", outcome: "merchant" }],
      held,
    );
    expect(s2.state).toBe("held");
    expect(s2.releaseAuthorizedAt).toBeNull();
  });

  it("refunds on a buyer-favoured dispute", () => {
    const held = run(happy.slice(0, 3));
    const s = run(
      [{ type: "dispute_opened" }, { type: "dispute_resolved", outcome: "buyer" }],
      held,
    );
    expect(s.state).toBe("refunded");
  });

  it("rejects every event in terminal states", () => {
    const terminal: MilestoneSnapshot[] = [
      run(happy),
      run([{ type: "cancel" }]),
      run([...happy.slice(0, 3), { type: "refund_confirmed" }]),
    ];
    for (const s of terminal) {
      for (const e of [
        ...happy,
        { type: "cancel" } as const,
        { type: "dispute_opened" } as const,
      ]) {
        if (s.state === "paid_out" && e.type === "dispute_opened") continue;
        expect(transition(s, e).ok).toBe(false);
      }
    }
  });
});

describe("release_failed", () => {
  const authorized = run(happy.slice(0, 8));
  const failed: MilestoneEvent = { type: "release_failed", reason: "payout declined" };

  it("clears the authorization and stays in release_pending", () => {
    const r = transition(authorized, failed);
    expect(r.ok && r.next).toEqual({ ...authorized, releaseAuthorizedAt: null });
    expect(r.ok && r.next.state).toBe("release_pending");
  });

  it("keeps the money facts and verdict unchanged", () => {
    const r = transition(authorized, failed);
    expect(r.ok && r.next.heldMinor).toBe(100000);
    expect(r.ok && r.next.releasedMinor).toBe(0);
    expect(r.ok && r.next.verifiedAt).toBe(AT);
  });

  it("only raises an alert and does not re-arm the auto-release timer", () => {
    const r = transition(authorized, failed);
    expect(r.ok && r.effects).toEqual([{ type: "emit", event: "alert.raised" }]);
  });

  it("allows a fresh approval to release again after a failure", () => {
    const afterFailure = run([failed], authorized);
    const r = transition(afterFailure, { type: "release_approved", at: AT });
    expect(r.ok && r.effects).toContainEqual({ type: "release_funds", amountMinor: 100000 });
    expect(r.ok && r.next.releaseAuthorizedAt).toBe(AT);
  });

  it("can fail and be retried repeatedly before the release is confirmed", () => {
    const s = run(
      [
        failed,
        { type: "release_approved", at: AT },
        failed,
        { type: "release_approved", at: AT },
        { type: "release_confirmed", amountMinor: 100000 },
      ],
      authorized,
    );
    expect(s.state).toBe("released");
    expect(s.releasedMinor).toBe(100000);
  });

  it("rejects a failure when no release is authorized", () => {
    const afterFailure = run([failed], authorized);
    expect(transition(afterFailure, failed).ok).toBe(false);
    expect(transition(run(happy.slice(0, 7)), failed).ok).toBe(false);
  });

  it("rejects a failure outside release_pending", () => {
    const outside: MilestoneSnapshot[] = [
      fresh,
      run(happy.slice(0, 3)),
      run(happy.slice(0, 4)),
      run(happy.slice(0, 5)),
      run(happy.slice(0, 6)),
      run(happy.slice(0, 9)),
      run(happy),
      run([{ type: "cancel" }]),
    ];
    for (const s of outside) {
      expect(transition(s, failed).ok).toBe(false);
    }
  });

  it("rejects a failure while disputed even with an authorization on record", () => {
    const disputed = run([{ type: "dispute_opened" }], authorized);
    expect(transition(disputed, failed).ok).toBe(false);
  });
});

const eventArb: fc.Arbitrary<MilestoneEvent> = fc.oneof(
  fc.constantFrom<MilestoneEvent>(
    { type: "plan_agreed" },
    { type: "funding_requested" },
    { type: "funding_failed", reason: "declined" },
    { type: "work_started" },
    { type: "delivered" },
    { type: "verification_started" },
    { type: "verification_passed", at: AT },
    { type: "verification_failed", missing: ["x"] },
    { type: "release_approved", at: AT },
    { type: "auto_release_due", at: AT },
    { type: "payout_confirmed" },
    { type: "dispute_opened" },
    { type: "dispute_resolved", outcome: "merchant" },
    { type: "dispute_resolved", outcome: "buyer" },
    { type: "refund_confirmed" },
    { type: "cancel" },
  ),
  fc
    .integer({ min: 0, max: 200000 })
    .map((amountMinor) => ({ type: "hold_confirmed" as const, amountMinor })),
  fc
    .integer({ min: 0, max: 200000 })
    .map((amountMinor) => ({ type: "release_confirmed" as const, amountMinor })),
);

const noisyHappyPath = fc
  .tuple(...happy.map((step) => fc.tuple(fc.array(eventArb, { maxLength: 3 }), fc.constant(step))))
  .map((parts) => parts.flatMap(([noise, step]) => [...noise, step]));

function checkInvariants(events: MilestoneEvent[]) {
  let s = fresh;
  for (const e of events) {
    const r = transition(s, e);
    if (!r.ok) continue;
    s = r.next;
    expect(s.releasedMinor).toBeLessThanOrEqual(s.heldMinor);
    if (s.state === "released" || s.state === "paid_out") {
      expect(s.verifiedAt).not.toBeNull();
      expect(s.releaseAuthorizedAt).not.toBeNull();
      expect(s.releasedMinor).toBeGreaterThan(0);
    }
  }
}

describe("transition invariants (property)", () => {
  it("never releases without verification and authorization, never over the hold", () => {
    fc.assert(fc.property(fc.array(eventArb, { maxLength: 60 }), checkInvariants));
    fc.assert(fc.property(noisyHappyPath, checkInvariants));
  });

  it("leaves the snapshot untouched when it rejects an event", () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 40 }), eventArb, (prefix, e) => {
        let s = fresh;
        for (const p of prefix) {
          const r = transition(s, p);
          if (r.ok) s = r.next;
        }
        const before = structuredClone(s);
        transition(s, e);
        expect(s).toEqual(before);
      }),
    );
  });
});
