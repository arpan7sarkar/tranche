# H1 - Core State Machine and Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `packages/core`, the pure decision layer every money movement passes through: the milestone state machine, the policy engine, the verification gate, plan scheduling and mandate checks.

**Architecture:** Every function is pure and synchronous: no I/O, no clock reads, no randomness; callers pass `now` and data in. The state machine works on a `MilestoneSnapshot` (state plus the money facts it guards) so invariants such as "released never exceeds held" are enforced in one place and proven with fast-check property tests.

**Tech Stack:** TypeScript 7, Zod 4.6 types from `@tranche/contracts`, Vitest 5, fast-check 4.10.

**Spec:** `docs/superpowers/specs/2026-10-08-tranche-design.md` (sections 8, 9, 10) and `docs/superpowers/plans/2026-10-08-00-foundation.md` (contracts).

**Owner:** Person H. Person E consumes `verificationGate`, `schedulePlan`, `withinMandate`; changing their signatures needs Person E's review.

## Integration overrides

The [integration contract](2026-10-08-01-integration-contract.md) wins over anything in this plan that conflicts with it.
Items that affect this plan:

- The default agency policy you define lists `reschedule` in `alwaysAsk` (contract section 8).
- `verificationGate` evidence items carry `createdAt` as an ISO string; Person E's verifier relies on this exact `EvidenceFact` shape (section 4).

## Global Constraints

- `packages/core` is pure: no I/O, no network, no DB, no `Date.now()`, no `Math.random()`.
- Money is integer minor units; never floats for amounts.
- Calendar dates are `YYYY-MM-DD` strings computed in UTC; instants are ISO 8601 strings.
- A task's `end` is exclusive: a 3-day task starting `2026-10-10` ends `2026-10-13`, and a dependent may start `2026-10-13`.
- No em dash characters anywhere; use a plain `-`.
- Comments only when they carry real value.
- Conventional commits, no AI co-author lines.

## Review Focus

