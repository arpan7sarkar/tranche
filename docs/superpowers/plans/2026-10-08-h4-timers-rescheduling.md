# H4 - Money Timers and Gantt Rescheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the deterministic money timers run (just-in-time funding, hold renewal, auto-release, reminders) and let a Gantt edit move tasks, milestone windows and pending funding timers consistently.

**Architecture:** Due `scheduled_action` rows are claimed with `FOR UPDATE SKIP LOCKED` and turned into `timer.due` inbox rows keyed by the timer id, so timer execution reuses H3's exactly-once inbox. Funding and renewal call PayPal through new `fund` and `renew_hold` outbox handlers. Renewal decisions and task rescheduling are pure functions in `@tranche/core`; the database code only loads, applies and records.

**Tech Stack:** TypeScript 7, Drizzle ORM 0.45, `@tranche/core`, `@tranche/paypal`, Next.js 16 route handlers, Vitest 5, fast-check 4.10.

**Spec:** `docs/superpowers/specs/2026-10-08-tranche-design.md` (sections 5, 9, 12) and `docs/superpowers/plans/2026-10-08-00-foundation.md`.

**Owner:** Person H. Prerequisites: H1, H2, H3. Task 6 needs `requireDealAccess` from the H5 frontend plan (auth task).

## Integration overrides

The [integration contract](2026-10-08-01-integration-contract.md) wins over anything in this plan that conflicts with it.
Items that affect this plan:

- Reauthorize only when `elapsedDays >= HONOR_DAYS + 1` (at least 4 full days after the original authorization); PayPal rejects earlier reauthorization (section 4).
- `hold.expiresAt` is the hard deadline, not the honor period end (section 4).
- Timer-started funding without a vault emails a fresh portal link and uses the return URL `${APP_URL}/portal/return?milestoneId=<id>` (section 2).

## Global Constraints

- Money timers are code, never agent decisions; an agent can only propose `reschedule`, which always needs a person's approval.
- `FUND_LEAD_DAYS = 3`: a milestone is funded 3 days before its first task starts, never in the past.
- Authorization holds: valid 29 days from the original authorization, honor period 3 days; reauthorize from day 3 to before day 27; from day 27 create a new authorization from the vaulted payment method and void the old one.
- Delayed disbursement holds: PayPal pays the agency automatically on day 28 after capture; at day 25 raise `milestone.hold_expiring` and `alert.raised`.
- Hold mechanism comes from `HOLD_MECHANISM` (`authorization` or `delayed_disbursement`, default `authorization`), as recorded by F0.
- Platform fee: `PLATFORM_FEE_BPS = 200` (2%), rounded down to the minor unit.
- A Gantt move only pushes dependents later, never pulls them earlier; moving a task before a dependency ends is refused.
- No em dash characters anywhere; use a plain `-`.
- Comments only when they carry real value.
- Conventional commits, no AI co-author lines.

## Review Focus

- **Dragging a task to start before its dependency ends**: the API answers 422 with the blocking task's name and nothing in the database changes - pinned in Task 6 Step 1 ("refuses a move before a dependency ends").
- **Rescheduling a milestone that is already funded**: its funding timer is not recreated; only a still-pending funding timer moves - pinned in Task 5 Step 1 ("moves only a pending funding timer").
- **A renewal timer that fires after the milestone was released**: no PayPal call is made - pinned in Task 4 Step 1 ("skips renewal when the hold is no longer active").
- **Renewal at day 27 for a client with no vaulted payment method**: fails permanently with an alert instead of retrying forever - pinned in Task 4 Step 1 ("fails permanently without a vaulted payment method").
- **Two cron runs claiming the same due timer at once**: exactly one `timer.due` inbox row exists - pinned in Task 2 Step 1 ("claims a due timer once under concurrency").

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/fees.ts` | `PLATFORM_FEE_BPS`, `platformFee` |
| `packages/core/src/holds.ts` | Renewal constants, `renewalAction` |
| `packages/core/src/schedule.ts` | Add `rescheduleTasks` |
| `apps/agents/src/money/timers.ts` | Add `fundingDueAt`, `planRenewal`, `claimDueTimers` |
| `apps/agents/src/money/holds.ts` | Schedule renewal when a hold activates |
| `apps/agents/src/money/effects.ts` | Use `fundingDueAt` |
| `apps/agents/src/money/funding.ts` | `fund` and `renew_hold` outbox handlers |
| `apps/agents/src/money/outbox-handlers.ts` | Register the new handlers |
| `apps/agents/src/money/reschedule.ts` | `applyReschedule`, `RescheduleError` |
| `apps/agents/src/money/actions.ts` | `reschedule` executor case |
| `apps/agents/src/money/tick.ts` | Claim timers first |
| `apps/agents/src/money/index.ts` | Export rescheduling |
| `apps/web/src/app/api/deals/[dealId]/tasks/reschedule/route.ts` | Gantt move endpoint |

---

### Task 1: Pure renewal, fee and rescheduling rules

**Files:**
- Create: `packages/core/src/fees.ts`, `packages/core/src/holds.ts`
- Modify: `packages/core/src/schedule.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/fees.test.ts`, `packages/core/src/holds.test.ts`, `packages/core/src/reschedule.test.ts`

**Interfaces:**
- Consumes: `addDays`, `Window`, `schedulePlan` (H1); `Money`, `HoldMechanism` from `@tranche/contracts`.
- Produces:
  - `PLATFORM_FEE_BPS = 200`, `platformFee(amount: Money, bps?: number): Money`
  - `HONOR_DAYS = 3`, `AUTH_VALID_DAYS = 29`, `RENEW_AT_DAY = 27`, `DELAYED_AUTO_DISBURSE_DAY = 28`, `DELAYED_ALERT_DAY = 25`
  - `type RenewalAction = { kind: "none" } | { kind: "reauthorize" } | { kind: "new_authorization" } | { kind: "alert"; daysLeft: number }`
  - `renewalAction(mechanism: HoldMechanism, anchorAt: string, now: string): RenewalAction`
  - `type PlacedTask = { key: string; start: string; durationDays: number; dependsOn: string[] }`
  - `rescheduleTasks(tasks: PlacedTask[], moves: Array<{ key: string; start: string }>): { ok: true; schedule: Map<string, Window> } | { ok: false; reason: string }`

- [ ] **Step 1: Write the failing tests**

`packages/core/src/fees.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { platformFee } from "./fees";

describe("platformFee", () => {
  it("takes 2% rounded down", () => {
    expect(platformFee({ currency: "USD", minor: 100000 })).toEqual({ currency: "USD", minor: 2000 });
    expect(platformFee({ currency: "USD", minor: 149 })).toEqual({ currency: "USD", minor: 2 });
    expect(platformFee({ currency: "JPY", minor: 49 })).toEqual({ currency: "JPY", minor: 0 });
  });
});
```

`packages/core/src/holds.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renewalAction } from "./holds";

const anchor = "2026-10-01T00:00:00Z";
const at = (days: number) => new Date(Date.parse(anchor) + days * 86_400_000).toISOString();

describe("renewalAction", () => {
  it("does nothing inside the honor period", () => {
    expect(renewalAction("authorization", anchor, at(2.9))).toEqual({ kind: "none" });
  });

  it("reauthorizes after the honor period", () => {
    expect(renewalAction("authorization", anchor, at(3))).toEqual({ kind: "reauthorize" });
    expect(renewalAction("authorization", anchor, at(26.9))).toEqual({ kind: "reauthorize" });
  });

  it("replaces the authorization from day 27", () => {
    expect(renewalAction("authorization", anchor, at(27))).toEqual({ kind: "new_authorization" });
    expect(renewalAction("authorization", anchor, at(40))).toEqual({ kind: "new_authorization" });
  });

  it("alerts before PayPal auto-disburses a delayed hold", () => {
    expect(renewalAction("delayed_disbursement", anchor, at(24))).toEqual({ kind: "none" });
    expect(renewalAction("delayed_disbursement", anchor, at(25))).toEqual({ kind: "alert", daysLeft: 3 });
    expect(renewalAction("delayed_disbursement", anchor, at(30))).toEqual({ kind: "alert", daysLeft: 0 });
  });
});
```

`packages/core/src/reschedule.test.ts`:

```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type PlacedTask, rescheduleTasks, schedulePlan } from "./schedule";