- **The same release confirmed twice** (sync PayPal response and the webhook both report it): the second `release_confirmed` is rejected and `releasedMinor` does not change - pinned in Task 4 Step 1 ("rejects a duplicate release confirmation").
- **Two evidence rows for one check with the same timestamp, one passed and one failed**: the gate treats the check as failing - pinned in Task 3 Step 1 ("treats a same-timestamp conflict as failing").
- **A person releasing more than is still held**: rejected even though human actions skip the agent limits - pinned in Task 5 Step 1 ("rejects a human release above the held amount").
- **Dates across month ends and leap days, and malformed dates** (`2028-02-28` plus 1 day, `2026-02-30`): correct rollover, malformed input throws - pinned in Task 1 Step 1 ("rolls over leap days" and "rejects impossible dates").
- **A plan ending exactly on the mandate's latest end date**: accepted, the boundary is inclusive - pinned in Task 2 Step 1 ("accepts a plan ending on the latest end date").

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/dates.ts` | `addDays`, `daysBetween`, `minDate`, `maxDate` on `YYYY-MM-DD` |
| `packages/core/src/schedule.ts` | `schedulePlan`, `milestoneWindows`, `withinMandate`, `FUND_LEAD_DAYS`, `fundingDueDate` |
| `packages/core/src/verification.ts` | `verificationGate` |
| `packages/core/src/milestone.ts` | `MilestoneSnapshot`, `MilestoneEvent`, `Effect`, `transition` |
| `packages/core/src/policy.ts` | `PolicyContext`, `PolicyDecision`, `evaluatePolicy` |
| `packages/core/src/index.ts` | Re-exports |
| `packages/core/src/*.test.ts` | Unit and property tests next to each module |

---

### Task 1: Dates and plan scheduling

**Files:**
- Create: `packages/core/src/dates.ts`, `packages/core/src/schedule.ts`
- Test: `packages/core/src/dates.test.ts`, `packages/core/src/schedule.test.ts`
- Modify: `packages/core/package.json` (add `fast-check` dev dependency)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `addDays(isoDate: string, days: number): string`
  - `daysBetween(from: string, to: string): number`
  - `minDate(a: string, b: string): string`, `maxDate(a: string, b: string): string`
  - `type Window = { start: string; end: string }`
  - `type ScheduleTask = { key: string; durationDays: number; dependsOn: string[] }`
  - `schedulePlan(tasks: ScheduleTask[], startDate: string): Map<string, Window>` (throws on unknown dependency or cycle)
  - `milestoneWindows(tasks: Array<{ key: string; milestoneKey: string }>, schedule: Map<string, Window>): Map<string, Window>`
  - `FUND_LEAD_DAYS = 3`, `fundingDueDate(milestoneStart: string, today: string): string`

- [ ] **Step 1: Add fast-check**

```bash
pnpm --filter @tranche/core add -D fast-check@4.10.2
```

- [ ] **Step 2: Write the failing tests**

`packages/core/src/dates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { addDays, daysBetween, maxDate, minDate } from "./dates";

describe("dates", () => {
  it("adds days across month ends", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-10-05", -5)).toBe("2026-09-30");
  });

  it("rolls over leap days", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
  });

  it("rejects impossible dates", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow();
    expect(() => addDays("2026-1-5", 1)).toThrow();
    expect(() => addDays("not a date", 1)).toThrow();
  });

  it("counts days between dates", () => {
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(30);
    expect(daysBetween("2026-10-31", "2026-10-01")).toBe(-30);
  });

  it("compares dates", () => {
    expect(maxDate("2026-10-01", "2026-09-30")).toBe("2026-10-01");
    expect(minDate("2026-10-01", "2026-09-30")).toBe("2026-09-30");
  });
});
```

`packages/core/src/schedule.test.ts`:

```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fundingDueDate, milestoneWindows, schedulePlan } from "./schedule";

describe("schedulePlan", () => {
  it("starts tasks without dependencies on the start date", () => {
    const s = schedulePlan([{ key: "a", durationDays: 3, dependsOn: [] }], "2026-10-10");
    expect(s.get("a")).toEqual({ start: "2026-10-10", end: "2026-10-13" });
  });

  it("starts a task when its latest dependency ends", () => {
    const s = schedulePlan(
      [
        { key: "a", durationDays: 3, dependsOn: [] },
        { key: "b", durationDays: 5, dependsOn: [] },
        { key: "c", durationDays: 2, dependsOn: ["a", "b"] },
      ],
      "2026-10-10",
    );
    expect(s.get("c")).toEqual({ start: "2026-10-15", end: "2026-10-17" });
  });

  it("does not depend on input order", () => {
    const s = schedulePlan(
      [
        { key: "c", durationDays: 2, dependsOn: ["a"] },
        { key: "a", durationDays: 3, dependsOn: [] },
      ],
      "2026-10-10",
    );
    expect(s.get("c")?.start).toBe("2026-10-13");
  });

  it("throws on cycles and unknown dependencies", () => {
    expect(() =>
      schedulePlan(
        [
          { key: "a", durationDays: 1, dependsOn: ["b"] },
          { key: "b", durationDays: 1, dependsOn: ["a"] },
        ],
        "2026-10-10",
      ),
    ).toThrow(/cycle/);
    expect(() => schedulePlan([{ key: "a", durationDays: 1, dependsOn: ["x"] }], "2026-10-10")).toThrow(/Unknown task/);
  });

  it("respects every dependency (property)", () => {
    const dag = fc.integer({ min: 1, max: 15 }).chain((n) =>
      fc.tuple(
        ...Array.from({ length: n }, (_, i) =>
          fc.record({
            durationDays: fc.integer({ min: 1, max: 10 }),
            deps: fc.subarray(Array.from({ length: i }, (_, j) => j)),
          }),
        ),
      ),
    );
    fc.assert(
      fc.property(dag, (spec) => {
        const tasks = spec.map((t, i) => ({
          key: `t${i}`,
          durationDays: t.durationDays,
          dependsOn: t.deps.map((d) => `t${d}`),
        }));
        const s = schedulePlan(tasks, "2026-10-10");
        for (const t of tasks) {
          const w = s.get(t.key)!;
          const latestDepEnd = t.dependsOn.map((d) => s.get(d)!.end).sort().at(-1) ?? "2026-10-10";
          expect(w.start).toBe(latestDepEnd > "2026-10-10" ? latestDepEnd : "2026-10-10");
          for (const d of t.dependsOn) expect(w.start >= s.get(d)!.end).toBe(true);
        }
      }),
    );
  });
});

describe("milestoneWindows", () => {
  it("spans the earliest start and latest end of a milestone's tasks", () => {
    const s = schedulePlan(
      [
        { key: "a", durationDays: 3, dependsOn: [] },
        { key: "b", durationDays: 2, dependsOn: ["a"] },
        { key: "c", durationDays: 1, dependsOn: ["b"] },
      ],
      "2026-10-10",
    );
    const w = milestoneWindows(
      [
        { key: "a", milestoneKey: "m1" },
        { key: "b", milestoneKey: "m1" },
        { key: "c", milestoneKey: "m2" },
      ],
      s,
    );
    expect(w.get("m1")).toEqual({ start: "2026-10-10", end: "2026-10-15" });
    expect(w.get("m2")).toEqual({ start: "2026-10-15", end: "2026-10-16" });
  });
});

describe("fundingDueDate", () => {
  it("funds three days before the milestone starts", () => {
    expect(fundingDueDate("2026-10-20", "2026-10-01")).toBe("2026-10-17");
  });

  it("never schedules funding in the past", () => {
    expect(fundingDueDate("2026-10-02", "2026-10-01")).toBe("2026-10-01");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @tranche/core exec vitest run src/dates.test.ts src/schedule.test.ts`
Expected: FAIL with "Failed to resolve import ./dates" and "./schedule".

- [ ] **Step 4: Implement**

`packages/core/src/dates.ts`:

```ts
const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parse(isoDate: string): Date {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (!ISO_DATE.test(isoDate) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== isoDate) {
    throw new Error(`Invalid date: ${isoDate}`);
  }
  return d;
}

export function addDays(isoDate: string, days: number): string {
  const d = parse(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / DAY_MS);
}

export function minDate(a: string, b: string): string {
  return a < b ? a : b;
}

export function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}
```

`packages/core/src/schedule.ts`:

```ts
import { addDays, maxDate, minDate } from "./dates";

export type Window = { start: string; end: string };
export type ScheduleTask = { key: string; durationDays: number; dependsOn: string[] };

export function schedulePlan(tasks: ScheduleTask[], startDate: string): Map<string, Window> {
  const byKey = new Map(tasks.map((t) => [t.key, t]));
  const result = new Map<string, Window>();
  const visiting = new Set<string>();

  const visit = (key: string): Window => {
    const done = result.get(key);
    if (done) return done;
    const task = byKey.get(key);
    if (!task) throw new Error(`Unknown task "${key}"`);
    if (visiting.has(key)) throw new Error(`Dependency cycle at "${key}"`);
    visiting.add(key);
    let start = startDate;
    for (const dep of task.dependsOn) start = maxDate(start, visit(dep).end);
    visiting.delete(key);
    const window = { start, end: addDays(start, task.durationDays) };
    result.set(key, window);
    return window;
  };

  for (const t of tasks) visit(t.key);
  return result;
}

export function milestoneWindows(
  tasks: Array<{ key: string; milestoneKey: string }>,
  schedule: Map<string, Window>,
): Map<string, Window> {
  const out = new Map<string, Window>();
  for (const t of tasks) {
    const w = schedule.get(t.key);
    if (!w) throw new Error(`Task "${t.key}" is not scheduled`);
    const cur = out.get(t.milestoneKey);
    out.set(t.milestoneKey, cur ? { start: minDate(cur.start, w.start), end: maxDate(cur.end, w.end) } : w);
  }
  return out;
}

export const FUND_LEAD_DAYS = 3;

export function fundingDueDate(milestoneStart: string, today: string): string {
  return maxDate(today, addDays(milestoneStart, -FUND_LEAD_DAYS));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @tranche/core exec vitest run src/dates.test.ts src/schedule.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core pnpm-lock.yaml
git commit -m "feat(core): Add date helpers and dependency-aware plan scheduling"
```

---

### Task 2: Mandate check

**Files:**
- Modify: `packages/core/src/schedule.ts`
- Test: `packages/core/src/mandate.test.ts`

**Interfaces:**
- Consumes: `schedulePlan`, `maxDate` (Task 1); `PlanDraft`, `Mandate` from `@tranche/contracts`.
- Produces: `withinMandate(plan: PlanDraft, mandate: Mandate, startDate: string): { ok: true } | { ok: false; reason: string }`. Person E's negotiator calls this on every offer.

- [ ] **Step 1: Write the failing test**

`packages/core/src/mandate.test.ts`:

```ts
import type { Mandate, PlanDraft } from "@tranche/contracts";
import { describe, expect, it } from "vitest";
import { withinMandate } from "./schedule";

const plan: PlanDraft = {
  summary: "Site",
  currency: "USD",
  milestones: [
    {
      key: "m1",
      title: "Build",
      price: { currency: "USD", minor: 500000 },
      criteria: { checks: [{ kind: "url_live", url: "https://example.com" }], prose: [] },
      payees: [{ kind: "agency", shareBps: 10000 }],
    },
  ],
  tasks: [
    { key: "a", title: "A", durationDays: 5, dependsOn: [], milestoneKey: "m1" },
    { key: "b", title: "B", durationDays: 5, dependsOn: ["a"], milestoneKey: "m1" },
  ],
};

const client = (limitMinor: number, latestEndDate: string | null = null): Mandate => ({
  side: "client",
  limitMinor,
  latestEndDate,
  maxRounds: 4,
});

describe("withinMandate", () => {
  it("accepts a plan within the client budget", () => {
    expect(withinMandate(plan, client(500000), "2026-10-10")).toEqual({ ok: true });
  });

  it("rejects a plan over the client budget", () => {
    const r = withinMandate(plan, client(499999), "2026-10-10");
    expect(r).toEqual({ ok: false, reason: "total 500000 exceeds the client limit 499999" });
  });

  it("rejects a plan below the agency minimum", () => {
    const r = withinMandate(plan, { side: "agency", limitMinor: 600000, latestEndDate: null, maxRounds: 4 }, "2026-10-10");
    expect(r).toEqual({ ok: false, reason: "total 500000 is below the agency minimum 600000" });
  });

  it("accepts a plan ending on the latest end date", () => {
    expect(withinMandate(plan, client(500000, "2026-10-20"), "2026-10-10")).toEqual({ ok: true });
  });

  it("rejects a plan ending after the latest end date", () => {
    const r = withinMandate(plan, client(500000, "2026-10-19"), "2026-10-10");
    expect(r).toEqual({ ok: false, reason: "plan ends 2026-10-20, after the latest end date 2026-10-19" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tranche/core exec vitest run src/mandate.test.ts`
Expected: FAIL with "withinMandate is not a function" or a missing export error.

- [ ] **Step 3: Implement**

Append to `packages/core/src/schedule.ts`:

```ts
import type { Mandate, PlanDraft } from "@tranche/contracts";

export function withinMandate(
  plan: PlanDraft,
  mandate: Mandate,
  startDate: string,
): { ok: true } | { ok: false; reason: string } {
  const total = plan.milestones.reduce((sum, m) => sum + m.price.minor, 0);
  if (mandate.side === "client" && total > mandate.limitMinor) {
    return { ok: false, reason: `total ${total} exceeds the client limit ${mandate.limitMinor}` };
  }
  if (mandate.side === "agency" && total < mandate.limitMinor) {
    return { ok: false, reason: `total ${total} is below the agency minimum ${mandate.limitMinor}` };
  }
  if (mandate.latestEndDate) {
    const schedule = schedulePlan(plan.tasks, startDate);
    const end = [...schedule.values()].reduce((e, w) => maxDate(e, w.end), startDate);
    if (end > mandate.latestEndDate) {
      return { ok: false, reason: `plan ends ${end}, after the latest end date ${mandate.latestEndDate}` };
    }
  }
  return { ok: true };
}
```

Move the new `import type` line to the top of the file with the other imports.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @tranche/core exec vitest run src/mandate.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schedule.ts packages/core/src/mandate.test.ts
git commit -m "feat(core): Add mandate check for negotiated plans"
```

---

### Task 3: Verification gate

**Files:**
- Create: `packages/core/src/verification.ts`
- Test: `packages/core/src/verification.test.ts`

**Interfaces:**
- Consumes: `AcceptanceCriteria` from `@tranche/contracts`.
- Produces: `verificationGate(criteria: AcceptanceCriteria, evidence: Array<{ checkIndex: number | null; passed: boolean | null; createdAt: string }>): { passed: boolean; failing: number[] }`. Person E's verifier calls it before proposing `mark_verified`; Person H's action processor calls it again before executing one.

- [ ] **Step 1: Write the failing test**

`packages/core/src/verification.test.ts`:

```ts
import type { AcceptanceCriteria } from "@tranche/contracts";
import { describe, expect, it } from "vitest";
import { verificationGate } from "./verification";

const criteria: AcceptanceCriteria = {
  checks: [
    { kind: "ci_green", repo: "acme/site" },
    { kind: "url_live", url: "https://staging.acme.test" },
  ],
  prose: [],
};

const ev = (checkIndex: number | null, passed: boolean | null, createdAt: string) => ({ checkIndex, passed, createdAt });

describe("verificationGate", () => {
  it("passes when the latest evidence for every check passed", () => {
    expect(
      verificationGate(criteria, [ev(0, true, "2026-10-10T10:00:00Z"), ev(1, true, "2026-10-10T10:00:00Z")]),
    ).toEqual({ passed: true, failing: [] });
  });

  it("fails checks with no evidence", () => {
    expect(verificationGate(criteria, [ev(0, true, "2026-10-10T10:00:00Z")])).toEqual({ passed: false, failing: [1] });
  });

  it("uses the latest evidence per check", () => {
    const evidence = [
      ev(0, true, "2026-10-10T10:00:00Z"),
      ev(0, false, "2026-10-10T11:00:00Z"),
      ev(1, false, "2026-10-10T10:00:00Z"),
      ev(1, true, "2026-10-10T11:00:00+01:00"),
    ];
    expect(verificationGate(criteria, evidence)).toEqual({ passed: false, failing: [0, 1] });
  });

  it("treats a same-timestamp conflict as failing", () => {
    const evidence = [
      ev(0, true, "2026-10-10T10:00:00Z"),
      ev(0, false, "2026-10-10T10:00:00Z"),
      ev(1, true, "2026-10-10T10:00:00Z"),
    ];
    expect(verificationGate(criteria, evidence)).toEqual({ passed: false, failing: [0] });
  });

  it("ignores informational and out-of-range evidence", () => {
    const evidence = [
      ev(null, true, "2026-10-10T12:00:00Z"),
      ev(7, true, "2026-10-10T12:00:00Z"),
      ev(0, null, "2026-10-10T12:00:00Z"),
      ev(1, true, "2026-10-10T12:00:00Z"),
    ];
    expect(verificationGate(criteria, evidence)).toEqual({ passed: false, failing: [0] });
  });
});
```

The third case pins offset-aware comparison: `11:00+01:00` equals `10:00Z`, so check 1 has a same-instant conflict and fails.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tranche/core exec vitest run src/verification.test.ts`
Expected: FAIL with "Failed to resolve import ./verification".

- [ ] **Step 3: Implement**

`packages/core/src/verification.ts`:

```ts
import type { AcceptanceCriteria } from "@tranche/contracts";

type EvidenceFact = { checkIndex: number | null; passed: boolean | null; createdAt: string };

export function verificationGate(
  criteria: AcceptanceCriteria,
  evidence: EvidenceFact[],
): { passed: boolean; failing: number[] } {
  const latest = new Map<number, { at: number; passed: boolean }>();
  for (const e of evidence) {
    if (e.checkIndex === null || e.checkIndex >= criteria.checks.length) continue;
    const at = Date.parse(e.createdAt);
    const passed = e.passed === true;
    const cur = latest.get(e.checkIndex);
    if (!cur || at > cur.at) latest.set(e.checkIndex, { at, passed });
    else if (at === cur.at && !passed) latest.set(e.checkIndex, { at, passed: false });
  }
  const failing = criteria.checks.map((_, i) => i).filter((i) => latest.get(i)?.passed !== true);
  return { passed: failing.length === 0, failing };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @tranche/core exec vitest run src/verification.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/verification.ts packages/core/src/verification.test.ts
git commit -m "feat(core): Add verification gate over machine-check evidence"
```

---

### Task 4: Milestone state machine

**Files:**
- Create: `packages/core/src/milestone.ts`
- Test: `packages/core/src/milestone.test.ts`

**Interfaces:**
- Consumes: `MilestoneState`, `DomainEventType` from `@tranche/contracts`.
- Produces:

```ts
export type MilestoneSnapshot = {
  state: MilestoneState;
  priceMinor: number;
  heldMinor: number;
  releasedMinor: number;
  verifiedAt: string | null;
  releaseAuthorizedAt: string | null;
};

export type MilestoneEvent =
  | { type: "plan_agreed" }
  | { type: "funding_requested" }
  | { type: "funding_failed"; reason: string }
  | { type: "hold_confirmed"; amountMinor: number }
  | { type: "work_started" }
  | { type: "delivered" }
  | { type: "verification_started" }
  | { type: "verification_passed"; at: string }
  | { type: "verification_failed"; missing: string[] }
  | { type: "release_approved"; at: string }
  | { type: "auto_release_due"; at: string }
  | { type: "release_confirmed"; amountMinor: number }
  | { type: "payout_confirmed" }
  | { type: "dispute_opened" }
  | { type: "dispute_resolved"; outcome: "merchant" | "buyer" }
  | { type: "refund_confirmed" }
  | { type: "cancel" };

export type Effect =
  | { type: "emit"; event: DomainEventType }
  | { type: "schedule_funding" }
  | { type: "schedule_auto_release" }
  | { type: "release_funds"; amountMinor: number }
  | { type: "pay_out" }
  | { type: "void_hold" }
  | { type: "cancel_timers" };

export type TransitionResult =
  | { ok: true; next: MilestoneSnapshot; effects: Effect[] }
  | { ok: false; reason: string };

export function transition(snapshot: MilestoneSnapshot, event: MilestoneEvent): TransitionResult;
```

The binding signature named `transition(state, event)`; it takes a `MilestoneSnapshot` instead because "released never exceeds held" and "no release without verification and authorization" cannot be enforced from the state name alone.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/milestone.test.ts`:

```ts
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
    expect(r.ok && r.effects).toContainEqual({ type: "emit", event: "milestone.verification_requested" });
  });

  it("asks for release money and auto-release timer at the right steps", () => {
    const verifying = run(happy.slice(0, 6));
    const passed = transition(verifying, { type: "verification_passed", at: AT });
    expect(passed.ok && passed.effects).toContainEqual({ type: "schedule_auto_release" });
    const pending = run(happy.slice(0, 7));
    const approved = transition(pending, { type: "release_approved", at: AT });
    expect(approved.ok && approved.effects).toContainEqual({ type: "release_funds", amountMinor: 100000 });
  });

  it("allows auto-release instead of a client approval", () => {
    const pending = run(happy.slice(0, 7));
    const s = run([{ type: "auto_release_due", at: AT }, { type: "release_confirmed", amountMinor: 100000 }], pending);
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
    expect(transition(inProgress, { type: "release_confirmed", amountMinor: 100000 }).ok).toBe(false);
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
    const s = run([{ type: "dispute_opened" }, { type: "dispute_resolved", outcome: "merchant" }], released);
    expect(s.state).toBe("released");
    const held = run(happy.slice(0, 3));
    const s2 = run([{ type: "dispute_opened" }, { type: "dispute_resolved", outcome: "merchant" }], held);
    expect(s2.state).toBe("held");
    expect(s2.releaseAuthorizedAt).toBeNull();
  });

  it("refunds on a buyer-favoured dispute", () => {
    const held = run(happy.slice(0, 3));
    const s = run([{ type: "dispute_opened" }, { type: "dispute_resolved", outcome: "buyer" }], held);
    expect(s.state).toBe("refunded");
  });

  it("rejects every event in terminal states", () => {
    const terminal: MilestoneSnapshot[] = [
      run(happy),
      run([{ type: "cancel" }]),
      run([...happy.slice(0, 3), { type: "refund_confirmed" }]),
    ];
    for (const s of terminal) {
      for (const e of [...happy, { type: "cancel" } as const, { type: "dispute_opened" } as const]) {
        if (s.state === "paid_out" && e.type === "dispute_opened") continue;
        expect(transition(s, e).ok).toBe(false);
      }
    }
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
  fc.integer({ min: 0, max: 200000 }).map((amountMinor) => ({ type: "hold_confirmed" as const, amountMinor })),
  fc.integer({ min: 0, max: 200000 }).map((amountMinor) => ({ type: "release_confirmed" as const, amountMinor })),
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @tranche/core exec vitest run src/milestone.test.ts`
Expected: FAIL with "Failed to resolve import ./milestone".

- [ ] **Step 3: Implement**

`packages/core/src/milestone.ts`:

```ts
import type { DomainEventType, MilestoneState } from "@tranche/contracts";

export type MilestoneSnapshot = {
  state: MilestoneState;
  priceMinor: number;
  heldMinor: number;
  releasedMinor: number;
  verifiedAt: string | null;
  releaseAuthorizedAt: string | null;
};

export type MilestoneEvent =
  | { type: "plan_agreed" }
  | { type: "funding_requested" }
  | { type: "funding_failed"; reason: string }
  | { type: "hold_confirmed"; amountMinor: number }
  | { type: "work_started" }
  | { type: "delivered" }
  | { type: "verification_started" }
  | { type: "verification_passed"; at: string }
  | { type: "verification_failed"; missing: string[] }
  | { type: "release_approved"; at: string }
  | { type: "auto_release_due"; at: string }
  | { type: "release_confirmed"; amountMinor: number }
  | { type: "payout_confirmed" }
  | { type: "dispute_opened" }
  | { type: "dispute_resolved"; outcome: "merchant" | "buyer" }
  | { type: "refund_confirmed" }
  | { type: "cancel" };

export type Effect =
  | { type: "emit"; event: DomainEventType }
  | { type: "schedule_funding" }
  | { type: "schedule_auto_release" }
  | { type: "release_funds"; amountMinor: number }
  | { type: "pay_out" }
  | { type: "void_hold" }
  | { type: "cancel_timers" };

export type TransitionResult =
  | { ok: true; next: MilestoneSnapshot; effects: Effect[] }
  | { ok: false; reason: string };

const FUNDED: MilestoneState[] = ["held", "in_progress", "delivered", "verifying", "changes_requested", "release_pending"];
const emit = (event: DomainEventType): Effect => ({ type: "emit", event });

export function transition(s: MilestoneSnapshot, e: MilestoneEvent): TransitionResult {
  const from = (...states: MilestoneState[]) => states.includes(s.state);
  const reject = (reason = `${e.type} is not allowed in state ${s.state}`): TransitionResult => ({ ok: false, reason });
  const go = (patch: Partial<MilestoneSnapshot>, effects: Effect[]): TransitionResult => ({
    ok: true,
    next: { ...s, ...patch },
    effects,
  });

  switch (e.type) {
    case "plan_agreed":
      return from("draft") ? go({ state: "agreed" }, [{ type: "schedule_funding" }]) : reject();
    case "funding_requested":
      return from("agreed") ? go({ state: "funding" }, [emit("milestone.funding_requested")]) : reject();
    case "funding_failed":
      return from("funding") ? go({ state: "agreed" }, [{ type: "schedule_funding" }]) : reject();
    case "hold_confirmed":
      if (!from("funding")) return reject();
      if (e.amountMinor < s.priceMinor) return reject(`hold of ${e.amountMinor} is below the price ${s.priceMinor}`);
      return go({ state: "held", heldMinor: e.amountMinor }, [emit("milestone.held")]);
    case "work_started":
      return from("held") ? go({ state: "in_progress" }, [emit("milestone.started")]) : reject();
    case "delivered":
      return from("held", "in_progress", "changes_requested")
        ? go({ state: "delivered", verifiedAt: null, releaseAuthorizedAt: null }, [emit("milestone.delivered")])
        : reject();
    case "verification_started":
      return from("delivered") ? go({ state: "verifying" }, [emit("milestone.verification_requested")]) : reject();
    case "verification_passed":
      return from("verifying")
        ? go({ state: "release_pending", verifiedAt: e.at }, [
            emit("milestone.verified"),
            emit("milestone.release_pending"),
            { type: "schedule_auto_release" },
          ])
        : reject();
    case "verification_failed":
      return from("verifying")
        ? go({ state: "changes_requested", verifiedAt: null }, [emit("milestone.changes_requested")])
        : reject();
    case "release_approved":
    case "auto_release_due": {
      if (!from("release_pending") || s.verifiedAt === null) return reject();
      if (s.releaseAuthorizedAt !== null) return reject("release already authorized");
      const amountMinor = s.heldMinor - s.releasedMinor;
      if (amountMinor <= 0) return reject("nothing left to release");
      return go({ releaseAuthorizedAt: e.at }, [{ type: "release_funds", amountMinor }]);
    }
    case "release_confirmed":
      if (!from("release_pending") || s.verifiedAt === null || s.releaseAuthorizedAt === null) return reject();
      if (e.amountMinor <= 0 || s.releasedMinor + e.amountMinor > s.heldMinor) {
        return reject(`release of ${e.amountMinor} does not fit the ${s.heldMinor - s.releasedMinor} held`);
      }
      return go({ state: "released", releasedMinor: s.releasedMinor + e.amountMinor }, [
        emit("milestone.released"),
        { type: "cancel_timers" },
        { type: "pay_out" },
      ]);
    case "payout_confirmed":
      return from("released") ? go({ state: "paid_out" }, [emit("milestone.paid_out")]) : reject();
    case "dispute_opened":
      return from(...FUNDED, "released", "paid_out")
        ? go({ state: "disputed" }, [emit("milestone.disputed"), { type: "cancel_timers" }])
        : reject();
    case "dispute_resolved":
      if (!from("disputed")) return reject();
      if (e.outcome === "buyer") return go({ state: "refunded" }, [emit("milestone.refunded")]);
      return s.releasedMinor > 0
        ? go({ state: "released" }, [emit("milestone.released")])
        : go({ state: "held", verifiedAt: null, releaseAuthorizedAt: null }, [emit("milestone.held")]);
    case "refund_confirmed":
      return from(...FUNDED, "disputed")
        ? go({ state: "refunded" }, [emit("milestone.refunded"), { type: "cancel_timers" }])
        : reject();
    case "cancel":
      if (from("draft", "agreed", "funding")) {
        return go({ state: "cancelled" }, [emit("milestone.cancelled"), { type: "cancel_timers" }]);
      }
      return from("held", "in_progress", "changes_requested")
        ? go({ state: "cancelled" }, [emit("milestone.cancelled"), { type: "cancel_timers" }, { type: "void_hold" }])
        : reject();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @tranche/core exec vitest run src/milestone.test.ts`
Expected: PASS, 16 tests, both properties run 100 cases each.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/milestone.ts packages/core/src/milestone.test.ts
git commit -m "feat(core): Add milestone state machine with property-tested invariants"
```

---

### Task 5: Policy engine

**Files:**
- Create: `packages/core/src/policy.ts`
- Test: `packages/core/src/policy.test.ts`

**Interfaces:**
- Consumes: `Policy`, `ProposedActionInput`, `ActionType` from `@tranche/contracts`.
- Produces:

```ts
export type PolicyContext = {
  now: string;
  heldForMilestoneMinor: number;
  releasedForMilestoneMinor: number;
  releasedForDealMinor: number;
  lastExecutedAt: string | null;
};
export type PolicyDecision = { decision: "approve" | "needs_approval" | "reject"; reason: string };
export function evaluatePolicy(input: { action: ProposedActionInput; policy: Policy; context: PolicyContext }): PolicyDecision;
```

Decision order: hard rejects (impossible amounts) first, then actions by a person approve, then `alwaysAsk`, then actions that change the agreement always ask, then amount limits ask, then cooldown asks, otherwise approve.

- [ ] **Step 1: Write the failing test**

`packages/core/src/policy.test.ts`:

```ts
import type { Policy, ProposedActionInput } from "@tranche/contracts";
import { describe, expect, it } from "vitest";
import { evaluatePolicy, type PolicyContext } from "./policy";

const DEAL = "6f1d7c4e-1b9a-4d55-9c3e-2a7b8e9f0a11";
const MS = "0b7f3a2c-5d4e-4f61-8a9b-1c2d3e4f5a6b";
const EV = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

const policy: Policy = {
  perActionMaxMinor: 100000,
  perMilestoneMaxMinor: 300000,
  perDealMaxMinor: 500000,
  autoReleaseAfterHours: 48,
  cooldownMinutes: 10,
  alwaysAsk: [],
};

const context: PolicyContext = {
  now: "2026-10-10T10:00:00Z",
  heldForMilestoneMinor: 400000,
  releasedForMilestoneMinor: 0,
  releasedForDealMinor: 0,
  lastExecutedAt: null,
};

const release = (minor: number, agent: ProposedActionInput["agent"] = "negotiator"): ProposedActionInput => ({
  dealId: DEAL,
  agent,
  side: "client",
  reasoning: "Verified delivery",
  evidenceIds: [EV],
  idempotencyKey: `release:${MS}:${minor}`,
  payload: { type: "release", milestoneId: MS, amount: { currency: "USD", minor } },
});

describe("evaluatePolicy", () => {
  it("approves a release within every limit", () => {
    expect(evaluatePolicy({ action: release(100000), policy, context }).decision).toBe("approve");
  });

  it("asks above the per-action limit", () => {
    const d = evaluatePolicy({ action: release(100001), policy, context });
    expect(d).toEqual({ decision: "needs_approval", reason: "release of 100001 is above the per-action limit 100000" });
  });

  it("asks above the per-milestone and per-deal limits", () => {
    expect(
      evaluatePolicy({ action: release(50000), policy, context: { ...context, releasedForMilestoneMinor: 260000 } })
        .decision,
    ).toBe("needs_approval");
    expect(
      evaluatePolicy({ action: release(50000), policy, context: { ...context, releasedForDealMinor: 460000 } }).decision,
    ).toBe("needs_approval");
  });

  it("rejects a release above what is still held, from anyone", () => {
    const ctx = { ...context, heldForMilestoneMinor: 100000, releasedForMilestoneMinor: 60000 };
    expect(evaluatePolicy({ action: release(50000), policy, context: ctx }).decision).toBe("reject");
  });

  it("rejects a human release above the held amount", () => {
    const ctx = { ...context, heldForMilestoneMinor: 10000 };
    expect(evaluatePolicy({ action: release(20000, "human"), policy, context: ctx }).decision).toBe("reject");
  });

  it("approves a human release above the agent limits", () => {
    expect(evaluatePolicy({ action: release(300000, "human"), policy, context }).decision).toBe("approve");
  });

  it("always asks for actions that change the agreement", () => {
    const reschedule: ProposedActionInput = {
      dealId: DEAL,
      agent: "monitor",
      side: "agency",
      reasoning: "Build slipped",
      evidenceIds: [],
      idempotencyKey: "monitor:reschedule:1",
      payload: { type: "reschedule", shifts: [{ taskId: MS, start: "2026-10-20" }], reason: "slip" },
    };
    expect(evaluatePolicy({ action: reschedule, policy, context }).decision).toBe("needs_approval");
  });

  it("asks for types the owner listed in alwaysAsk", () => {
    const flag: ProposedActionInput = {
      dealId: DEAL,
      agent: "monitor",
      side: "system",
      reasoning: "Late",
      evidenceIds: [],
      idempotencyKey: "monitor:flag:1",
      payload: { type: "flag_risk", milestoneId: null, severity: "low", message: "Client slow" },
    };
    expect(evaluatePolicy({ action: flag, policy, context }).decision).toBe("approve");
    expect(evaluatePolicy({ action: flag, policy: { ...policy, alwaysAsk: ["flag_risk"] }, context }).decision).toBe(
      "needs_approval",
    );
  });

  it("asks during the cooldown", () => {
    const ctx = { ...context, lastExecutedAt: "2026-10-10T09:55:00Z" };
    expect(evaluatePolicy({ action: release(1000), policy, context: ctx })).toEqual({
      decision: "needs_approval",
      reason: "cooldown: 5 minutes left",
    });
    const later = { ...context, lastExecutedAt: "2026-10-10T09:49:00Z" };
    expect(evaluatePolicy({ action: release(1000), policy, context: later }).decision).toBe("approve");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tranche/core exec vitest run src/policy.test.ts`
Expected: FAIL with "Failed to resolve import ./policy".

- [ ] **Step 3: Implement**

`packages/core/src/policy.ts`:

```ts
import type { ActionType, Policy, ProposedActionInput } from "@tranche/contracts";

export type PolicyContext = {
  now: string;
  heldForMilestoneMinor: number;
  releasedForMilestoneMinor: number;
  releasedForDealMinor: number;
  lastExecutedAt: string | null;
};

export type PolicyDecision = { decision: "approve" | "needs_approval" | "reject"; reason: string };

const CHANGES_AGREEMENT: ReadonlySet<ActionType> = new Set([
  "create_plan",
  "accept_plan",
  "reschedule",
  "submit_dispute_evidence",
]);

const approve = (reason: string): PolicyDecision => ({ decision: "approve", reason });
const ask = (reason: string): PolicyDecision => ({ decision: "needs_approval", reason });
const reject = (reason: string): PolicyDecision => ({ decision: "reject", reason });

export function evaluatePolicy({
  action,
  policy,
  context,
}: {
  action: ProposedActionInput;
  policy: Policy;
  context: PolicyContext;
}): PolicyDecision {
  const p = action.payload;

  if (p.type === "release") {
    const remaining = context.heldForMilestoneMinor - context.releasedForMilestoneMinor;
    if (p.amount.minor <= 0) return reject("release amount must be positive");
    if (p.amount.minor > remaining) return reject(`release of ${p.amount.minor} exceeds the ${remaining} still held`);
  }

  if (action.agent === "human") return approve("initiated by a person");
  if (policy.alwaysAsk.includes(p.type)) return ask(`${p.type} always needs approval`);
  if (CHANGES_AGREEMENT.has(p.type)) return ask(`${p.type} changes the agreement`);

  if (p.type === "release") {
    const amount = p.amount.minor;
    if (amount > policy.perActionMaxMinor) {
      return ask(`release of ${amount} is above the per-action limit ${policy.perActionMaxMinor}`);
    }
    if (context.releasedForMilestoneMinor + amount > policy.perMilestoneMaxMinor) {
      return ask(`release would pass the per-milestone limit ${policy.perMilestoneMaxMinor}`);
    }
    if (context.releasedForDealMinor + amount > policy.perDealMaxMinor) {
      return ask(`release would pass the per-deal limit ${policy.perDealMaxMinor}`);
    }
  }

  if (context.lastExecutedAt && policy.cooldownMinutes > 0) {
    const elapsed = (Date.parse(context.now) - Date.parse(context.lastExecutedAt)) / 60_000;
    if (elapsed < policy.cooldownMinutes) {
      return ask(`cooldown: ${Math.ceil(policy.cooldownMinutes - elapsed)} minutes left`);
    }
  }

  return approve("within policy");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @tranche/core exec vitest run src/policy.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/policy.ts packages/core/src/policy.test.ts
git commit -m "feat(core): Add policy engine for proposed actions"
```

---

### Task 6: Public exports and workspace check

**Files:**
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces: everything above importable from `@tranche/core`.

- [ ] **Step 1: Write the exports**

`packages/core/src/index.ts`:

```ts
export * from "./dates";
export * from "./milestone";
export * from "./policy";
export * from "./schedule";
export * from "./verification";
```

- [ ] **Step 2: Run the whole workspace**

Run: `pnpm --filter @tranche/core test && pnpm typecheck && pnpm check`
Expected: PASS; `apps/web` still builds because it only imports `@tranche/contracts`.

- [ ] **Step 3: Commit and open the PR**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): Export the core decision layer"
git push -u origin feat/core
gh pr create --title "feat(core): Add state machine, policy, gate and scheduling" --body "Implements plan h1. verificationGate, schedulePlan and withinMandate are consumed by the E lane."
```