const tasks: PlacedTask[] = [
  { key: "a", start: "2026-10-10", durationDays: 3, dependsOn: [] },
  { key: "b", start: "2026-10-13", durationDays: 2, dependsOn: ["a"] },
  { key: "c", start: "2026-10-15", durationDays: 1, dependsOn: ["b"] },
  { key: "x", start: "2026-10-10", durationDays: 4, dependsOn: [] },
];

describe("rescheduleTasks", () => {
  it("pushes dependents when a task moves later", () => {
    const r = rescheduleTasks(tasks, [{ key: "a", start: "2026-10-12" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.schedule.get("a")).toEqual({ start: "2026-10-12", end: "2026-10-15" });
    expect(r.schedule.get("b")?.start).toBe("2026-10-15");
    expect(r.schedule.get("c")?.start).toBe("2026-10-17");
    expect(r.schedule.get("x")?.start).toBe("2026-10-10");
  });

  it("does not pull dependents earlier when a task moves earlier", () => {
    const later = tasks.map((t) => (t.key === "b" ? { ...t, start: "2026-10-20" } : t));
    const r = rescheduleTasks(later, [{ key: "a", start: "2026-10-09" }]);
    expect(r.ok && r.schedule.get("b")?.start).toBe("2026-10-20");
  });

  it("refuses a move before a dependency ends", () => {
    expect(rescheduleTasks(tasks, [{ key: "b", start: "2026-10-12" }])).toEqual({
      ok: false,
      reason: 'task "b" cannot start before "a" ends on 2026-10-13',
    });
  });

  it("refuses unknown tasks", () => {
    expect(rescheduleTasks(tasks, [{ key: "zz", start: "2026-10-12" }])).toEqual({ ok: false, reason: 'unknown task "zz"' });
  });

  it("keeps every dependency satisfied (property)", () => {
    const dag = fc.integer({ min: 1, max: 12 }).chain((n) =>
      fc.tuple(
        fc.tuple(
          ...Array.from({ length: n }, (_, i) =>
            fc.record({
              durationDays: fc.integer({ min: 1, max: 8 }),
              deps: fc.subarray(Array.from({ length: i }, (_, j) => j)),
            }),
          ),
        ),
        fc.integer({ min: 0, max: n - 1 }),
        fc.integer({ min: -6, max: 15 }),
      ),
    );
    fc.assert(
      fc.property(dag, ([spec, moved, offset]) => {
        const base = spec.map((t, i) => ({ key: `t${i}`, durationDays: t.durationDays, dependsOn: t.deps.map((d) => `t${d}`) }));
        const initial = schedulePlan(base, "2026-10-10");
        const placed = base.map((t) => ({ ...t, start: initial.get(t.key)!.start }));
        const target = new Date(Date.parse(`${initial.get(`t${moved}`)!.start}T00:00:00Z`) + offset * 86_400_000)
          .toISOString()
          .slice(0, 10);
        const r = rescheduleTasks(placed, [{ key: `t${moved}`, start: target }]);
        if (!r.ok) {
          expect(r.reason).toMatch(/cannot start before/);
          return;
        }
        expect(r.schedule.get(`t${moved}`)?.start).toBe(target);
        for (const t of placed) {
          const w = r.schedule.get(t.key)!;
          for (const d of t.dependsOn) expect(w.start >= r.schedule.get(d)!.end).toBe(true);
          if (t.key !== `t${moved}`) expect(w.start >= t.start).toBe(true);
        }
      }),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @tranche/core exec vitest run src/fees.test.ts src/holds.test.ts src/reschedule.test.ts`
Expected: FAIL with "Failed to resolve import ./fees", "./holds", and "rescheduleTasks is not exported".

- [ ] **Step 3: Implement**

`packages/core/src/fees.ts`:

```ts
import type { Money } from "@tranche/contracts";

export const PLATFORM_FEE_BPS = 200;

export function platformFee(amount: Money, bps = PLATFORM_FEE_BPS): Money {
  return { currency: amount.currency, minor: Math.floor((amount.minor * bps) / 10000) };
}
```

`packages/core/src/holds.ts`:

```ts
import type { HoldMechanism } from "@tranche/contracts";

export const HONOR_DAYS = 3;
export const AUTH_VALID_DAYS = 29;
export const RENEW_AT_DAY = 27;
export const DELAYED_AUTO_DISBURSE_DAY = 28;
export const DELAYED_ALERT_DAY = 25;

const DAY_MS = 86_400_000;

export type RenewalAction =
  | { kind: "none" }
  | { kind: "reauthorize" }
  | { kind: "new_authorization" }
  | { kind: "alert"; daysLeft: number };

export function renewalAction(mechanism: HoldMechanism, anchorAt: string, now: string): RenewalAction {
  const day = (Date.parse(now) - Date.parse(anchorAt)) / DAY_MS;
  if (mechanism === "delayed_disbursement") {
    return day >= DELAYED_ALERT_DAY
      ? { kind: "alert", daysLeft: Math.max(0, Math.floor(DELAYED_AUTO_DISBURSE_DAY - day)) }
      : { kind: "none" };
  }
  if (day < HONOR_DAYS) return { kind: "none" };
  if (day < RENEW_AT_DAY) return { kind: "reauthorize" };
  return { kind: "new_authorization" };
}
```

Append to `packages/core/src/schedule.ts`:

```ts
export type PlacedTask = { key: string; start: string; durationDays: number; dependsOn: string[] };

export function rescheduleTasks(
  tasks: PlacedTask[],
  moves: Array<{ key: string; start: string }>,
): { ok: true; schedule: Map<string, Window> } | { ok: false; reason: string } {
  const byKey = new Map(tasks.map((t) => [t.key, t]));
  const requested = new Map<string, string>();
  for (const m of moves) {
    if (!byKey.has(m.key)) return { ok: false, reason: `unknown task "${m.key}"` };
    requested.set(m.key, m.start);
  }
  const out = new Map<string, Window>();
  const visiting = new Set<string>();

  const visit = (key: string): Window => {
    const done = out.get(key);
    if (done) return done;
    const task = byKey.get(key);
    if (!task) throw new Error(`unknown task "${key}"`);
    if (visiting.has(key)) throw new Error(`dependency cycle at "${key}"`);
    visiting.add(key);
    let earliest: string | null = null;
    let blocker = "";
    for (const d of task.dependsOn) {
      const w = visit(d);
      if (earliest === null || w.end > earliest) {
        earliest = w.end;
        blocker = d;
      }
    }
    visiting.delete(key);
    const want = requested.get(key);
    let start: string;
    if (want !== undefined) {
      if (earliest !== null && want < earliest) {
        throw new Error(`task "${key}" cannot start before "${blocker}" ends on ${earliest}`);
      }
      start = want;
    } else {
      start = earliest !== null && earliest > task.start ? earliest : task.start;
    }
    const w = { start, end: addDays(start, task.durationDays) };
    out.set(key, w);
    return w;
  };

  try {
    for (const t of tasks) visit(t.key);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true, schedule: out };
}
```

In `packages/core/src/index.ts` add:

```ts
export * from "./fees";
export * from "./holds";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @tranche/core test`
Expected: PASS, including the new property test.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): Add renewal rules, platform fee and task rescheduling"
```

---

### Task 2: Claiming due timers

**Files:**
- Modify: `apps/agents/src/money/timers.ts`, `apps/agents/src/money/effects.ts`, `apps/agents/src/money/tick.ts`, `apps/agents/src/money/tick.test.ts`
- Test: `apps/agents/src/money/timers.test.ts`

**Interfaces:**
- Consumes: `fundingDueDate` (H1); H3 inbox (`timer.due` handling) and `runTick`.
- Produces:
  - `fundingDueAt(milestoneStart: string | null, now: Date): Date` (midnight UTC of `fundingDueDate`, or `now` when that is today)
  - `claimDueTimers(deps: Deps, limit?: number): Promise<number>`: due `pending` rows become `running` and get an inbox row `(source: "timer", sourceEventId: <timer id>)` in the same transaction.
  - `runTick` now returns `{ timers: number; inbox: number; actions: number; outbox: number }`, claiming timers first.

- [ ] **Step 1: Write the failing test**

`apps/agents/src/money/timers.test.ts`:

```ts
import { schema } from "@tranche/db";
import { createTestDb, truncateAll } from "@tranche/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeHold, makeMilestone, NOW, testDeps } from "./test-helpers";
import { runTick } from "./tick";
import { claimDueTimers, fundingDueAt } from "./timers";

const db = process.env.DATABASE_URL ? await createTestDb("agents") : null;

describe("fundingDueAt", () => {
  it("funds three days ahead, or now when that is already past", () => {
    expect(fundingDueAt("2026-10-20", NOW).toISOString()).toBe("2026-10-17T00:00:00.000Z");
    expect(fundingDueAt("2026-10-11", NOW)).toEqual(NOW);
    expect(fundingDueAt(null, NOW)).toEqual(NOW);
  });
});

describe.runIf(Boolean(db))("claimDueTimers", () => {
  beforeEach(async () => {
    await truncateAll(db!);
  });
  afterAll(async () => {
    await db!.$client.end();
  });

  it("claims only due timers", async () => {
    const { milestoneId } = await makeMilestone(db!);
    const [due] = await db!.insert(schema.scheduledAction).values({ milestoneId, kind: "remind", dueAt: NOW }).returning();
    await db!.insert(schema.scheduledAction).values({ milestoneId, kind: "fund", dueAt: new Date("2026-10-11T00:00:00Z") });
    expect(await claimDueTimers(testDeps(db!))).toBe(1);
    const [row] = await db!.select().from(schema.inbox);
    expect(row).toMatchObject({ source: "timer", sourceEventId: due!.id, message: { type: "timer.due", scheduledActionId: due!.id } });
    const [t] = await db!.select().from(schema.scheduledAction).where(eq(schema.scheduledAction.id, due!.id));
    expect(t).toMatchObject({ status: "running", attempts: 1 });
  });

  it("claims a due timer once under concurrency", async () => {
    const { milestoneId } = await makeMilestone(db!);
    await db!.insert(schema.scheduledAction).values({ milestoneId, kind: "remind", dueAt: NOW });
    const counts = await Promise.all([claimDueTimers(testDeps(db!)), claimDueTimers(testDeps(db!))]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await db!.select().from(schema.inbox)).toHaveLength(1);
  });

  it("auto-releases a verified milestone in one tick", async () => {
    const { milestoneId } = await makeMilestone(db!, { state: "release_pending", heldMinor: 100000, verifiedAt: NOW });
    await makeHold(db!, milestoneId, { status: "active", authorizationId: "AUTH-1" });
    await db!.insert(schema.scheduledAction).values({ milestoneId, kind: "auto_release", dueAt: NOW });
    const r = await runTick(testDeps(db!));
    expect(r.timers).toBe(1);
    const [m] = await db!.select().from(schema.milestone).where(eq(schema.milestone.id, milestoneId));
    expect(m?.state).toBe("released");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=postgres://tranche:tranche@localhost:5432/tranche pnpm --filter @tranche/agents-service exec vitest run src/money/timers.test.ts`
Expected: FAIL with "claimDueTimers is not exported" and "fundingDueAt is not exported".

- [ ] **Step 3: Implement**

Append to `apps/agents/src/money/timers.ts` (merge the imports at the top):

```ts
import { fundingDueDate } from "@tranche/core";
import { asc, lte } from "drizzle-orm";
import type { Deps } from "./deps";

export function fundingDueAt(milestoneStart: string | null, now: Date): Date {
  const today = now.toISOString().slice(0, 10);
  const due = fundingDueDate(milestoneStart ?? today, today);
  return due === today ? now : new Date(`${due}T00:00:00Z`);
}

export async function claimDueTimers(deps: Deps, limit = 50): Promise<number> {
  return deps.db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(t)
      .where(and(eq(t.status, "pending"), lte(t.dueAt, deps.now())))
      .orderBy(asc(t.dueAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    for (const timer of due) {
      await tx
        .insert(schema.inbox)
        .values({ source: "timer", sourceEventId: timer.id, message: { type: "timer.due", scheduledActionId: timer.id } })
        .onConflictDoNothing();
      await tx.update(t).set({ status: "running", attempts: timer.attempts + 1 }).where(eq(t.id, timer.id));
    }
    return due.length;
  });
}
```

In `apps/agents/src/money/effects.ts`, replace the body of the `schedule_funding` case with:

```ts
      case "schedule_funding": {
        const [m] = await tx
          .select({ startDate: schema.milestone.startDate })
          .from(schema.milestone)
          .where(eq(schema.milestone.id, milestoneId));
        await scheduleTimer(tx, { milestoneId, kind: "fund", dueAt: fundingDueAt(m?.startDate ?? null, now) });
        break;
      }
```

and change the timers import to `import { cancelTimers, fundingDueAt, scheduleTimer } from "./timers";`, removing the now-unused `fundingDueDate` import.

`apps/agents/src/money/tick.ts`:

```ts
import { processActions } from "./actions";
import type { Deps } from "./deps";
import { processInbox } from "./inbox";
import { executeOutbox } from "./outbox";
import { claimDueTimers } from "./timers";

export async function runTick(
  deps: Deps,
): Promise<{ timers: number; inbox: number; actions: number; outbox: number }> {
  const timers = await claimDueTimers(deps);
  const inbox = await processInbox(deps);
  const actions = await processActions(deps);
  const outbox = await executeOutbox(deps);
  return { timers, inbox, actions, outbox };
}
```

In `apps/agents/src/money/tick.test.ts` change the last expectation to:

```ts
    expect(await runTick(testDeps(db!))).toEqual({ timers: 0, inbox: 0, actions: 0, outbox: 0 });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL=postgres://tranche:tranche@localhost:5432/tranche pnpm --filter @tranche/agents-service test`
Expected: PASS, including H3's suites.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/money
git commit -m "feat(money): Claim due timers into the inbox each tick"
```

---

### Task 3: Just-in-time funding

**Files:**
- Create: `apps/agents/src/money/funding.ts`
- Modify: `apps/agents/src/money/outbox-handlers.ts`
- Test: `apps/agents/src/money/funding.test.ts`

**Interfaces:**
- Consumes: `platformFee` (Task 1); `createFundingOrder` from `@tranche/paypal`; H3 `OutboxHandler`, `enqueueOutbox`, `mustAdvance`.
- Produces:
  - `holdMechanism(): HoldMechanism` (reads `HOLD_MECHANISM`)
  - `fundHandler: OutboxHandler` for kind `fund` (request `{ milestoneId }`): skips unless the milestone is `agreed` or `funding` and has no pending or active hold; creates the order with the client's vaulted payment method when there is one; inserts a `pending` hold; moves `agreed` -> `funding` with event payload `{ orderId, approveUrl }`; when `approveUrl` is null queues `place_hold` immediately.
  - Return URLs: `${APP_URL}/portal/<dealId>?funded=<milestoneId>` and cancel `${APP_URL}/portal/<dealId>` (the H5 portal route).

- [ ] **Step 1: Write the failing test**

`apps/agents/src/money/funding.test.ts`:

```ts
import { schema } from "@tranche/db";
import { createTestDb, truncateAll } from "@tranche/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { executeOutbox } from "./outbox";
import { fakePayPal, makeHold, makeMilestone, NOW, testDeps } from "./test-helpers";

const db = process.env.DATABASE_URL ? await createTestDb("agents") : null;

async function fundRow(milestoneId: string) {
  await db!.insert(schema.outbox).values({ kind: "fund", request: { milestoneId }, requestId: `fund:${milestoneId}`, nextAttemptAt: NOW });
}
const milestoneOf = async (id: string) =>
  (await db!.select().from(schema.milestone).where(eq(schema.milestone.id, id)))[0]!;

describe.runIf(Boolean(db))("fund handler", () => {
  beforeEach(async () => {
    await truncateAll(db!);
  });
  afterAll(async () => {
    await db!.$client.end();
  });

  it("funds from the vault and places the hold without the client", async () => {
    const { milestoneId, dealId } = await makeMilestone(db!, { state: "agreed" });
    await fundRow(milestoneId);
    const paypal = fakePayPal();
    await executeOutbox(testDeps(db!, paypal));
    expect(paypal.createFundingOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: `fund:${milestoneId}`,
        mechanism: "authorization",
        amount: { currency: "USD", minor: 100000 },
        platformFee: { currency: "USD", minor: 2000 },
        payeeMerchantId: "MERCHANT-AGENCY",
        vaultId: "VAULT-1",
        returnUrl: expect.stringContaining(`/portal/${dealId}?funded=${milestoneId}`),
      }),
    );
    expect((await milestoneOf(milestoneId)).state).toBe("funding");
    const [h] = await db!.select().from(schema.hold);
    expect(h).toMatchObject({ status: "pending", paypalOrderId: "ORDER-2", amountMinor: 100000 });

    await executeOutbox(testDeps(db!, paypal));
    expect((await milestoneOf(milestoneId)).state).toBe("held");
  });

  it("asks the client to approve when there is no vaulted method", async () => {
    const { milestoneId, clientId } = await makeMilestone(db!, { state: "agreed" });
    await db!.update(schema.client).set({ paypalVaultId: null }).where(eq(schema.client.id, clientId));
    await fundRow(milestoneId);
    const paypal = fakePayPal({
      createFundingOrder: vi.fn(async () => ({ orderId: "ORDER-3", approveUrl: "https://sandbox.paypal.test/approve", status: "CREATED" })),
    });
    await executeOutbox(testDeps(db!, paypal));
    const [e] = await db!.select().from(schema.event).where(eq(schema.event.type, "milestone.funding_requested"));
    expect(e?.payload).toMatchObject({ orderId: "ORDER-3", approveUrl: "https://sandbox.paypal.test/approve" });
    expect(await db!.select().from(schema.outbox).where(eq(schema.outbox.kind, "place_hold"))).toHaveLength(0);
  });

  it("skips a milestone that already has a hold", async () => {
    const { milestoneId } = await makeMilestone(db!, { state: "funding" });
    await makeHold(db!, milestoneId, { status: "pending" });
    await fundRow(milestoneId);
    const paypal = fakePayPal();
    await executeOutbox(testDeps(db!, paypal));
    expect(paypal.createFundingOrder).not.toHaveBeenCalled();
  });

  it("fails permanently when the agency has not connected PayPal", async () => {
    const { milestoneId, workspaceId } = await makeMilestone(db!, { state: "agreed" });
    await db!.update(schema.workspace).set({ paypalMerchantId: null }).where(eq(schema.workspace.id, workspaceId));
    await fundRow(milestoneId);
    await executeOutbox(testDeps(db!));
    const [row] = await db!.select().from(schema.outbox);
    expect(row).toMatchObject({ status: "failed", lastError: "the agency has not connected PayPal" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=postgres://tranche:tranche@localhost:5432/tranche pnpm --filter @tranche/agents-service exec vitest run src/money/funding.test.ts`
Expected: FAIL; the `fund` row ends `failed` with "no outbox handler for fund".

- [ ] **Step 3: Implement**

`apps/agents/src/money/funding.ts`:

```ts
import { HoldMechanism } from "@tranche/contracts";
import { platformFee } from "@tranche/core";
import { type Db, schema } from "@tranche/db";
import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "./db";
import { PermanentError } from "./errors";
import { mustAdvance } from "./milestones";
import { enqueueOutbox } from "./outbox";
import type { OutboxHandler } from "./outbox-handlers";

const DAY_MS = 86_400_000;
const ORDER_TTL_DAYS = 3;

export function holdMechanism(): HoldMechanism {
  return HoldMechanism.parse(process.env.HOLD_MECHANISM ?? "authorization");
}

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export async function fundingContext(exec: Db | Tx, milestoneId: string) {
  const [row] = await exec
    .select({ milestone: schema.milestone, deal: schema.deal, client: schema.client, workspace: schema.workspace })
    .from(schema.milestone)
    .innerJoin(schema.deal, eq(schema.milestone.dealId, schema.deal.id))
    .innerJoin(schema.client, eq(schema.deal.clientId, schema.client.id))
    .innerJoin(schema.workspace, eq(schema.deal.workspaceId, schema.workspace.id))
    .where(eq(schema.milestone.id, milestoneId));
  if (!row) throw new PermanentError(`milestone ${milestoneId} not found`);
  if (!row.workspace.paypalMerchantId) throw new PermanentError("the agency has not connected PayPal");
  return {
    ...row,
    merchantId: row.workspace.paypalMerchantId,
    returnUrl: `${appUrl()}/portal/${row.deal.id}?funded=${milestoneId}`,
    cancelUrl: `${appUrl()}/portal/${row.deal.id}`,
  };
}

export const fundHandler: OutboxHandler = {
  async call(deps, row) {
    const ctx = await fundingContext(deps.db, String(row.request.milestoneId));
    if (ctx.milestone.state !== "agreed" && ctx.milestone.state !== "funding") return { skipped: true };
    const open = await deps.db
      .select({ id: schema.hold.id })
      .from(schema.hold)
      .where(and(eq(schema.hold.milestoneId, ctx.milestone.id), inArray(schema.hold.status, ["pending", "active"])));
    if (open.length > 0) return { skipped: true };
    const amount = { currency: ctx.deal.currency, minor: ctx.milestone.priceMinor };
    return deps.paypal.createFundingOrder({
      requestId: row.requestId,
      mechanism: holdMechanism(),
      amount,
      platformFee: platformFee(amount),
      payeeMerchantId: ctx.merchantId,
      milestoneId: ctx.milestone.id,
      vaultId: ctx.client.paypalVaultId,
      returnUrl: ctx.returnUrl,
      cancelUrl: ctx.cancelUrl,
    });
  },
  async settle(tx, deps, row, res) {
    if (res.skipped) return;
    const r = res as { orderId: string; approveUrl: string | null };
    const now = deps.now();
    const ctx = await fundingContext(tx, String(row.request.milestoneId));
    const [hold] = await tx
      .insert(schema.hold)
      .values({
        milestoneId: ctx.milestone.id,
        mechanism: holdMechanism(),
        paypalOrderId: r.orderId,
        amountMinor: ctx.milestone.priceMinor,
        currency: ctx.deal.currency,
        status: "pending",
        expiresAt: new Date(now.getTime() + ORDER_TTL_DAYS * DAY_MS),
      })
      .returning();
    if (ctx.milestone.state === "agreed") {
      await mustAdvance(tx, ctx.milestone.id, { type: "funding_requested" }, {
        now,
        payload: { orderId: r.orderId, approveUrl: r.approveUrl },
      });
    }
    if (r.approveUrl === null) {
      await enqueueOutbox(tx, { kind: "place_hold", request: { holdId: hold!.id }, requestId: `place:${hold!.id}` }, now);
    }
  },
};
```

In `apps/agents/src/money/outbox-handlers.ts`, add `import { fundHandler } from "./funding";` and register `fund: fundHandler,` in `outboxHandlers`.

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL=postgres://tranche:tranche@localhost:5432/tranche pnpm --filter @tranche/agents-service exec vitest run src/money/funding.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/money
git commit -m "feat(money): Fund milestones just in time from the vault"
```

---

### Task 4: Hold renewal

**Files:**
- Modify: `apps/agents/src/money/timers.ts`, `apps/agents/src/money/holds.ts`, `apps/agents/src/money/funding.ts`, `apps/agents/src/money/outbox-handlers.ts`, `apps/agents/src/money/test-helpers.ts`
- Test: `apps/agents/src/money/renewal.test.ts`

**Interfaces:**
- Consumes: `renewalAction`, `RENEW_AT_DAY`, `DELAYED_ALERT_DAY`, `platformFee` (Task 1); `renewHold`, `createFundingOrder`, `placeHold` from `@tranche/paypal`.
- Produces:
  - `planRenewal(tx: Tx, hold: { milestoneId: string; mechanism: HoldMechanism; originalAuthorizedAt: Date | null }): Promise<void>`: one pending `renew_hold` timer at anchor + 27 days (authorization) or anchor + 25 days (delayed disbursement).
  - `activateHold` calls `planRenewal` after activating.
  - `renewHandler: OutboxHandler` for kind `renew_hold` (request `{ milestoneId }`), acting on `renewalAction`:
    - `none`: no PayPal call, timer re-planned.
    - `reauthorize`: `renewHold`, hold gets the new authorization id and expiry.
    - `new_authorization`: new order from the vault plus `placeHold` (request ids `<requestId>:order`, `<requestId>:hold`), new active hold anchored now, old hold voided through outbox `void_hold`, `milestone.held` event with `{ renewed: true }`.
    - `alert`: `milestone.hold_expiring` and `alert.raised` (`kind: "delayed_disbursement_expiring"`, `daysLeft`).
    - No active hold: skipped.
  - `makeHold` test helper accepts `anchorAt?: Date`.

- [ ] **Step 1: Extend the test helper**

In `apps/agents/src/money/test-helpers.ts`, add `anchorAt?: Date;` to the `makeHold` options type and `originalAuthorizedAt: o.anchorAt ?? null,` to its `values`.

- [ ] **Step 2: Write the failing test**

`apps/agents/src/money/renewal.test.ts`:

```ts
import { schema } from "@tranche/db";
import { createTestDb, truncateAll } from "@tranche/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { activateHold } from "./holds";
import { executeOutbox } from "./outbox";
import { fakePayPal, makeHold, makeMilestone, NOW, testDeps } from "./test-helpers";

const db = process.env.DATABASE_URL ? await createTestDb("agents") : null;
const DAY = 86_400_000;
const daysAfter = (n: number) => () => new Date(NOW.getTime() + n * DAY);

async function renewRow(milestoneId: string, id = "1") {
  await db!.insert(schema.outbox).values({
    kind: "renew_hold",
    request: { milestoneId },
    requestId: `renew:${milestoneId}:${id}`,
    nextAttemptAt: new Date(0),
  });
}
const pendingRenewals = (milestoneId: string) =>
  db!
    .select()
    .from(schema.scheduledAction)
    .where(
      and(
        eq(schema.scheduledAction.milestoneId, milestoneId),
        eq(schema.scheduledAction.kind, "renew_hold"),
        eq(schema.scheduledAction.status, "pending"),
      ),
    );

describe.runIf(Boolean(db))("hold renewal", () => {
  beforeEach(async () => {
    await truncateAll(db!);
  });
  afterAll(async () => {
    await db!.$client.end();
  });

  it("plans renewal when an authorization hold activates", async () => {
    const { milestoneId } = await makeMilestone(db!, { state: "funding" });
    const hold = await makeHold(db!, milestoneId);
    await db!.transaction((tx) =>
      activateHold(tx, hold, { authorizationId: "AUTH-1", anchorAt: NOW, expiresAt: new Date(NOW.getTime() + 29 * DAY), amountMinor: 100000 }, NOW),
    );
    const [t] = await pendingRenewals(milestoneId);
    expect(t?.dueAt.toISOString()).toBe("2026-11-06T10:00:00.000Z");
  });

  it("plans an expiry alert for a delayed-disbursement hold", async () => {
    const { milestoneId } = await makeMilestone(db!, { state: "funding" });
    const hold = await makeHold(db!, milestoneId, { mechanism: "delayed_disbursement" });
    await db!.transaction((tx) =>
      activateHold(tx, hold, { captureId: "CAP-1", anchorAt: NOW, expiresAt: new Date(NOW.getTime() + 28 * DAY), amountMinor: 100000 }, NOW),
    );
    const [t] = await pendingRenewals(milestoneId);
    expect(t?.dueAt.toISOString()).toBe("2026-11-04T10:00:00.000Z");
  });

  it("replaces the authorization from the vault at day 27", async () => {
    const { milestoneId } = await makeMilestone(db!, { state: "in_progress", heldMinor: 100000 });
    const old = await makeHold(db!, milestoneId, { status: "active", authorizationId: "AUTH-1", anchorAt: NOW });
    await renewRow(milestoneId);
    const paypal = fakePayPal();
    await executeOutbox(testDeps(db!, paypal, daysAfter(27)));
    expect(paypal.createFundingOrder).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: `renew:${milestoneId}:1:order`, vaultId: "VAULT-1", mechanism: "authorization" }),
    );
    expect(paypal.placeHold).toHaveBeenCalledWith(expect.objectContaining({ requestId: `renew:${milestoneId}:1:hold`, orderId: "ORDER-2" }));
    const holds = await db!.select().from(schema.hold).where(eq(schema.hold.milestoneId, milestoneId));
    expect(holds).toHaveLength(2);
    const [voidRow] = await db!.select().from(schema.outbox).where(eq(schema.outbox.kind, "void_hold"));
    expect(voidRow?.requestId).toBe(`void:${old.id}`);
    const [t] = await pendingRenewals(milestoneId);
    expect(t?.dueAt.toISOString()).toBe(new Date(NOW.getTime() + 54 * DAY).toISOString());
  });

  it("reauthorizes after the honor period", async () => {
    const { milestoneId } = await makeMilestone(db!, { state: "in_progress", heldMinor: 100000 });
    const hold = await makeHold(db!, milestoneId, { status: "active", authorizationId: "AUTH-1", anchorAt: NOW });
    await renewRow(milestoneId);
    const paypal = fakePayPal();
    await executeOutbox(testDeps(db!, paypal, daysAfter(10)));
    expect(paypal.renewHold).toHaveBeenCalledWith({
      requestId: `renew:${milestoneId}:1`,
      authorizationId: "AUTH-1",
      amount: { currency: "USD", minor: 100000 },
    });
    const [h] = await db!.select().from(schema.hold).where(eq(schema.hold.id, hold.id));
    expect(h?.paypalAuthorizationId).toBe("AUTH-2");
  });

  it("does nothing inside the honor period", async () => {
    const { milestoneId } = await makeMilestone(db!, { state: "in_progress", heldMinor: 100000 });
    await makeHold(db!, milestoneId, { status: "active", authorizationId: "AUTH-1", anchorAt: NOW });
    await renewRow(milestoneId);
    const paypal = fakePayPal();
    await executeOutbox(testDeps(db!, paypal, daysAfter(1)));
    expect(paypal.renewHold).not.toHaveBeenCalled();
    expect(await pendingRenewals(milestoneId)).toHaveLength(1);
  });

  it("alerts before a delayed hold auto-disburses", async () => {
    const { milestoneId } = await makeMilestone(db!, { state: "in_progress", heldMinor: 100000 });
    await makeHold(db!, milestoneId, { status: "active", mechanism: "delayed_disbursement", captureId: "CAP-1", anchorAt: NOW });
    await renewRow(milestoneId);
    const paypal = fakePayPal();
    await executeOutbox(testDeps(db!, paypal, daysAfter(25)));
    const types = (await db!.select().from(schema.event)).map((e) => e.type).sort();
    expect(types).toEqual(["alert.raised", "milestone.hold_expiring"]);
    expect(paypal.createFundingOrder).not.toHaveBeenCalled();
  });

  it("skips renewal when the hold is no longer active", async () => {
    const { milestoneId } = await makeMilestone(db!, { state: "released", heldMinor: 100000, releasedMinor: 100000 });
    await makeHold(db!, milestoneId, { status: "released", authorizationId: "AUTH-1", anchorAt: NOW });
    await renewRow(milestoneId);
    const paypal = fakePayPal();
    await executeOutbox(testDeps(db!, paypal, daysAfter(27)));
    expect(paypal.createFundingOrder).not.toHaveBeenCalled();
    expect(paypal.renewHold).not.toHaveBeenCalled();
  });

  it("fails permanently without a vaulted payment method", async () => {
    const { milestoneId, clientId } = await makeMilestone(db!, { state: "in_progress", heldMinor: 100000 });
    await db!.update(schema.client).set({ paypalVaultId: null }).where(eq(schema.client.id, clientId));
    await makeHold(db!, milestoneId, { status: "active", authorizationId: "AUTH-1", anchorAt: NOW });
    await renewRow(milestoneId);
    const paypal = fakePayPal();
    await executeOutbox(testDeps(db!, paypal, daysAfter(27)));
    const [row] = await db!.select().from(schema.outbox).where(eq(schema.outbox.kind, "renew_hold"));
    expect(row).toMatchObject({ status: "failed", lastError: "no vaulted payment method to renew the hold" });
    expect(paypal.createFundingOrder).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `DATABASE_URL=postgres://tranche:tranche@localhost:5432/tranche pnpm --filter @tranche/agents-service exec vitest run src/money/renewal.test.ts`
Expected: FAIL; no `renew_hold` timer is planned and renew rows fail with "no outbox handler for renew_hold".

- [ ] **Step 4: Implement planning**

Append to `apps/agents/src/money/timers.ts` (merge imports):

```ts
import type { HoldMechanism } from "@tranche/contracts";
import { DELAYED_ALERT_DAY, RENEW_AT_DAY } from "@tranche/core";

const DAY_MS = 86_400_000;

export async function planRenewal(
  tx: Tx,
  hold: { milestoneId: string; mechanism: HoldMechanism; originalAuthorizedAt: Date | null },
): Promise<void> {
  if (!hold.originalAuthorizedAt) return;
  const day = hold.mechanism === "authorization" ? RENEW_AT_DAY : DELAYED_ALERT_DAY;
  await scheduleTimer(tx, {
    milestoneId: hold.milestoneId,
    kind: "renew_hold",
    dueAt: new Date(hold.originalAuthorizedAt.getTime() + day * DAY_MS),
  });
}
```

In `apps/agents/src/money/holds.ts`, add `import { planRenewal } from "./timers";` and, in `activateHold`, right after the `tx.update(schema.hold)...` statement, add:

```ts
  await planRenewal(tx, { milestoneId: hold.milestoneId, mechanism: hold.mechanism, originalAuthorizedAt: facts.anchorAt });
```

- [ ] **Step 5: Implement the renew handler**

Append to `apps/agents/src/money/funding.ts` (merge imports):

```ts
import { renewalAction } from "@tranche/core";
import { appendEvent } from "./events";
import { activeHold, getHold } from "./holds";
import { planRenewal } from "./timers";

export const renewHandler: OutboxHandler = {
  async call(deps, row) {
    const milestoneId = String(row.request.milestoneId);
    const hold = await deps.db.transaction((tx) => activeHold(tx, milestoneId));
    if (!hold?.originalAuthorizedAt) return { skipped: true };
    const action = renewalAction(hold.mechanism, hold.originalAuthorizedAt.toISOString(), deps.now().toISOString());
    const amount = { currency: hold.currency, minor: hold.amountMinor };
    switch (action.kind) {
      case "none":
      case "alert":
        return { holdId: hold.id, action };
      case "reauthorize": {
        if (!hold.paypalAuthorizationId) throw new PermanentError(`hold ${hold.id} has no authorization`);
        const r = await deps.paypal.renewHold({ requestId: row.requestId, authorizationId: hold.paypalAuthorizationId, amount });
        return { holdId: hold.id, action, ...r };
      }
      case "new_authorization": {
        const ctx = await fundingContext(deps.db, milestoneId);
        if (!ctx.client.paypalVaultId) throw new PermanentError("no vaulted payment method to renew the hold");
        const order = await deps.paypal.createFundingOrder({
          requestId: `${row.requestId}:order`,
          mechanism: "authorization",
          amount,
          platformFee: platformFee(amount),
          payeeMerchantId: ctx.merchantId,
          milestoneId,
          vaultId: ctx.client.paypalVaultId,
          returnUrl: ctx.returnUrl,
          cancelUrl: ctx.cancelUrl,
        });
        const placed = await deps.paypal.placeHold({ requestId: `${row.requestId}:hold`, orderId: order.orderId, mechanism: "authorization" });
        return { holdId: hold.id, action, orderId: order.orderId, ...placed };
      }
    }
  },
  async settle(tx, deps, row, res) {
    if (res.skipped) return;
    const now = deps.now();
    const old = await getHold(tx, String(res.holdId));
    const action = res.action as { kind: string; daysLeft?: number };
    switch (action.kind) {
      case "none":
        await planRenewal(tx, old);
        return;
      case "alert":
        await appendEvent(tx, {
          type: "milestone.hold_expiring",
          dealId: null,
          milestoneId: old.milestoneId,
          payload: { holdId: old.id, daysLeft: action.daysLeft },
        });
        await appendEvent(tx, {
          type: "alert.raised",
          dealId: null,
          milestoneId: old.milestoneId,
          payload: { kind: "delayed_disbursement_expiring", holdId: old.id, daysLeft: action.daysLeft },
        });
        return;
      case "reauthorize":
        await tx
          .update(schema.hold)
          .set({ paypalAuthorizationId: String(res.authorizationId), expiresAt: new Date(String(res.expiresAt)) })
          .where(eq(schema.hold.id, old.id));
        await planRenewal(tx, old);
        return;
      case "new_authorization": {
        const [fresh] = await tx
          .insert(schema.hold)
          .values({
            milestoneId: old.milestoneId,
            mechanism: "authorization",
            paypalOrderId: String(res.orderId),
            paypalAuthorizationId: String(res.authorizationId),
            originalAuthorizedAt: now,
            amountMinor: old.amountMinor,
            currency: old.currency,
            status: "active",
            expiresAt: new Date(String(res.expiresAt)),
          })
          .returning();
        await enqueueOutbox(tx, { kind: "void_hold", request: { holdId: old.id }, requestId: `void:${old.id}` }, now);
        await planRenewal(tx, fresh!);
        await appendEvent(tx, {
          type: "milestone.held",
          dealId: null,
          milestoneId: old.milestoneId,
          payload: { renewed: true, holdId: fresh!.id, replacedHoldId: old.id },
        });
        return;
      }
    }
  },
};
```

The old hold stays `active` until its `void_hold` settles, because the void handler only voids active holds; `activeHold` already returns the newest one.

In `apps/agents/src/money/outbox-handlers.ts`, import `renewHandler` alongside `fundHandler` and register `renew_hold: renewHandler,`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `DATABASE_URL=postgres://tranche:tranche@localhost:5432/tranche pnpm --filter @tranche/agents-service test`
Expected: PASS, 8 new renewal tests plus every H3 suite.

- [ ] **Step 7: Commit**

```bash
git add apps/agents/src/money
git commit -m "feat(money): Renew authorization holds and alert on delayed expiry"
```

---

### Task 5: Applying a reschedule

**Files:**
- Create: `apps/agents/src/money/reschedule.ts`
- Modify: `apps/agents/src/money/actions.ts`, `apps/agents/src/money/index.ts`
- Test: `apps/agents/src/money/reschedule.test.ts`

**Interfaces:**
- Consumes: `rescheduleTasks`, `milestoneWindows` (core); `scheduleTimer`, `fundingDueAt` (Task 2); `appendEvent`.
- Produces:
  - `class RescheduleError extends Error`
  - `applyReschedule(tx: Tx, dealId: string, moves: Array<{ taskId: string; start: string }>, reason: string, now: Date): Promise<{ tasks: Array<{ id: string; startDate: string; endDate: string }>; milestones: Array<{ id: string; startDate: string; endDate: string }> }>`
  - Refuses: a task outside the deal; moving or pushing a task of a `released`, `paid_out`, `refunded` or `cancelled` milestone; a start before a dependency ends.
  - Writes changed task starts and milestone windows, re-dates a still-pending `fund` timer of an `agreed` milestone, and appends one `task.rescheduled` event `{ reason, changes: [{ taskId, from, to }] }` when anything moved.
  - `runExecutor` gains `case "reschedule"`.
  - `@tranche/agents-service/money` exports `applyReschedule` and `RescheduleError`.

- [ ] **Step 1: Write the failing test**

`apps/agents/src/money/reschedule.test.ts`:

```ts
import { type Db, schema } from "@tranche/db";
import { createTestDb, truncateAll } from "@tranche/db/testing";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { decideApproval, processActions } from "./actions";
import { applyReschedule, RescheduleError } from "./reschedule";
import { makeMilestone, NOW, testDeps } from "./test-helpers";

const db = process.env.DATABASE_URL ? await createTestDb("agents") : null;

async function makeTasks(d: Db, dealId: string, milestoneId: string) {
  const rows = await d
    .insert(schema.task)
    .values([
      { dealId, milestoneId, key: "a", title: "Wireframes", durationDays: 3, startDate: "2026-10-20", position: 0 },
      { dealId, milestoneId, key: "b", title: "Visual design", durationDays: 2, startDate: "2026-10-23", position: 1 },
    ])
    .returning();
  await d.insert(schema.taskDependency).values({ fromTaskId: rows[0]!.id, toTaskId: rows[1]!.id });
  await d.update(schema.milestone).set({ startDate: "2026-10-20", endDate: "2026-10-25" }).where(eq(schema.milestone.id, milestoneId));
  return { a: rows[0]!, b: rows[1]! };
}
const fundTimers = (milestoneId: string) =>
  db!
    .select()
    .from(schema.scheduledAction)
    .where(and(eq(schema.scheduledAction.milestoneId, milestoneId), eq(schema.scheduledAction.kind, "fund")))
    .orderBy(asc(schema.scheduledAction.createdAt));

describe.runIf(Boolean(db))("applyReschedule", () => {
  beforeEach(async () => {
    await truncateAll(db!);
  });
  afterAll(async () => {
    await db!.$client.end();
  });

  it("moves a task, pushes its dependent and widens the milestone window", async () => {
    const { dealId, milestoneId } = await makeMilestone(db!, { state: "agreed" });
    const { a, b } = await makeTasks(db!, dealId, milestoneId);
    const r = await db!.transaction((tx) => applyReschedule(tx, dealId, [{ taskId: a.id, start: "2026-10-22" }], "Client feedback", NOW));
    expect(r.tasks).toContainEqual({ id: b.id, startDate: "2026-10-25", endDate: "2026-10-27" });
    expect(r.milestones).toEqual([{ id: milestoneId, startDate: "2026-10-22", endDate: "2026-10-27" }]);
    const [e] = await db!.select().from(schema.event).where(eq(schema.event.type, "task.rescheduled"));
    expect(e?.payload).toEqual({
      reason: "Client feedback",
      changes: [
        { taskId: a.id, from: "2026-10-20", to: "2026-10-22" },
        { taskId: b.id, from: "2026-10-23", to: "2026-10-25" },
      ],
    });
  });

  it("moves only a pending funding timer", async () => {
    const agreed = await makeMilestone(db!, { state: "agreed" });
    const t1 = await makeTasks(db!, agreed.dealId, agreed.milestoneId);
    await db!.insert(schema.scheduledAction).values({ milestoneId: agreed.milestoneId, kind: "fund", dueAt: new Date("2026-10-17T00:00:00Z") });
    await db!.transaction((tx) => applyReschedule(tx, agreed.dealId, [{ taskId: t1.a.id, start: "2026-10-25" }], "slip", NOW));
    const timers = await fundTimers(agreed.milestoneId);
    expect(timers.map((t) => [t.status, t.dueAt.toISOString()])).toEqual([
      ["cancelled", "2026-10-17T00:00:00.000Z"],
      ["pending", "2026-10-22T00:00:00.000Z"],
    ]);

    const held = await makeMilestone(db!, { state: "held", heldMinor: 100000 });
    const t2 = await makeTasks(db!, held.dealId, held.milestoneId);
    await db!.insert(schema.scheduledAction).values({ milestoneId: held.milestoneId, kind: "fund", dueAt: NOW, status: "done" });
    await db!.transaction((tx) => applyReschedule(tx, held.dealId, [{ taskId: t2.a.id, start: "2026-10-25" }], "slip", NOW));
    expect(await fundTimers(held.milestoneId)).toHaveLength(1);
  });

  it("refuses a move before a dependency ends and changes nothing", async () => {
    const { dealId, milestoneId } = await makeMilestone(db!, { state: "agreed" });
    const { b } = await makeTasks(db!, dealId, milestoneId);
    await expect(
      db!.transaction((tx) => applyReschedule(tx, dealId, [{ taskId: b.id, start: "2026-10-21" }], "x", NOW)),
    ).rejects.toThrow(new RescheduleError('task "b" cannot start before "a" ends on 2026-10-23'));
    const [after] = await db!.select().from(schema.task).where(eq(schema.task.id, b.id));
    expect(after?.startDate).toBe("2026-10-23");
  });

  it("refuses tasks of a released milestone and tasks of another deal", async () => {
    const released = await makeMilestone(db!, { state: "released", heldMinor: 100000, releasedMinor: 100000 });
    const t = await makeTasks(db!, released.dealId, released.milestoneId);
    await expect(
      db!.transaction((tx) => applyReschedule(tx, released.dealId, [{ taskId: t.a.id, start: "2026-10-25" }], "x", NOW)),
    ).rejects.toThrow(/already released/);
    const other = await makeMilestone(db!, { state: "agreed" });
    await expect(
      db!.transaction((tx) => applyReschedule(tx, other.dealId, [{ taskId: t.a.id, start: "2026-10-25" }], "x", NOW)),
    ).rejects.toThrow(/not part of this deal/);
  });

  it("executes an approved reschedule proposal", async () => {
    const { dealId, milestoneId } = await makeMilestone(db!, { state: "agreed" });
    const { a } = await makeTasks(db!, dealId, milestoneId);
    await db!.insert(schema.proposedAction).values({
      dealId,
      agent: "monitor",
      side: "agency",
      type: "reschedule",
      payload: { type: "reschedule", shifts: [{ taskId: a.id, start: "2026-10-21" }], reason: "Designer out sick" },
      reasoning: "Late start",
      idempotencyKey: "monitor:reschedule:1",
    });
    await processActions(testDeps(db!));
    const [approval] = await db!.select().from(schema.approval);
    await decideApproval(db!, { approvalId: approval!.id, decision: "approved", decidedBy: "agency-user" }, NOW);
    await processActions(testDeps(db!));
    const [moved] = await db!.select().from(schema.task).where(eq(schema.task.id, a.id));
    expect(moved?.startDate).toBe("2026-10-21");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=postgres://tranche:tranche@localhost:5432/tranche pnpm --filter @tranche/agents-service exec vitest run src/money/reschedule.test.ts`
Expected: FAIL with "Failed to resolve import ./reschedule".

- [ ] **Step 3: Implement**

`apps/agents/src/money/reschedule.ts`:

```ts
import type { MilestoneState } from "@tranche/contracts";
import { milestoneWindows, rescheduleTasks } from "@tranche/core";
import { schema } from "@tranche/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Tx } from "./db";
import { appendEvent } from "./events";
import { fundingDueAt, scheduleTimer } from "./timers";

export class RescheduleError extends Error {}

const LOCKED: MilestoneState[] = ["released", "paid_out", "refunded", "cancelled"];

type Dated = { id: string; startDate: string; endDate: string };

export async function applyReschedule(
  tx: Tx,
  dealId: string,
  moves: Array<{ taskId: string; start: string }>,
  reason: string,
  now: Date,
): Promise<{ tasks: Dated[]; milestones: Dated[] }> {
  const tasks = await tx.select().from(schema.task).where(eq(schema.task.dealId, dealId)).orderBy(asc(schema.task.position));
  const milestones = await tx
    .select()
    .from(schema.milestone)
    .where(eq(schema.milestone.dealId, dealId))
    .orderBy(asc(schema.milestone.position));
  const deps =
    tasks.length === 0
      ? []
      : await tx.select().from(schema.taskDependency).where(inArray(schema.taskDependency.toTaskId, tasks.map((t) => t.id)));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const msById = new Map(milestones.map((m) => [m.id, m]));
  const keyOf = (id: string) => taskById.get(id)!.key;

  for (const m of moves) {
    if (!taskById.has(m.taskId)) throw new RescheduleError(`task ${m.taskId} is not part of this deal`);
  }

  const result = rescheduleTasks(
    tasks.map((t) => ({
      key: t.key,
      start: t.startDate,
      durationDays: t.durationDays,
      dependsOn: deps.filter((d) => d.toTaskId === t.id).map((d) => keyOf(d.fromTaskId)),
    })),
    moves.map((m) => ({ key: keyOf(m.taskId), start: m.start })),
  );
  if (!result.ok) throw new RescheduleError(result.reason);

  const changes: Array<{ taskId: string; from: string; to: string }> = [];
  for (const t of tasks) {
    const w = result.schedule.get(t.key)!;
    if (w.start === t.startDate) continue;
    const state = msById.get(t.milestoneId)!.state;
    if (LOCKED.includes(state)) throw new RescheduleError(`"${t.title}" belongs to a milestone that is already ${state}`);
    changes.push({ taskId: t.id, from: t.startDate, to: w.start });
  }
  for (const c of changes) {
    await tx.update(schema.task).set({ startDate: c.to }).where(eq(schema.task.id, c.taskId));
  }

  const windows = milestoneWindows(tasks.map((t) => ({ key: t.key, milestoneKey: t.milestoneId })), result.schedule);
  const datedMilestones: Dated[] = [];
  for (const m of milestones) {
    const w = windows.get(m.id);
    if (!w) continue;
    datedMilestones.push({ id: m.id, startDate: w.start, endDate: w.end });
    if (w.start === m.startDate && w.end === m.endDate) continue;
    await tx.update(schema.milestone).set({ startDate: w.start, endDate: w.end, updatedAt: now }).where(eq(schema.milestone.id, m.id));
    if (w.start === m.startDate || m.state !== "agreed") continue;
    const pending = await tx
      .select({ id: schema.scheduledAction.id })
      .from(schema.scheduledAction)
      .where(
        and(
          eq(schema.scheduledAction.milestoneId, m.id),
          eq(schema.scheduledAction.kind, "fund"),
          eq(schema.scheduledAction.status, "pending"),
        ),
      );
    if (pending.length > 0) await scheduleTimer(tx, { milestoneId: m.id, kind: "fund", dueAt: fundingDueAt(w.start, now) });
  }

  if (changes.length > 0) await appendEvent(tx, { type: "task.rescheduled", dealId, milestoneId: null, payload: { reason, changes } });

  return {
    tasks: tasks.map((t) => {
      const w = result.schedule.get(t.key)!;
      return { id: t.id, startDate: w.start, endDate: w.end };
    }),
    milestones: datedMilestones,
  };
}
```

In `apps/agents/src/money/actions.ts`, add `import { applyReschedule } from "./reschedule";` and, in `runExecutor`, before `default:`, add:

```ts
    case "reschedule":
      await applyReschedule(tx, row.dealId, p.shifts, p.reason, now);
      return;
```

In `apps/agents/src/money/index.ts` add:

```ts
export { applyReschedule, RescheduleError } from "./reschedule";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL=postgres://tranche:tranche@localhost:5432/tranche pnpm --filter @tranche/agents-service test`
Expected: PASS, 5 new reschedule tests plus every earlier suite.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/money
git commit -m "feat(money): Reschedule tasks with dependency push and timer re-dating"
```

---

### Task 6: Gantt reschedule endpoint

**Files:**
- Modify: `apps/web/package.json`, `apps/web/next.config.ts`, `packages/db/package.json`
- Create: `apps/web/src/app/api/deals/[dealId]/tasks/reschedule/route.ts`
- Test: `apps/web/src/app/api/deals/[dealId]/tasks/reschedule/route.test.ts`

**Interfaces:**
- Consumes: `applyReschedule`, `RescheduleError` from `@tranche/agents-service/money`; `getDb` (H3 `apps/web/src/lib/server.ts`); `requireDealAccess(dealId: string): Promise<{ ok: true; userId: string; workspaceId: string } | { ok: false; response: Response }>` from `apps/web/src/lib/auth-guard.ts` (H5 auth task).
- Produces: `POST /api/deals/[dealId]/tasks/reschedule`, body `{ taskId: string (uuid); start: string (YYYY-MM-DD) }`:
  - 200 `{ tasks: Array<{ id, startDate, endDate }>, milestones: Array<{ id, startDate, endDate }> }` (the Gantt replaces its rows with these)
  - 400 `{ error: "invalid body" }`, 422 `{ error: <RescheduleError message> }`, or the guard's 401/403 response.
- `@tranche/db/seed` export so web tests can seed demo data.

- [ ] **Step 1: Wire dependencies**

```bash
pnpm --filter @tranche/web add @tranche/agents-service@workspace:* @tranche/core@workspace:*
```

In `apps/web/next.config.ts` set `transpilePackages: ["@tranche/contracts", "@tranche/core", "@tranche/db", "@tranche/paypal", "@tranche/agents-service"],`.

In `packages/db/package.json` add `"./seed": "./src/seed.ts"` to `exports`.

- [ ] **Step 2: Write the failing test**

`apps/web/src/app/api/deals/[dealId]/tasks/reschedule/route.test.ts`:

```ts
import { type Db, schema } from "@tranche/db";
import { seed } from "@tranche/db/seed";
import { createTestDb, truncateAll } from "@tranche/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: null as Db | null,
  access: vi.fn(async () => ({ ok: true as const, userId: "u1", workspaceId: "w1" })),
}));
vi.mock("@/lib/server", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/auth-guard", () => ({ requireDealAccess: mocks.access }));

import { POST } from "./route";

mocks.db = process.env.DATABASE_URL ? await createTestDb("web") : null;

const call = (dealId: string, body: unknown) =>
  POST(
    new Request(`http://localhost/api/deals/${dealId}/tasks/reschedule`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ dealId }) },
  );

async function taskByKey(dealId: string, key: string) {
  const [t] = await mocks.db!.select().from(schema.task).where(and(eq(schema.task.dealId, dealId), eq(schema.task.key, key)));
  return t!;
}

describe.runIf(Boolean(mocks.db))("POST /api/deals/[dealId]/tasks/reschedule", () => {
  beforeEach(async () => {
    await truncateAll(mocks.db!);
  });
  afterAll(async () => {
    await mocks.db!.$client.end();
  });

  it("moves a task and returns the new dates", async () => {
    const { dealId } = await seed(mocks.db!);
    const visual = await taskByKey(dealId, "visual");
    const target = new Date(Date.parse(`${visual.startDate}T00:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10);
    const res = await call(dealId, { taskId: visual.id, start: target });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tasks: Array<{ id: string; startDate: string }> };
    expect(body.tasks.find((t) => t.id === visual.id)?.startDate).toBe(target);
    const visualEnd = new Date(Date.parse(`${target}T00:00:00Z`) + visual.durationDays * 86_400_000).toISOString().slice(0, 10);
    expect((await taskByKey(dealId, "catalog")).startDate).toBe(visualEnd);
  });

  it("refuses a move before a dependency ends", async () => {
    const { dealId } = await seed(mocks.db!);
    const visual = await taskByKey(dealId, "visual");
    const wire = await taskByKey(dealId, "wireframes");
    const res = await call(dealId, { taskId: visual.id, start: wire.startDate });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: expect.stringContaining('cannot start before "wireframes"') });
    expect((await taskByKey(dealId, "visual")).startDate).toBe(visual.startDate);
  });

  it("rejects a malformed body", async () => {
    const { dealId } = await seed(mocks.db!);
    expect((await call(dealId, { taskId: "nope", start: "tomorrow" })).status).toBe(400);
  });

  it("returns the guard's response when access is denied", async () => {
    mocks.access.mockResolvedValueOnce({ ok: false, response: new Response("forbidden", { status: 403 }) } as never);
    const { dealId } = await seed(mocks.db!);
    expect((await call(dealId, { taskId: crypto.randomUUID(), start: "2026-10-20" })).status).toBe(403);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `DATABASE_URL=postgres://tranche:tranche@localhost:5432/tranche pnpm --filter @tranche/web exec vitest run "src/app/api/deals/[dealId]/tasks/reschedule/route.test.ts"`
Expected: FAIL with "Failed to resolve import ./route".

- [ ] **Step 4: Implement**

`apps/web/src/app/api/deals/[dealId]/tasks/reschedule/route.ts`:

```ts
import { applyReschedule, RescheduleError } from "@tranche/agents-service/money";
import { z } from "zod";
import { requireDealAccess } from "@/lib/auth-guard";
import { getDb } from "@/lib/server";

const Body = z.object({ taskId: z.uuid(), start: z.iso.date() });

export async function POST(request: Request, ctx: { params: Promise<{ dealId: string }> }): Promise<Response> {
  const { dealId } = await ctx.params;
  const access = await requireDealAccess(dealId);
  if (!access.ok) return access.response;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });

  try {
    const result = await getDb().transaction((tx) =>
      applyReschedule(tx, dealId, [parsed.data], "Moved on the Gantt", new Date()),
    );
    return Response.json(result);
  } catch (err) {
    if (err instanceof RescheduleError) return Response.json({ error: err.message }, { status: 422 });
    throw err;
  }
}
```

- [ ] **Step 5: Run tests and the build**

Run: `DATABASE_URL=postgres://tranche:tranche@localhost:5432/tranche pnpm --filter @tranche/web test && pnpm --filter @tranche/web build`
Expected: PASS, 4 tests; the build lists `ƒ /api/deals/[dealId]/tasks/reschedule`.

- [ ] **Step 6: Commit and open the PR**

```bash
git add apps/web packages/db pnpm-lock.yaml
git commit -m "feat(web): Add Gantt reschedule endpoint"
git push -u origin feat/timers-reschedule
gh pr create --title "feat(money): Timers, funding, renewal and Gantt rescheduling" --body "Implements plan h4."
```
