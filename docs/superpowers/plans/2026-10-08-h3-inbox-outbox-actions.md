# H3 - Inbox, Outbox and Action Processing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the money pipeline that turns webhooks, delivery signals, timers and agent proposals into milestone transitions and idempotent PayPal calls, exactly once, surviving crashes and duplicates.

**Architecture:** Everything flows through Postgres. Incoming facts land in `inbox` (unique per source event) and are processed one row per transaction with `FOR UPDATE SKIP LOCKED` and a savepoint around the handler. Agent proposals in `proposed_action` are judged by `evaluatePolicy` and executed in the same transaction when they only touch the database. Anything that calls PayPal goes to `outbox` with a fixed `PayPal-Request-Id`, is claimed with a lease, called outside the database transaction, and settled in a second transaction. Milestone writes use optimistic locking on `milestone.version`.

**Tech Stack:** TypeScript 7, Drizzle ORM 0.45 (postgres.js), Zod 4.6, `@tranche/core`, `@tranche/paypal`, Render Workflows TypeScript SDK 1.2, Next.js 16 route handlers, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-08-tranche-design.md` (sections 6, 9, 12) and `docs/superpowers/plans/2026-10-08-00-foundation.md`.

**Owner:** Person H. Prerequisites: foundation, H1 (`@tranche/core`), H2 (`@tranche/paypal`).

## Integration overrides

The [integration contract](2026-10-08-01-integration-contract.md) wins over anything in this plan that conflicts with it.
Items that affect this plan:

- Task 1: the schema columns and `alert.raised` are already in the foundation; implement only `@tranche/db/testing` and skip the schema and contract edits.
- `appendEvent` is a plain insert; the notify trigger from H5 Task 6 handles `pg_notify` (section 3).
- Task 7: put `getDb` in `apps/web/src/server/db.ts`, `getPayPal` in `apps/web/src/server/paypal.ts` and `kickMoneyTick` in `apps/web/src/server/kick.ts` instead of `apps/web/src/lib/server.ts` and `lib/kick.ts`; reuse them if H5 Task 3 created `server/db.ts` already (section 1).
- Task 9: export `MONEY_TICK_TASKS` and `RECONCILE_TASK` from `apps/agents/src/money/schedule.ts` and `MONEY_HANDLERS` from `apps/agents/src/money/handlers.ts`; do not ship a separate cron script, E5's `cron-tick.ts` drives everything (section 6).
- `deal.plan_sent` payload is `{ clientId }` and `approval.requested` is `{ approvalId, proposedActionId, side }`; never put portal URLs in events (section 3).
- Timer-started funding uses the token-less return URL `${APP_URL}/portal/return?milestoneId=<id>` (section 2).

## Global Constraints

- Agents never call money-moving PayPal endpoints; only the outbox executor in `apps/agents/src/money` does.
- Every PayPal write sends `outbox.requestId` as `PayPal-Request-Id`; a retry reuses the same id.
- Every webhook is signature-verified before it is written to `inbox`; inbox rows are unique by `(source, source_event_id)`.
- Webhook and timer handling must be replay-safe: handling the same fact twice changes nothing the second time.
- `hold.original_authorized_at` stores the hold's anchor time for both mechanisms: the authorization time, or the funding capture time for delayed disbursement.
- Subcontractor split mode comes from `SUBCONTRACTOR_SPLIT` (`multi_payee`, `payouts` or `agency_pays`, default `agency_pays`), recorded by F0 in `docs/sandbox-capabilities.md`.
- No em dash characters anywhere; use a plain `-`.
- Comments only when they carry real value.
- Conventional commits, no AI co-author lines.

## Review Focus

- **The same PayPal webhook delivered twice**: one inbox row, the milestone is held once and one `milestone.held` event exists - pinned in Task 4 Step 1 ("processes a duplicated webhook once").
- **A handler that fails halfway** (milestone updated, then an effect throws): nothing it wrote survives, the inbox row keeps `processed_at` null and records the error - pinned in Task 4 Step 1 ("rolls back a half-applied message").
- **PayPal times out after it actually released the money**: the retry uses the same `PayPal-Request-Id` and the milestone is released exactly once - pinned in Task 6 Step 1 ("retries with the same request id and settles once").
- **An agent proposing a release above the per-action limit**: the action waits for a person, an approval row exists, and nothing is queued for PayPal - pinned in Task 5 Step 1 ("holds an over-limit release for approval").
- **Two writers updating one milestone at the same time**: exactly one transition wins, no lost update - pinned in Task 2 Step 1 ("lets exactly one concurrent writer win").

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/contracts/src/events.ts` | Add `alert.raised` |
| `packages/db/src/schema/core.ts` | Milestone money facts, outbox `next_attempt_at` |
| `packages/db/src/testing.ts` | `createTestDb`, `truncateAll` for integration tests |
| `apps/agents/src/money/db.ts` | `Tx` type |
| `apps/agents/src/money/errors.ts` | `PermanentError`, `errorMessage` |
| `apps/agents/src/money/deps.ts` | `Deps`, `PayPal`, `getDeps` |
| `apps/agents/src/money/events.ts` | `appendEvent` (insert + `pg_notify`) |
| `apps/agents/src/money/milestones.ts` | `advanceMilestone`, `mustAdvance`, `StaleMilestoneError` |
| `apps/agents/src/money/effects.ts` | Turns core `Effect`s into timers, outbox rows and events |
| `apps/agents/src/money/timers.ts` | `scheduleTimer`, `cancelTimers` |
| `apps/agents/src/money/holds.ts` | Hold lookup, activation and release confirmation |
| `apps/agents/src/money/outbox.ts` | `enqueueOutbox`, `executeOutbox`, retry and lease |
| `apps/agents/src/money/outbox-handlers.ts` | PayPal call and settle per outbox kind |
| `apps/agents/src/money/paypal-events.ts` | PayPal webhook event mapping |
| `apps/agents/src/money/inbox.ts` | `processInbox`, `handleMessage`, delivery and timer messages |
| `apps/agents/src/money/actions.ts` | `processActions`, plan writing, approvals, human actions |
| `apps/agents/src/money/reconcile.ts` | Hourly comparison against PayPal |
| `apps/agents/src/money/tick.ts` | One pass of the pipeline |
| `apps/agents/src/money/cron.ts` | Render cron and local loop entrypoint |
| `apps/agents/src/money/tasks.ts` | Render Workflows tasks |
| `apps/agents/src/money/index.ts` | Public API for `apps/web` |
| `apps/agents/src/money/test-helpers.ts` | Fixtures and a fake PayPal client |
| `apps/web/src/lib/server.ts` | `getDb`, `getPayPal` singletons |
| `apps/web/src/lib/kick.ts` | Optional immediate Workflows run |
| `apps/web/src/app/api/webhooks/paypal/route.ts` | PayPal webhook intake |

---

### Task 1: Schema additions and test database helper

**Files:**
- Modify: `packages/contracts/src/events.ts`, `packages/db/src/schema/core.ts`, `packages/db/package.json`
- Create: `packages/db/src/testing.ts`, new migration under `packages/db/drizzle/`
- Test: `packages/db/src/testing.test.ts`

**Interfaces:**
- Consumes: foundation schema.
- Produces:
  - `DomainEventType` gains `"alert.raised"` (payload `{ kind: string; ... }`).
  - `milestone` gains `heldMinor` (bigint, default 0), `releasedMinor` (bigint, default 0), `verifiedAt` (timestamptz, null), `releaseAuthorizedAt` (timestamptz, null).
  - `outbox` gains `nextAttemptAt` (timestamptz, not null, default now).
  - `@tranche/db/testing`: `createTestDb(name: string): Promise<Db>` (creates and migrates `tranche_test_<name>`), `truncateAll(db: Db): Promise<void>`.

- [ ] **Step 1: Write the failing test**

`packages/db/src/testing.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { schema } from "./index";
import { createTestDb, truncateAll } from "./testing";

const db = process.env.DATABASE_URL ? await createTestDb("db_testing") : null;

describe.runIf(Boolean(db))("createTestDb", () => {
  afterAll(async () => {
    await db!.$client.end();
  });

  it("defaults milestone money facts and truncates everything", async () => {
    const [ws] = await db!
      .insert(schema.workspace)
      .values({ name: "T", rateCard: { currency: "USD", dailyRateMinor: 1, minimumProjectMinor: 0 } })
      .returning();
    const [cl] = await db!.insert(schema.client).values({ workspaceId: ws!.id, name: "C", email: "c@x.test" }).returning();
    const [dl] = await db!
      .insert(schema.deal)
      .values({ workspaceId: ws!.id, clientId: cl!.id, title: "D", brief: "b", currency: "USD" })
      .returning();
    const [ms] = await db!
      .insert(schema.milestone)
      .values({
        dealId: dl!.id,
        key: "m1",
        position: 0,
        title: "M",
        priceMinor: 100,
        criteria: { checks: [{ kind: "url_live", url: "https://x.test" }], prose: [] },
        payees: [{ kind: "agency", shareBps: 10000 }],
      })
      .returning();
    expect(ms).toMatchObject({ heldMinor: 0, releasedMinor: 0, verifiedAt: null, releaseAuthorizedAt: null });

    await truncateAll(db!);
    expect(await db!.select().from(schema.milestone).where(eq(schema.milestone.id, ms!.id))).toHaveLength(0);
    expect(await db!.select().from(schema.workspace)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=postgres://tranche:tranche@localhost:5432/tranche pnpm --filter @tranche/db exec vitest run src/testing.test.ts`
Expected: FAIL with "Failed to resolve import ./testing".

- [ ] **Step 3: Add the alert event type**

In `packages/contracts/src/events.ts`, add `"alert.raised",` as the last entry of the `DomainEventType` enum, after `"negotiation.escalated",`.

- [ ] **Step 4: Add the columns**

In `packages/db/src/schema/core.ts`, inside the `milestone` table, after `endDate: date(),` add:

```ts
    heldMinor: minor().notNull().default(0),
    releasedMinor: minor().notNull().default(0),
    verifiedAt: instant(),
    releaseAuthorizedAt: instant(),
```

Inside the `outbox` table, after `attempts: integer().notNull().default(0),` add:

```ts
    nextAttemptAt: instant().notNull().defaultNow(),
```

and change its index line to:

```ts
  (t) => [index().on(t.status, t.nextAttemptAt)],
```

- [ ] **Step 5: Write the test helper**

`packages/db/src/testing.ts`:

```ts
import { getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { createDb, type Db, migrateDb, schema } from "./index";

export async function createTestDb(name: string): Promise<Db> {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is not set");
  const dbName = `tranche_test_${name.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;
  const admin = postgres(base, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`create database "${dbName}"`);
  } catch (err) {
    if ((err as { code?: string }).code !== "42P04") throw err;
  } finally {
    await admin.end();
  }
  const url = new URL(base);
  url.pathname = `/${dbName}`;
  const db = createDb(url.toString());
  await migrateDb(db);
  return db;
}

const TABLES = Object.values(schema)
  .filter((t): t is PgTable => is(t, PgTable))
  .map((t) => `"${getTableName(t)}"`)
  .join(", ");

export async function truncateAll(db: Db): Promise<void> {
  await db.execute(sql.raw(`truncate table ${TABLES} restart identity cascade`));
}
```

`42P04` is Postgres "database already exists", which happens on every run after the first.

In `packages/db/package.json` set:

```json
  "exports": {
    ".": "./src/index.ts",
    "./testing": "./src/testing.ts"
  },
```

- [ ] **Step 6: Generate the migration and run the tests**

Run: `pnpm --filter @tranche/db db:generate && DATABASE_URL=postgres://tranche:tranche@localhost:5432/tranche pnpm --filter @tranche/db test && pnpm --filter @tranche/contracts test`
Expected: a new `packages/db/drizzle/0001_*.sql` with 4 `ALTER TABLE "milestone" ADD COLUMN` and 1 `ALTER TABLE "outbox" ADD COLUMN`; all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts packages/db
git commit -m "feat(db): Add milestone money facts, outbox retry time and test databases"
```

---

### Task 2: Milestone transitions, effects, events and timers

**Files:**
- Modify: `apps/agents/package.json`
- Create: `apps/agents/vitest.config.ts`, `apps/agents/src/money/{db,errors,deps,events,milestones,effects,timers,holds,outbox,test-helpers}.ts`
- Test: `apps/agents/src/money/milestones.test.ts`

**Interfaces:**
- Consumes: `transition`, `fundingDueDate`, `MilestoneEvent`, `MilestoneSnapshot`, `Effect` from `@tranche/core`; `createPayPalClient` from `@tranche/paypal`; `createTestDb`, `truncateAll` from `@tranche/db/testing`.
- Produces:
  - `type Tx` (drizzle transaction), `type PayPal = ReturnType<typeof createPayPalClient>`, `type Deps = { db: Db; paypal: PayPal; now: () => Date }`, `getDeps(): Deps`
  - `class PermanentError extends Error`, `errorMessage(err: unknown): string`
  - `appendEvent(tx: Tx, e: { type: DomainEventType; dealId: string | null; milestoneId: string | null; payload: Record<string, unknown> }): Promise<number>` (also `pg_notify('tranche_events', '{"id","dealId","type"}')`, delivered on commit)
  - `advanceMilestone(tx: Tx, milestoneId: string, event: MilestoneEvent, opts: { now: Date; payload?: Record<string, unknown> }): Promise<{ applied: true; snapshot: MilestoneSnapshot; dealId: string } | { applied: false; reason: string }>`
  - `mustAdvance(...)` same arguments, throws when not applied
  - `class StaleMilestoneError extends Error`
  - `scheduleTimer(tx: Tx, t: { milestoneId: string; kind: ScheduledActionKind; dueAt: Date }): Promise<void>` (replaces a pending timer of the same kind)
  - `cancelTimers(tx: Tx, milestoneId: string, kinds?: ScheduledActionKind[]): Promise<void>`
  - `type OutboxKind = "place_hold" | "release" | "void_hold" | "payout" | "dispute_evidence" | "fund" | "renew_hold"`
  - `enqueueOutbox(tx: Tx, o: { kind: OutboxKind; request: Record<string, unknown>; requestId: string; proposedActionId?: string; scheduledActionId?: string }, now: Date): Promise<void>` (no-op on a duplicate `requestId`)
  - `type HoldRow`, `getHold(exec: Db | Tx, holdId: string): Promise<HoldRow>`, `activeHold(tx: Tx, milestoneId: string): Promise<HoldRow | undefined>`, `holdWhere(tx: Tx, column: "paypalOrderId" | "paypalCaptureId" | "paypalAuthorizationId", value: string): Promise<HoldRow | undefined>`, `activateHold(tx: Tx, hold: HoldRow, facts: { captureId?: string | null; authorizationId?: string | null; anchorAt: Date; expiresAt: Date; amountMinor: number }, now: Date): Promise<void>`, `confirmRelease(tx: Tx, hold: HoldRow, facts: { captureId: string | null; amountMinor: number }, now: Date): Promise<void>`
  - Effects: `schedule_funding` -> `fund` timer at `fundingDueDate(milestone.startDate)`; `schedule_auto_release` -> `auto_release` timer after `clientPolicy.autoReleaseAfterHours` plus a `remind` timer after 24 hours; `release_funds` -> outbox `release` with request id `release:<holdId>`; `void_hold` -> outbox `void_hold` with `void:<holdId>`; `pay_out` -> outbox `payout` with `payout:<milestoneId>`; `cancel_timers` cancels pending timers.

- [ ] **Step 1: Add dependencies and test config**

```bash
pnpm --filter @tranche/agents-service add drizzle-orm@0.45.4 zod@4.6.5
```

`apps/agents/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { fileParallelism: false } });
```

- [ ] **Step 2: Write the test helpers**

`apps/agents/src/money/test-helpers.ts`:

```ts
import type { AcceptanceCriteria, HoldMechanism, HoldStatus, MilestoneState, Payee, Policy } from "@tranche/contracts";
import { type Db, schema } from "@tranche/db";
import { asc, eq } from "drizzle-orm";
import { vi } from "vitest";
import type { Deps, PayPal } from "./deps";

export const NOW = new Date("2026-10-10T10:00:00Z");

export const openPolicy: Policy = {
  perActionMaxMinor: 10_000_000,
  perMilestoneMaxMinor: 10_000_000,
  perDealMaxMinor: 10_000_000,
  autoReleaseAfterHours: 48,
  cooldownMinutes: 0,
  alwaysAsk: [],
};

export const criteria: AcceptanceCriteria = {
  checks: [
    { kind: "ci_green", repo: "acme/site" },
    { kind: "url_live", url: "https://staging.acme.test" },
  ],
  prose: [],
};

type MilestoneOpts = {
  state?: MilestoneState;
  priceMinor?: number;
  heldMinor?: number;
  releasedMinor?: number;
  verifiedAt?: Date | null;
  releaseAuthorizedAt?: Date | null;
  startDate?: string | null;
  payees?: Payee[];
  clientPolicy?: Policy | null;
  agencyPolicy?: Policy | null;
  dealStatus?: "draft" | "sent" | "agreed" | "active";
};

export async function makeMilestone(db: Db, o: MilestoneOpts = {}) {
  const [ws] = await db
    .insert(schema.workspace)
    .values({
      name: "Northwind",
      paypalMerchantId: "MERCHANT-AGENCY",
      paypalOnboarding: "active",
      rateCard: { currency: "USD", dailyRateMinor: 60000, minimumProjectMinor: 0 },
    })
    .returning();
  const [cl] = await db
    .insert(schema.client)
    .values({ workspaceId: ws!.id, name: "Acme", email: "buyer@acme.test", paypalVaultId: "VAULT-1" })
    .returning();
  const [dl] = await db
    .insert(schema.deal)
    .values({
      workspaceId: ws!.id,
      clientId: cl!.id,
      title: "Storefront",
      brief: "Rebuild",
      currency: "USD",
      status: o.dealStatus ?? "active",
      clientPolicy: o.clientPolicy === undefined ? openPolicy : o.clientPolicy,
      agencyPolicy: o.agencyPolicy === undefined ? openPolicy : o.agencyPolicy,
    })
    .returning();
  const [ms] = await db
    .insert(schema.milestone)
    .values({
      dealId: dl!.id,
      key: "build",
      position: 0,
      title: "Build",
      priceMinor: o.priceMinor ?? 100000,
      criteria,
      payees: o.payees ?? [{ kind: "agency", shareBps: 10000 }],
      state: o.state ?? "draft",
      heldMinor: o.heldMinor ?? 0,
      releasedMinor: o.releasedMinor ?? 0,
      verifiedAt: o.verifiedAt ?? null,
      releaseAuthorizedAt: o.releaseAuthorizedAt ?? null,
      startDate: o.startDate ?? null,
    })
    .returning();
  return { workspaceId: ws!.id, clientId: cl!.id, dealId: dl!.id, milestoneId: ms!.id };
}

export async function makeHold(
  db: Db,
  milestoneId: string,
  o: {
    status?: HoldStatus;
    mechanism?: HoldMechanism;
    orderId?: string;
    captureId?: string | null;
    authorizationId?: string | null;
    amountMinor?: number;
  } = {},
) {
  const [h] = await db
    .insert(schema.hold)
    .values({
      milestoneId,
      mechanism: o.mechanism ?? "authorization",
      paypalOrderId: o.orderId ?? "ORDER-1",
      paypalCaptureId: o.captureId ?? null,
      paypalAuthorizationId: o.authorizationId ?? null,
      amountMinor: o.amountMinor ?? 100000,
      currency: "USD",
      status: o.status ?? "pending",
      expiresAt: new Date("2026-11-08T10:00:00Z"),
    })
    .returning();
  return h!;
}

export function fakePayPal(overrides: Record<string, unknown> = {}): PayPal {
  return {
    createSellerReferral: vi.fn(async () => ({ actionUrl: "https://sandbox.paypal.test/referral" })),
    getSellerStatus: vi.fn(async () => ({ merchantId: "MERCHANT-AGENCY", paymentsReceivable: true, primaryEmailConfirmed: true })),
    createFundingOrder: vi.fn(async () => ({ orderId: "ORDER-2", approveUrl: null, status: "CREATED" })),
    placeHold: vi.fn(async () => ({ captureId: null, authorizationId: "AUTH-1", expiresAt: "2026-11-08T10:00:00Z" })),
    renewHold: vi.fn(async () => ({ authorizationId: "AUTH-2", expiresAt: "2026-11-08T10:00:00Z" })),
    releaseHold: vi.fn(async () => ({ releaseRef: "CAPTURE-REL-1" })),
    voidHold: vi.fn(async () => undefined),
    sendPayouts: vi.fn(async () => ({ batchId: "BATCH-1" })),
    verifyWebhook: vi.fn(async () => true),
    getOrder: vi.fn(async () => ({ status: "COMPLETED" })),
    getCapture: vi.fn(async () => ({ status: "COMPLETED" })),
    getAuthorization: vi.fn(async () => ({ status: "CREATED" })),
    submitDisputeEvidence: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as PayPal;
}

export function testDeps(db: Db, paypal: PayPal = fakePayPal(), now: () => Date = () => NOW): Deps {
  return { db, paypal, now };
}

export async function eventTypes(db: Db, milestoneId: string): Promise<string[]> {
  const rows = await db
    .select({ type: schema.event.type })
    .from(schema.event)
    .where(eq(schema.event.milestoneId, milestoneId))
    .orderBy(asc(schema.event.id));
  return rows.map((r) => r.type);
}
```

- [ ] **Step 3: Write the failing test**

`apps/agents/src/money/milestones.test.ts`:

```ts
import { schema } from "@tranche/db";
import { createTestDb, truncateAll } from "@tranche/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { advanceMilestone } from "./milestones";
import { eventTypes, makeHold, makeMilestone, NOW } from "./test-helpers";

const db = process.env.DATABASE_URL ? await createTestDb("agents") : null;

describe.runIf(Boolean(db))("advanceMilestone", () => {
  beforeEach(async () => {
    await truncateAll(db!);
  });
  afterAll(async () => {
    await db!.$client.end();
  });

  it("applies a transition, bumps the version and writes the event with payload", async () => {
    const { milestoneId } = await makeMilestone(db!, { state: "agreed" });
    const r = await db!.transaction((tx) =>
      advanceMilestone(tx, milestoneId, { type: "funding_requested" }, { now: NOW, payload: { orderId: "ORDER-1" } }),
    );
    expect(r.applied).toBe(true);
    const [m] = await db!.select().from(schema.milestone).where(eq(schema.milestone.id, milestoneId));
    expect(m).toMatchObject({ state: "funding", version: 1 });
    const [e] = await db!.select().from(schema.event).where(eq(schema.event.milestoneId, milestoneId));
    expect(e?.type).toBe("milestone.funding_requested");
    expect(e?.payload).toMatchObject({ orderId: "ORDER-1", state: "funding" });
  });

  it("refuses an illegal event without writing anything", async () => {
    const { milestoneId } = await makeMilestone(db!, { state: "draft" });
    const r = await db!.transaction((tx) => advanceMilestone(tx, milestoneId, { type: "work_started" }, { now: NOW }));
    expect(r).toEqual({ applied: false, reason: "work_started is not allowed in state draft" });
    expect(await eventTypes(db!, milestoneId)).toEqual([]);
  });

  it("lets exactly one concurrent writer win", async () => {
    const { milestoneId } = await makeMilestone(db!, { state: "verifying", heldMinor: 100000 });
    const results = await Promise.allSettled([
      db!.transaction((tx) =>
        advanceMilestone(tx, milestoneId, { type: "verification_passed", at: NOW.toISOString() }, { now: NOW }),
      ),
      db!.transaction((tx) => advanceMilestone(tx, milestoneId, { type: "verification_failed", missing: ["x"] }, { now: NOW })),
    ]);
    const applied = results.filter((r) => r.status === "fulfilled" && r.value.applied);
    expect(applied).toHaveLength(1);
    const [m] = await db!.select().from(schema.milestone).where(eq(schema.milestone.id, milestoneId));
    expect(m?.version).toBe(1);
  });

  it("schedules funding three days before the milestone starts", async () => {
    const { milestoneId } = await makeMilestone(db!, { state: "draft", startDate: "2026-10-20" });
    await db!.transaction((tx) => advanceMilestone(tx, milestoneId, { type: "plan_agreed" }, { now: NOW }));
    const [t] = await db!.select().from(schema.scheduledAction).where(eq(schema.scheduledAction.milestoneId, milestoneId));
    expect(t).toMatchObject({ kind: "fund", status: "pending", dueAt: new Date("2026-10-17T00:00:00Z") });
  });

  it("schedules auto-release and a reminder after verification", async () => {
    const { milestoneId } = await makeMilestone(db!, { state: "verifying", heldMinor: 100000 });
    await db!.transaction((tx) =>
      advanceMilestone(tx, milestoneId, { type: "verification_passed", at: NOW.toISOString() }, { now: NOW }),
    );
    const timers = await db!.select().from(schema.scheduledAction).where(eq(schema.scheduledAction.milestoneId, milestoneId));
    expect(timers.map((t) => [t.kind, t.dueAt.toISOString()]).sort()).toEqual([
      ["auto_release", "2026-10-12T10:00:00.000Z"],
      ["remind", "2026-10-11T10:00:00.000Z"],
    ]);
  });

  it("queues the release on the active hold", async () => {
    const { milestoneId } = await makeMilestone(db!, { state: "release_pending", heldMinor: 100000, verifiedAt: NOW });
    const hold = await makeHold(db!, milestoneId, { status: "active", authorizationId: "AUTH-1" });
    await db!.transaction((tx) =>
      advanceMilestone(tx, milestoneId, { type: "release_approved", at: NOW.toISOString() }, { now: NOW }),
    );
    const [o] = await db!.select().from(schema.outbox);
    expect(o).toMatchObject({ kind: "release", requestId: `release:${hold.id}`, request: { holdId: hold.id, amountMinor: 100000 } });
  });

  it("voids the hold and cancels timers when a funded milestone is cancelled", async () => {
    const { milestoneId } = await makeMilestone(db!, { state: "held", heldMinor: 100000 });
    const hold = await makeHold(db!, milestoneId, { status: "active", authorizationId: "AUTH-1" });
    await db!.insert(schema.scheduledAction).values({ milestoneId, kind: "renew_hold", dueAt: NOW });
    await db!.transaction((tx) => advanceMilestone(tx, milestoneId, { type: "cancel" }, { now: NOW }));
    const [o] = await db!.select().from(schema.outbox).where(eq(schema.outbox.kind, "void_hold"));
    expect(o?.requestId).toBe(`void:${hold.id}`);
    const pending = await db!
      .select()
      .from(schema.scheduledAction)
      .where(and(eq(schema.scheduledAction.milestoneId, milestoneId), eq(schema.scheduledAction.status, "pending")));
    expect(pending).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `DATABASE_URL=postgres://tranche:tranche@localhost:5432/tranche pnpm --filter @tranche/agents-service exec vitest run src/money/milestones.test.ts`
Expected: FAIL with "Failed to resolve import ./milestones".

- [ ] **Step 5: Implement the modules**

`apps/agents/src/money/db.ts`:

```ts
import type { Db } from "@tranche/db";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
```

`apps/agents/src/money/errors.ts`:

```ts
export class PermanentError extends Error {}

export function errorMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 2000);
}
```

`apps/agents/src/money/deps.ts`:

```ts
import { createDb, type Db } from "@tranche/db";
import { createPayPalClient } from "@tranche/paypal";

export type PayPal = ReturnType<typeof createPayPalClient>;
export type Deps = { db: Db; paypal: PayPal; now: () => Date };

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

let cached: Deps | undefined;

export function getDeps(): Deps {
  cached ??= {
    db: createDb(),
    paypal: createPayPalClient({
      clientId: required("PAYPAL_CLIENT_ID"),
      clientSecret: required("PAYPAL_CLIENT_SECRET"),
      baseUrl: process.env.PAYPAL_BASE_URL ?? "https://api-m.sandbox.paypal.com",
    }),
    now: () => new Date(),
  };
  return cached;
}
```

`apps/agents/src/money/events.ts`:

```ts
import type { DomainEventType } from "@tranche/contracts";
import { schema } from "@tranche/db";
import { sql } from "drizzle-orm";
import type { Tx } from "./db";

export async function appendEvent(
  tx: Tx,
  e: { type: DomainEventType; dealId: string | null; milestoneId: string | null; payload: Record<string, unknown> },
): Promise<number> {
  const [row] = await tx.insert(schema.event).values(e).returning({ id: schema.event.id });
  const id = row!.id;
  await tx.execute(sql`select pg_notify('tranche_events', ${JSON.stringify({ id, dealId: e.dealId, type: e.type })})`);
  return id;
}
```

`apps/agents/src/money/timers.ts`:

```ts
import type { ScheduledActionKind } from "@tranche/contracts";
import { schema } from "@tranche/db";
import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "./db";

const t = schema.scheduledAction;

export async function cancelTimers(tx: Tx, milestoneId: string, kinds?: ScheduledActionKind[]): Promise<void> {
  await tx
    .update(t)
    .set({ status: "cancelled" })
    .where(and(eq(t.milestoneId, milestoneId), eq(t.status, "pending"), kinds ? inArray(t.kind, kinds) : undefined));
}

export async function scheduleTimer(
  tx: Tx,
  timer: { milestoneId: string; kind: ScheduledActionKind; dueAt: Date },
): Promise<void> {
  await cancelTimers(tx, timer.milestoneId, [timer.kind]);
  await tx.insert(t).values(timer);
}
```

`apps/agents/src/money/outbox.ts` (enqueue only for now; Task 6 adds the executor):

```ts
import { schema } from "@tranche/db";
import type { Tx } from "./db";

export type OutboxKind = "place_hold" | "release" | "void_hold" | "payout" | "dispute_evidence" | "fund" | "renew_hold";

export async function enqueueOutbox(
  tx: Tx,
  o: {
    kind: OutboxKind;
    request: Record<string, unknown>;
    requestId: string;
    proposedActionId?: string;
    scheduledActionId?: string;
  },
  now: Date,
): Promise<void> {
  await tx
    .insert(schema.outbox)
    .values({ ...o, nextAttemptAt: now })
    .onConflictDoNothing({ target: schema.outbox.requestId });
}
```

`apps/agents/src/money/holds.ts`:

```ts
import { type Db, schema } from "@tranche/db";
import { and, desc, eq } from "drizzle-orm";
import type { Tx } from "./db";
import { PermanentError } from "./errors";
import { appendEvent } from "./events";
import { advanceMilestone } from "./milestones";

export type HoldRow = typeof schema.hold.$inferSelect;

export async function getHold(exec: Db | Tx, holdId: string): Promise<HoldRow> {
  const [h] = await exec.select().from(schema.hold).where(eq(schema.hold.id, holdId));
  if (!h) throw new PermanentError(`hold ${holdId} not found`);
  return h;
}

export async function activeHold(tx: Tx, milestoneId: string): Promise<HoldRow | undefined> {
  const [h] = await tx
    .select()
    .from(schema.hold)
    .where(and(eq(schema.hold.milestoneId, milestoneId), eq(schema.hold.status, "active")))
    .orderBy(desc(schema.hold.createdAt))
    .limit(1);
  return h;
}

export async function holdWhere(
  tx: Tx,
  column: "paypalOrderId" | "paypalCaptureId" | "paypalAuthorizationId",
  value: string,
): Promise<HoldRow | undefined> {
  const [h] = await tx
    .select()
    .from(schema.hold)
    .where(eq(schema.hold[column], value))
    .orderBy(desc(schema.hold.createdAt))
    .limit(1);
  return h;
}

export async function activateHold(
  tx: Tx,
  hold: HoldRow,
  facts: { captureId?: string | null; authorizationId?: string | null; anchorAt: Date; expiresAt: Date; amountMinor: number },
  now: Date,
): Promise<void> {
  if (hold.status !== "pending") return;
  await tx
    .update(schema.hold)
    .set({
      status: "active",
      paypalCaptureId: facts.captureId ?? hold.paypalCaptureId,
      paypalAuthorizationId: facts.authorizationId ?? hold.paypalAuthorizationId,
      originalAuthorizedAt: facts.anchorAt,
      expiresAt: facts.expiresAt,
    })
    .where(eq(schema.hold.id, hold.id));
  const r = await advanceMilestone(tx, hold.milestoneId, { type: "hold_confirmed", amountMinor: facts.amountMinor }, { now });
  if (!r.applied) {
    await appendEvent(tx, {
      type: "alert.raised",
      dealId: null,
      milestoneId: hold.milestoneId,
      payload: { kind: "hold_mismatch", holdId: hold.id, reason: r.reason },
    });
  }
}

export async function confirmRelease(
  tx: Tx,
  hold: HoldRow,
  facts: { captureId: string | null; amountMinor: number },
  now: Date,
): Promise<void> {
  if (hold.status !== "released") {
    await tx
      .update(schema.hold)
      .set({ status: "released", paypalCaptureId: facts.captureId ?? hold.paypalCaptureId })
      .where(eq(schema.hold.id, hold.id));
  }
  await advanceMilestone(tx, hold.milestoneId, { type: "release_confirmed", amountMinor: facts.amountMinor }, { now });
}
```

`confirmRelease` ignores a refused transition on purpose: the sync PayPal response and the webhook both confirm the same release, and the second one must be a no-op.

`apps/agents/src/money/milestones.ts`:

```ts
import { type MilestoneEvent, type MilestoneSnapshot, transition } from "@tranche/core";
import { schema } from "@tranche/db";
import { and, eq } from "drizzle-orm";
import type { Tx } from "./db";
import { applyEffects } from "./effects";

export class StaleMilestoneError extends Error {}

type MilestoneRow = typeof schema.milestone.$inferSelect;

export function toSnapshot(m: MilestoneRow): MilestoneSnapshot {
  return {
    state: m.state,
    priceMinor: m.priceMinor,
    heldMinor: m.heldMinor,
    releasedMinor: m.releasedMinor,
    verifiedAt: m.verifiedAt?.toISOString() ?? null,
    releaseAuthorizedAt: m.releaseAuthorizedAt?.toISOString() ?? null,
  };
}

export type Advance =
  | { applied: true; snapshot: MilestoneSnapshot; dealId: string }
  | { applied: false; reason: string };

export async function advanceMilestone(
  tx: Tx,
  milestoneId: string,
  event: MilestoneEvent,
  opts: { now: Date; payload?: Record<string, unknown> },
): Promise<Advance> {
  const [m] = await tx.select().from(schema.milestone).where(eq(schema.milestone.id, milestoneId));
  if (!m) return { applied: false, reason: `milestone ${milestoneId} not found` };
  const result = transition(toSnapshot(m), event);
  if (!result.ok) return { applied: false, reason: result.reason };
  const n = result.next;
  const updated = await tx
    .update(schema.milestone)
    .set({
      state: n.state,
      heldMinor: n.heldMinor,
      releasedMinor: n.releasedMinor,
      verifiedAt: n.verifiedAt ? new Date(n.verifiedAt) : null,
      releaseAuthorizedAt: n.releaseAuthorizedAt ? new Date(n.releaseAuthorizedAt) : null,
      version: m.version + 1,
      updatedAt: opts.now,
    })
    .where(and(eq(schema.milestone.id, milestoneId), eq(schema.milestone.version, m.version)))
    .returning({ id: schema.milestone.id });
  if (updated.length === 0) throw new StaleMilestoneError(`milestone ${milestoneId} changed concurrently`);
  await applyEffects(
    tx,
    { milestoneId, dealId: m.dealId, snapshot: n, now: opts.now, payload: opts.payload ?? {} },
    result.effects,
  );
  return { applied: true, snapshot: n, dealId: m.dealId };
}

export async function mustAdvance(
  tx: Tx,
  milestoneId: string,
  event: MilestoneEvent,
  opts: { now: Date; payload?: Record<string, unknown> },
): Promise<void> {
  const r = await advanceMilestone(tx, milestoneId, event, opts);
  if (!r.applied) throw new Error(`${event.type}: ${r.reason}`);
}
```

`apps/agents/src/money/effects.ts`:

```ts
import { type Effect, fundingDueDate, type MilestoneSnapshot } from "@tranche/core";
import { schema } from "@tranche/db";
import { eq } from "drizzle-orm";
import type { Tx } from "./db";
import { appendEvent } from "./events";
import { activeHold } from "./holds";
import { enqueueOutbox } from "./outbox";
import { cancelTimers, scheduleTimer } from "./timers";

const HOUR_MS = 3_600_000;
const REMIND_AFTER_HOURS = 24;

export type EffectContext = {
  milestoneId: string;
  dealId: string;
  snapshot: MilestoneSnapshot;
  now: Date;
  payload: Record<string, unknown>;
};

export async function applyEffects(tx: Tx, ctx: EffectContext, effects: Effect[]): Promise<void> {
  const { milestoneId, dealId, now } = ctx;
  for (const effect of effects) {
    switch (effect.type) {
      case "emit":
        await appendEvent(tx, {
          type: effect.event,
          dealId,
          milestoneId,
          payload: { ...ctx.payload, state: ctx.snapshot.state },
        });
        break;
      case "schedule_funding": {
        const [m] = await tx
          .select({ startDate: schema.milestone.startDate })
          .from(schema.milestone)
          .where(eq(schema.milestone.id, milestoneId));
        const today = now.toISOString().slice(0, 10);
        const due = fundingDueDate(m?.startDate ?? today, today);
        await scheduleTimer(tx, { milestoneId, kind: "fund", dueAt: due === today ? now : new Date(`${due}T00:00:00Z`) });
        break;
      }
      case "schedule_auto_release": {
        const [d] = await tx
          .select({ clientPolicy: schema.deal.clientPolicy })
          .from(schema.deal)
          .where(eq(schema.deal.id, dealId));
        const hours = d?.clientPolicy?.autoReleaseAfterHours;
        if (hours) await scheduleTimer(tx, { milestoneId, kind: "auto_release", dueAt: new Date(now.getTime() + hours * HOUR_MS) });
        await scheduleTimer(tx, { milestoneId, kind: "remind", dueAt: new Date(now.getTime() + REMIND_AFTER_HOURS * HOUR_MS) });
        break;
      }
      case "cancel_timers":
        await cancelTimers(tx, milestoneId);
        break;
      case "release_funds": {
        const hold = await activeHold(tx, milestoneId);
        if (!hold) throw new Error(`milestone ${milestoneId} has no active hold to release`);
        await enqueueOutbox(
          tx,
          { kind: "release", request: { holdId: hold.id, amountMinor: effect.amountMinor }, requestId: `release:${hold.id}` },
          now,
        );
        break;
      }
      case "void_hold": {
        const hold = await activeHold(tx, milestoneId);
        if (hold) await enqueueOutbox(tx, { kind: "void_hold", request: { holdId: hold.id }, requestId: `void:${hold.id}` }, now);
        break;
      }
      case "pay_out":
        await enqueueOutbox(tx, { kind: "payout", request: { milestoneId }, requestId: `payout:${milestoneId}` }, now);
        break;
    }
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `DATABASE_URL=postgres://tranche:tranche@localhost:5432/tranche pnpm --filter @tranche/agents-service exec vitest run src/money/milestones.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 7: Commit**

```bash
git add apps/agents pnpm-lock.yaml
git commit -m "feat(money): Apply milestone transitions with effects, events and timers"
```

---

### Task 3: PayPal webhook event mapping

**Files:**
- Create: `apps/agents/src/money/paypal-events.ts`
- Test: `apps/agents/src/money/paypal-events.test.ts`

**Interfaces:**
- Consumes: Task 2 (`holdWhere`, `activateHold`, `confirmRelease`, `advanceMilestone`, `enqueueOutbox`, `appendEvent`); `fromPayPalValue` from `@tranche/contracts`.
- Produces: `handlePayPalEvent(tx: Tx, deps: Deps, eventType: string, resource: Record<string, unknown>): Promise<void>`. Handled event types:

| PayPal event | Effect |
|---|---|
| `CHECKOUT.ORDER.APPROVED` | outbox `place_hold` with request id `place:<holdId>` |
| `PAYMENT.AUTHORIZATION.CREATED` | hold active, milestone `hold_confirmed` |
| `PAYMENT.CAPTURE.COMPLETED` | delayed mechanism and pending hold: funding confirmed; authorization mechanism: release confirmed |
| `PAYMENT.REFERENCED-PAYOUT-ITEM.COMPLETED` | release confirmed (delayed mechanism) |
| `PAYMENT.AUTHORIZATION.VOIDED` | hold voided; `alert.raised` unless the milestone was cancelled |
| `CUSTOMER.DISPUTE.CREATED` | milestone `dispute_opened` |
| `CUSTOMER.DISPUTE.RESOLVED` | milestone `dispute_resolved` (`RESOLVED_BUYER_FAVOUR` means buyer) |
| `PAYMENT.PAYOUTSBATCH.SUCCESS` | payouts completed; milestone `payout_confirmed` when all its payouts completed |
| anything else | ignored |

- [ ] **Step 1: Write the failing test**

`apps/agents/src/money/paypal-events.test.ts`:

```ts
import { schema } from "@tranche/db";
import { createTestDb, truncateAll } from "@tranche/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { handlePayPalEvent } from "./paypal-events";
import { eventTypes, makeHold, makeMilestone, NOW, testDeps } from "./test-helpers";

const db = process.env.DATABASE_URL ? await createTestDb("agents") : null;
const amount = { currency_code: "USD", value: "1000.00" };
const related = (order_id: string) => ({ supplementary_data: { related_ids: { order_id } } });

async function handle(eventType: string, resource: Record<string, unknown>) {
  await db!.transaction((tx) => handlePayPalEvent(tx, testDeps(db!), eventType, resource));
}
const milestoneOf = async (id: string) =>
  (await db!.select().from(schema.milestone).where(eq(schema.milestone.id, id)))[0]!;
const holdOf = async (id: string) => (await db!.select().from(schema.hold).where(eq(schema.hold.id, id)))[0]!;

describe.runIf(Boolean(db))("handlePayPalEvent", () => {
  beforeEach(async () => {
    await truncateAll(db!);
  });
  afterAll(async () => {
    await db!.$client.end();
  });

  it("queues a hold when the buyer approves the order", async () => {
    const { milestoneId } = await makeMilestone(db!, { state: "funding" });
    const hold = await makeHold(db!, milestoneId);
    await handle("CHECKOUT.ORDER.APPROVED", { id: "ORDER-1", status: "APPROVED" });
    const [o] = await db!.select().from(schema.outbox);
    expect(o).toMatchObject({ kind: "place_hold", requestId: `place:${hold.id}` });
  });

  it("activates an authorization hold", async () => {
    const { milestoneId } = await makeMilestone(db!, { state: "funding" });
    const hold = await makeHold(db!, milestoneId);
    await handle("PAYMENT.AUTHORIZATION.CREATED", {
      id: "AUTH-9",
      amount,
      create_time: "2026-10-10T10:00:00Z",
      expiration_time: "2026-11-08T10:00:00Z",
      ...related("ORDER-1"),
    });
    expect(await holdOf(hold.id)).toMatchObject({ status: "active", paypalAuthorizationId: "AUTH-9" });
    expect(await milestoneOf(milestoneId)).toMatchObject({ state: "held", heldMinor: 100000 });
  });

  it("activates a delayed-disbursement hold on the funding capture", async () => {
    const { milestoneId } = await makeMilestone(db!, { state: "funding" });
    const hold = await makeHold(db!, milestoneId, { mechanism: "delayed_disbursement" });
    await handle("PAYMENT.CAPTURE.COMPLETED", { id: "CAP-1", amount, create_time: "2026-10-10T10:00:00Z", ...related("ORDER-1") });
    const h = await holdOf(hold.id);
    expect(h).toMatchObject({ status: "active", paypalCaptureId: "CAP-1" });
    expect(h.expiresAt.toISOString()).toBe("2026-11-07T10:00:00.000Z");
  });

  it("confirms an authorization release on capture", async () => {
    const { milestoneId } = await makeMilestone(db!, {
      state: "release_pending",
      heldMinor: 100000,
      verifiedAt: NOW,
      releaseAuthorizedAt: NOW,
    });
    const hold = await makeHold(db!, milestoneId, { status: "active", authorizationId: "AUTH-1" });
    await handle("PAYMENT.CAPTURE.COMPLETED", { id: "CAP-2", amount, ...related("ORDER-1") });
    expect(await holdOf(hold.id)).toMatchObject({ status: "released", paypalCaptureId: "CAP-2" });
    expect(await milestoneOf(milestoneId)).toMatchObject({ state: "released", releasedMinor: 100000 });
  });

  it("confirms a delayed release on the referenced payout", async () => {
    const { milestoneId } = await makeMilestone(db!, {
      state: "release_pending",
      heldMinor: 100000,
      verifiedAt: NOW,
      releaseAuthorizedAt: NOW,
    });
    await makeHold(db!, milestoneId, { status: "active", mechanism: "delayed_disbursement", captureId: "CAP-1" });
    await handle("PAYMENT.REFERENCED-PAYOUT-ITEM.COMPLETED", { reference_id: "CAP-1", reference_type: "TRANSACTION_ID" });
    expect((await milestoneOf(milestoneId)).state).toBe("released");
  });

  it("raises an alert when PayPal voids a hold we still need", async () => {
    const { milestoneId } = await makeMilestone(db!, { state: "in_progress", heldMinor: 100000 });
    const hold = await makeHold(db!, milestoneId, { status: "active", authorizationId: "AUTH-1" });
    await handle("PAYMENT.AUTHORIZATION.VOIDED", { id: "AUTH-1" });
    expect((await holdOf(hold.id)).status).toBe("voided");
    expect(await eventTypes(db!, milestoneId)).toContain("alert.raised");
  });

  it("opens and resolves a dispute", async () => {
    const { milestoneId } = await makeMilestone(db!, { state: "in_progress", heldMinor: 100000 });
    await makeHold(db!, milestoneId, { status: "active", mechanism: "delayed_disbursement", captureId: "CAP-1" });
    const disputed = [{ seller_transaction_id: "CAP-1" }];
    await handle("CUSTOMER.DISPUTE.CREATED", { dispute_id: "PP-D-1", disputed_transactions: disputed });
    expect((await milestoneOf(milestoneId)).state).toBe("disputed");
    await handle("CUSTOMER.DISPUTE.RESOLVED", {
      dispute_id: "PP-D-1",
      disputed_transactions: disputed,
      dispute_outcome: { outcome_code: "RESOLVED_BUYER_FAVOUR" },
    });
    expect((await milestoneOf(milestoneId)).state).toBe("refunded");
  });

  it("confirms payout when the batch succeeds", async () => {
    const { milestoneId } = await makeMilestone(db!, {
      state: "released",
      heldMinor: 100000,
      releasedMinor: 100000,
      verifiedAt: NOW,
      releaseAuthorizedAt: NOW,
    });
    const hold = await makeHold(db!, milestoneId, { status: "released" });
    await db!.insert(schema.payout).values({
      milestoneId,
      holdId: hold.id,
      payee: { kind: "subcontractor", name: "Dev", email: "dev@x.test", shareBps: 2000 },
      amountMinor: 20000,
      currency: "USD",
      paypalRef: "BATCH-1",
      status: "sent",
    });
    await handle("PAYMENT.PAYOUTSBATCH.SUCCESS", { batch_header: { payout_batch_id: "BATCH-1", batch_status: "SUCCESS" } });
    expect((await milestoneOf(milestoneId)).state).toBe("paid_out");
  });

  it("ignores unknown events and unknown holds", async () => {
    await handle("BILLING.PLAN.CREATED", { id: "P-1" });
    await handle("PAYMENT.AUTHORIZATION.CREATED", { id: "AUTH-X", amount, ...related("ORDER-UNKNOWN") });
    expect(await db!.select().from(schema.event)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=postgres://tranche:tranche@localhost:5432/tranche pnpm --filter @tranche/agents-service exec vitest run src/money/paypal-events.test.ts`
Expected: FAIL with "Failed to resolve import ./paypal-events".

- [ ] **Step 3: Implement**

`apps/agents/src/money/paypal-events.ts`:

```ts
import { fromPayPalValue } from "@tranche/contracts";
import { schema } from "@tranche/db";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "./db";
import type { Deps } from "./deps";
import { appendEvent } from "./events";
import { activateHold, confirmRelease, holdWhere } from "./holds";
import { advanceMilestone } from "./milestones";
import { enqueueOutbox } from "./outbox";

const DELAYED_HOLD_DAYS = 28;
const DAY_MS = 86_400_000;

const Amount = z.object({ currency_code: z.string(), value: z.string() });
const OrderRef = z.object({ supplementary_data: z.object({ related_ids: z.object({ order_id: z.string() }) }) });
const Payment = z.object({ id: z.string(), amount: Amount, create_time: z.string().optional() }).and(OrderRef);
const Authorization = Payment.and(z.object({ expiration_time: z.string() }));
const Dispute = z.object({
  dispute_id: z.string(),
  disputed_transactions: z.array(z.object({ seller_transaction_id: z.string() })).min(1),
  dispute_outcome: z.object({ outcome_code: z.string() }).optional(),
});

const minor = (a: z.infer<typeof Amount>) => fromPayPalValue(a.currency_code, a.value).minor;

export async function handlePayPalEvent(
  tx: Tx,
  deps: Deps,
  eventType: string,
  resource: Record<string, unknown>,
): Promise<void> {
  const now = deps.now();
  switch (eventType) {
    case "CHECKOUT.ORDER.APPROVED": {
      const { id } = z.object({ id: z.string() }).parse(resource);
      const hold = await holdWhere(tx, "paypalOrderId", id);
      if (hold?.status === "pending") {
        await enqueueOutbox(tx, { kind: "place_hold", request: { holdId: hold.id }, requestId: `place:${hold.id}` }, now);
      }
      return;
    }
    case "PAYMENT.AUTHORIZATION.CREATED": {
      const r = Authorization.parse(resource);
      const hold = await holdWhere(tx, "paypalOrderId", r.supplementary_data.related_ids.order_id);
      if (!hold) return;
      await activateHold(
        tx,
        hold,
        {
          authorizationId: r.id,
          anchorAt: new Date(r.create_time ?? now.toISOString()),
          expiresAt: new Date(r.expiration_time),
          amountMinor: minor(r.amount),
        },
        now,
      );
      return;
    }
    case "PAYMENT.CAPTURE.COMPLETED": {
      const r = Payment.parse(resource);
      const hold = await holdWhere(tx, "paypalOrderId", r.supplementary_data.related_ids.order_id);
      if (!hold) return;
      if (hold.mechanism === "delayed_disbursement" && hold.status === "pending") {
        const anchorAt = new Date(r.create_time ?? now.toISOString());
        await activateHold(
          tx,
          hold,
          {
            captureId: r.id,
            anchorAt,
            expiresAt: new Date(anchorAt.getTime() + DELAYED_HOLD_DAYS * DAY_MS),
            amountMinor: minor(r.amount),
          },
          now,
        );
      } else if (hold.mechanism === "authorization") {
        await confirmRelease(tx, hold, { captureId: r.id, amountMinor: minor(r.amount) }, now);
      }
      return;
    }
    case "PAYMENT.REFERENCED-PAYOUT-ITEM.COMPLETED": {
      const { reference_id } = z.object({ reference_id: z.string() }).parse(resource);
      const hold = await holdWhere(tx, "paypalCaptureId", reference_id);
      if (hold) await confirmRelease(tx, hold, { captureId: null, amountMinor: hold.amountMinor }, now);
      return;
    }
    case "PAYMENT.AUTHORIZATION.VOIDED": {
      const { id } = z.object({ id: z.string() }).parse(resource);
      const hold = await holdWhere(tx, "paypalAuthorizationId", id);
      if (!hold || hold.status === "voided") return;
      await tx.update(schema.hold).set({ status: "voided" }).where(eq(schema.hold.id, hold.id));
      const [m] = await tx.select().from(schema.milestone).where(eq(schema.milestone.id, hold.milestoneId));
      if (m && m.state !== "cancelled") {
        await appendEvent(tx, {
          type: "alert.raised",
          dealId: m.dealId,
          milestoneId: m.id,
          payload: { kind: "hold_voided", holdId: hold.id, state: m.state },
        });
      }
      return;
    }
    case "CUSTOMER.DISPUTE.CREATED":
    case "CUSTOMER.DISPUTE.RESOLVED": {
      const r = Dispute.parse(resource);
      const hold = await holdWhere(tx, "paypalCaptureId", r.disputed_transactions[0]!.seller_transaction_id);
      if (!hold) return;
      const payload = { disputeId: r.dispute_id };
      if (eventType === "CUSTOMER.DISPUTE.CREATED") {
        await advanceMilestone(tx, hold.milestoneId, { type: "dispute_opened" }, { now, payload });
      } else {
        const outcome = r.dispute_outcome?.outcome_code === "RESOLVED_BUYER_FAVOUR" ? "buyer" : "merchant";
        await advanceMilestone(tx, hold.milestoneId, { type: "dispute_resolved", outcome }, { now, payload });
      }
      return;
    }
    case "PAYMENT.PAYOUTSBATCH.SUCCESS": {
      const batchId = z.object({ batch_header: z.object({ payout_batch_id: z.string() }) }).parse(resource).batch_header
        .payout_batch_id;
      const done = await tx
        .update(schema.payout)
        .set({ status: "completed" })
        .where(eq(schema.payout.paypalRef, batchId))
        .returning({ milestoneId: schema.payout.milestoneId });
      for (const milestoneId of new Set(done.map((d) => d.milestoneId))) {
        const open = await tx
          .select({ id: schema.payout.id })
          .from(schema.payout)
          .where(and(eq(schema.payout.milestoneId, milestoneId), ne(schema.payout.status, "completed")));
        if (open.length === 0) await advanceMilestone(tx, milestoneId, { type: "payout_confirmed" }, { now });
      }
      return;
    }
    default:
      return;
  }
}
```

Dispute and transition refusals are ignored on purpose: PayPal redelivers events, and a refused transition means the fact is already applied.

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL=postgres://tranche:tranche@localhost:5432/tranche pnpm --filter @tranche/agents-service exec vitest run src/money/paypal-events.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/money/paypal-events.ts apps/agents/src/money/paypal-events.test.ts
git commit -m "feat(money): Map PayPal webhook events to holds and milestones"
```

---

### Task 4: Inbox processor

**Files:**
- Create: `apps/agents/src/money/inbox.ts`
- Test: `apps/agents/src/money/inbox.test.ts`

**Interfaces:**
- Consumes: Tasks 2-3; `InboxMessage` from `@tranche/contracts`.
- Produces:
  - `processInbox(deps: Deps, limit?: number): Promise<number>` (rows handled this pass; each row is claimed with `FOR UPDATE SKIP LOCKED`, handled inside a savepoint, and marked processed in the same transaction)
  - `handleMessage(tx: Tx, deps: Deps, message: InboxMessage): Promise<void>`
  - `delivery.detected`: `work_started` if the milestone is `held`, then `delivered`, then `verification_started`; the `milestone.verification_requested` event payload carries `{ source, repo, sha, prNumber, urls }` for Person E's verifier.
  - `timer.due`: only acts when the `scheduled_action` is `running`; `auto_release` -> `auto_release_due`; `fund` -> outbox `fund` (`fund:<timerId>`); `renew_hold` -> outbox `renew_hold` (`renew:<timerId>`); `remind` -> `send_reminder` proposal from `system` (`remind:<timerId>`); then marks the timer `done`.
  - After 10 failed attempts a row stops being retried and an `alert.raised` event with `kind: "inbox_dead_letter"` is written.

- [ ] **Step 1: Write the failing test**

`apps/agents/src/money/inbox.test.ts`:

```ts
import { schema } from "@tranche/db";
import { createTestDb, truncateAll } from "@tranche/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { processInbox } from "./inbox";
import { eventTypes, makeHold, makeMilestone, NOW, testDeps } from "./test-helpers";

const db = process.env.DATABASE_URL ? await createTestDb("agents") : null;

const webhook = (id: string, eventType: string, resource: Record<string, unknown>) => ({
  source: "paypal" as const,
  sourceEventId: id,
  message: { type: "paypal.webhook" as const, eventType, resource },
});

describe.runIf(Boolean(db))("processInbox", () => {
  beforeEach(async () => {
    await truncateAll(db!);
  });
  afterAll(async () => {
    await db!.$client.end();
  });

  it("processes a duplicated webhook once", async () => {
    const { milestoneId } = await makeMilestone(db!, { state: "funding" });
    await makeHold(db!, milestoneId);
    const row = webhook("WH-1", "PAYMENT.AUTHORIZATION.CREATED", {
      id: "AUTH-1",
      amount: { currency_code: "USD", value: "1000.00" },
      expiration_time: "2026-11-08T10:00:00Z",
      supplementary_data: { related_ids: { order_id: "ORDER-1" } },
    });
    await db!.insert(schema.inbox).values(row).onConflictDoNothing();
    await db!.insert(schema.inbox).values(row).onConflictDoNothing();
    expect(await processInbox(testDeps(db!))).toBe(1);
    expect(await processInbox(testDeps(db!))).toBe(0);
    expect((await eventTypes(db!, milestoneId)).filter((t) => t === "milestone.held")).toHaveLength(1);
  });

  it("turns a delivery into a verification request carrying the delivery facts", async () => {
    const { milestoneId } = await makeMilestone(db!, { state: "held", heldMinor: 100000 });
    await db!.insert(schema.inbox).values({
      source: "github",
      sourceEventId: "gh-1",
      message: {
        type: "delivery.detected",
        milestoneId,
        source: "github",
        repo: "acme/site",
        sha: "abc123",
        prNumber: 42,
        urls: ["https://staging.acme.test"],
      },
    });
    await processInbox(testDeps(db!));
    expect(await eventTypes(db!, milestoneId)).toEqual([
      "milestone.started",
      "milestone.delivered",
      "milestone.verification_requested",
    ]);
    const [e] = await db!.select().from(schema.event).where(eq(schema.event.type, "milestone.verification_requested"));
    expect(e?.payload).toMatchObject({ repo: "acme/site", sha: "abc123", prNumber: 42, urls: ["https://staging.acme.test"] });
  });

  it("ignores a second delivery while verifying", async () => {
    const { milestoneId } = await makeMilestone(db!, { state: "verifying", heldMinor: 100000 });
    await db!.insert(schema.inbox).values({
      source: "user",
      sourceEventId: "manual-1",
      message: { type: "delivery.detected", milestoneId, source: "manual", repo: null, sha: null, prNumber: null, urls: [] },
    });
    await processInbox(testDeps(db!));
    const [row] = await db!.select().from(schema.inbox);
    expect(row?.processedAt).not.toBeNull();
    expect(await eventTypes(db!, milestoneId)).toEqual([]);
  });

  it("rolls back a half-applied message", async () => {
    const { milestoneId } = await makeMilestone(db!, { state: "release_pending", heldMinor: 100000, verifiedAt: NOW });
    const [timer] = await db!
      .insert(schema.scheduledAction)
      .values({ milestoneId, kind: "auto_release", dueAt: NOW, status: "running" })
      .returning();
    await db!.insert(schema.inbox).values({
      source: "timer",
      sourceEventId: timer!.id,
      message: { type: "timer.due", scheduledActionId: timer!.id },
    });
    await processInbox(testDeps(db!));
    const [row] = await db!.select().from(schema.inbox);
    expect(row).toMatchObject({ processedAt: null, attempts: 1 });
    expect(row?.lastError).toMatch(/no active hold/);
    const [m] = await db!.select().from(schema.milestone).where(eq(schema.milestone.id, milestoneId));
    expect(m).toMatchObject({ releaseAuthorizedAt: null, version: 0 });
    expect(await eventTypes(db!, milestoneId)).toEqual([]);
    const [t] = await db!.select().from(schema.scheduledAction);
    expect(t?.status).toBe("running");
  });

  it("dead-letters a message after ten failures", async () => {
    await db!.insert(schema.inbox).values({
      source: "user",
      sourceEventId: "bad-1",
      message: { type: "delivery.detected", milestoneId: "00000000-0000-4000-8000-000000000000", source: "manual", repo: null, sha: null, prNumber: null, urls: [] },
    });
    for (let i = 0; i < 12; i++) await processInbox(testDeps(db!));
    const [row] = await db!.select().from(schema.inbox);
    expect(row?.attempts).toBe(10);
    const alerts = await db!.select().from(schema.event).where(eq(schema.event.type, "alert.raised"));
    expect(alerts).toHaveLength(1);
  });

  it("runs an auto-release timer and marks it done", async () => {
    const { milestoneId } = await makeMilestone(db!, { state: "release_pending", heldMinor: 100000, verifiedAt: NOW });
    await makeHold(db!, milestoneId, { status: "active", authorizationId: "AUTH-1" });
    const [timer] = await db!
      .insert(schema.scheduledAction)
      .values({ milestoneId, kind: "auto_release", dueAt: NOW, status: "running" })
      .returning();
    await db!.insert(schema.inbox).values({
      source: "timer",
      sourceEventId: timer!.id,
      message: { type: "timer.due", scheduledActionId: timer!.id },
    });
    await processInbox(testDeps(db!));
    const [t] = await db!.select().from(schema.scheduledAction).where(eq(schema.scheduledAction.id, timer!.id));
    expect(t?.status).toBe("done");
    const [o] = await db!.select().from(schema.outbox);
    expect(o?.kind).toBe("release");
  });

  it("does nothing for a timer that was cancelled", async () => {
    const { milestoneId } = await makeMilestone(db!, { state: "release_pending", heldMinor: 100000, verifiedAt: NOW });
    const [timer] = await db!
      .insert(schema.scheduledAction)
      .values({ milestoneId, kind: "auto_release", dueAt: NOW, status: "cancelled" })
      .returning();
    await db!.insert(schema.inbox).values({
      source: "timer",
      sourceEventId: timer!.id,
      message: { type: "timer.due", scheduledActionId: timer!.id },
    });
    await processInbox(testDeps(db!));
    expect(await db!.select().from(schema.outbox)).toHaveLength(0);
  });

  it("turns a reminder timer into a system proposal", async () => {
    const { milestoneId } = await makeMilestone(db!, { state: "release_pending", heldMinor: 100000, verifiedAt: NOW });
    const [timer] = await db!
      .insert(schema.scheduledAction)
      .values({ milestoneId, kind: "remind", dueAt: NOW, status: "running" })
      .returning();
    await db!.insert(schema.inbox).values({
      source: "timer",
      sourceEventId: timer!.id,
      message: { type: "timer.due", scheduledActionId: timer!.id },
    });
    await processInbox(testDeps(db!));
    const [a] = await db!.select().from(schema.proposedAction);
    expect(a).toMatchObject({ agent: "system", type: "send_reminder", idempotencyKey: `remind:${timer!.id}` });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=postgres://tranche:tranche@localhost:5432/tranche pnpm --filter @tranche/agents-service exec vitest run src/money/inbox.test.ts`
Expected: FAIL with "Failed to resolve import ./inbox".

- [ ] **Step 3: Implement**

`apps/agents/src/money/inbox.ts`:

```ts
import { InboxMessage } from "@tranche/contracts";
import { schema } from "@tranche/db";
import { and, asc, eq, isNull, lt, notInArray } from "drizzle-orm";
import type { Tx } from "./db";
import type { Deps } from "./deps";
import { errorMessage } from "./errors";
import { appendEvent } from "./events";
import { advanceMilestone, mustAdvance } from "./milestones";
import { enqueueOutbox } from "./outbox";
import { handlePayPalEvent } from "./paypal-events";

const MAX_ATTEMPTS = 10;

export async function processInbox(deps: Deps, limit = 20): Promise<number> {
  const seen: string[] = [];
  while (seen.length < limit) {
    const id = await deps.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.inbox)
        .where(
          and(
            isNull(schema.inbox.processedAt),
            lt(schema.inbox.attempts, MAX_ATTEMPTS),
            seen.length > 0 ? notInArray(schema.inbox.id, seen) : undefined,
          ),
        )
        .orderBy(asc(schema.inbox.receivedAt))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!row) return null;
      try {
        await tx.transaction((sp) => handleMessage(sp, deps, InboxMessage.parse(row.message)));
        await tx
          .update(schema.inbox)
          .set({ processedAt: deps.now(), attempts: row.attempts + 1, lastError: null })
          .where(eq(schema.inbox.id, row.id));
      } catch (err) {
        const attempts = row.attempts + 1;
        await tx.update(schema.inbox).set({ attempts, lastError: errorMessage(err) }).where(eq(schema.inbox.id, row.id));
        if (attempts >= MAX_ATTEMPTS) {
          await appendEvent(tx, {
            type: "alert.raised",
            dealId: null,
            milestoneId: null,
            payload: { kind: "inbox_dead_letter", inboxId: row.id, error: errorMessage(err) },
          });
        }
      }
      return row.id;
    });
    if (!id) break;
    seen.push(id);
  }
  return seen.length;
}

export async function handleMessage(tx: Tx, deps: Deps, message: InboxMessage): Promise<void> {
  switch (message.type) {
    case "paypal.webhook":
      return handlePayPalEvent(tx, deps, message.eventType, message.resource);
    case "delivery.detected":
      return handleDelivery(tx, deps, message);
    case "timer.due":
      return handleTimerDue(tx, deps, message.scheduledActionId);
  }
}

async function handleDelivery(
  tx: Tx,
  deps: Deps,
  m: Extract<InboxMessage, { type: "delivery.detected" }>,
): Promise<void> {
  const now = deps.now();
  const [milestone] = await tx.select().from(schema.milestone).where(eq(schema.milestone.id, m.milestoneId));
  if (!milestone) throw new Error(`milestone ${m.milestoneId} not found`);
  const payload = { source: m.source, repo: m.repo, sha: m.sha, prNumber: m.prNumber, urls: m.urls };
  if (milestone.state === "held") await mustAdvance(tx, m.milestoneId, { type: "work_started" }, { now });
  const delivered = await advanceMilestone(tx, m.milestoneId, { type: "delivered" }, { now, payload });
  if (!delivered.applied) return;
  await mustAdvance(tx, m.milestoneId, { type: "verification_started" }, { now, payload });
}

async function handleTimerDue(tx: Tx, deps: Deps, scheduledActionId: string): Promise<void> {
  const now = deps.now();
  const [timer] = await tx.select().from(schema.scheduledAction).where(eq(schema.scheduledAction.id, scheduledActionId));
  if (!timer || timer.status !== "running") return;
  const ref = { scheduledActionId: timer.id };
  switch (timer.kind) {
    case "auto_release":
      await advanceMilestone(tx, timer.milestoneId, { type: "auto_release_due", at: now.toISOString() }, { now });
      break;
    case "fund":
      await enqueueOutbox(tx, { kind: "fund", request: { milestoneId: timer.milestoneId }, requestId: `fund:${timer.id}`, ...ref }, now);
      break;
    case "renew_hold":
      await enqueueOutbox(
        tx,
        { kind: "renew_hold", request: { milestoneId: timer.milestoneId }, requestId: `renew:${timer.id}`, ...ref },
        now,
      );
      break;
    case "remind": {
      const [m] = await tx.select().from(schema.milestone).where(eq(schema.milestone.id, timer.milestoneId));
      if (m?.state === "release_pending") {
        await tx
          .insert(schema.proposedAction)
          .values({
            dealId: m.dealId,
            agent: "system",
            side: "system",
            type: "send_reminder",
            payload: {
              type: "send_reminder",
              milestoneId: m.id,
              to: "client",
              subject: `"${m.title}" is waiting for your review`,
              body: `The milestone "${m.title}" passed verification and is waiting for your release.`,
            },
            reasoning: "Scheduled reminder 24 hours after verification",
            idempotencyKey: `remind:${timer.id}`,
          })
          .onConflictDoNothing({ target: schema.proposedAction.idempotencyKey });
      }
      break;
    }
  }
  await tx.update(schema.scheduledAction).set({ status: "done" }).where(eq(schema.scheduledAction.id, timer.id));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL=postgres://tranche:tranche@localhost:5432/tranche pnpm --filter @tranche/agents-service exec vitest run src/money/inbox.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/money/inbox.ts apps/agents/src/money/inbox.test.ts
git commit -m "feat(money): Process inbox messages exactly once with dead-lettering"
```

---

### Task 5: Action processor, approvals and human actions

**Files:**
- Create: `apps/agents/src/money/actions.ts`
- Test: `apps/agents/src/money/actions.test.ts`

**Interfaces:**
- Consumes: `evaluatePolicy`, `verificationGate`, `schedulePlan`, `milestoneWindows`, `PolicyDecision` from `@tranche/core`; Task 2 helpers.
- Produces:
  - `processActions(deps: Deps, limit?: number): Promise<number>`: claims `pending` rows of any type and `approved` rows whose `ACTION_EXECUTOR` is `money` or `state`; `notify` and `display` rows stop at `approved` for Person E's notifier and the UI.
  - Approver side: `release` -> client; otherwise `client` if `side` is `client`, else `agency`. A null policy means `needs_approval`, except for `agent: "human"`.
  - `mark_verified` is re-checked with `verificationGate` against stored `evidence` before it can be approved.
  - `runExecutor(tx: Tx, deps: Deps, row: ProposedActionRow): Promise<void>` with cases `mark_verified`, `request_changes`, `release`, `create_plan`, `accept_plan`, `submit_dispute_evidence`; any other type fails with `no executor for <type>` (H4 adds `reschedule`).
  - `writePlan(tx: Tx, dealId: string, plan: PlanDraft, now: Date): Promise<void>`
  - `agreeToPlan(db: Db, dealId: string, now?: Date): Promise<void>` (client accepts a sent plan in the portal)
  - `decideApproval(db: Db, input: { approvalId: string; decision: "approved" | "rejected"; decidedBy: string }, now?: Date): Promise<void>`
  - `submitHumanAction(db: Db, input: ProposedActionInput): Promise<{ id: string; created: boolean }>` (only `agent: "human"`; used by authenticated web routes such as the portal's Release button)

- [ ] **Step 1: Write the failing test**

`apps/agents/src/money/actions.test.ts`:

```ts
import type { PlanDraft, ProposedActionInput } from "@tranche/contracts";
import { schema } from "@tranche/db";
import { createTestDb, truncateAll } from "@tranche/db/testing";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { agreeToPlan, decideApproval, processActions, submitHumanAction } from "./actions";
import { makeHold, makeMilestone, NOW, openPolicy, testDeps } from "./test-helpers";

const db = process.env.DATABASE_URL ? await createTestDb("agents") : null;

async function propose(dealId: string, input: Omit<ProposedActionInput, "dealId" | "reasoning" | "evidenceIds"> & { evidenceIds?: string[] }) {
  const [row] = await db!
    .insert(schema.proposedAction)
    .values({
      dealId,
      agent: input.agent,
      side: input.side,
      type: input.payload.type,
      payload: input.payload,
      reasoning: "test",
      evidenceIds: input.evidenceIds ?? [],
      idempotencyKey: input.idempotencyKey,
    })
    .returning();
  return row!;
}
const actionOf = async (id: string) =>
  (await db!.select().from(schema.proposedAction).where(eq(schema.proposedAction.id, id)))[0]!;

const plan: PlanDraft = {
  summary: "Storefront",
  currency: "USD",
  milestones: [
    {
      key: "design",
      title: "Design",
      price: { currency: "USD", minor: 200000 },
      criteria: { checks: [{ kind: "url_live", url: "https://x.test" }], prose: [] },
      payees: [{ kind: "agency", shareBps: 10000 }],
    },
  ],
  tasks: [
    { key: "wire", title: "Wireframes", durationDays: 3, dependsOn: [], milestoneKey: "design" },
    { key: "visual", title: "Visual", durationDays: 4, dependsOn: ["wire"], milestoneKey: "design" },
  ],
};

describe.runIf(Boolean(db))("processActions", () => {
  beforeEach(async () => {
    await truncateAll(db!);
  });
  afterAll(async () => {
    await db!.$client.end();
  });

  it("executes a release within the client's policy", async () => {
    const { dealId, milestoneId } = await makeMilestone(db!, { state: "release_pending", heldMinor: 100000, verifiedAt: NOW });
    await makeHold(db!, milestoneId, { status: "active", authorizationId: "AUTH-1" });
    const a = await propose(dealId, {
      agent: "negotiator",
      side: "client",
      idempotencyKey: "release:ok:1",
      payload: { type: "release", milestoneId, amount: { currency: "USD", minor: 100000 } },
    });
    await processActions(testDeps(db!));
    expect((await actionOf(a.id)).status).toBe("executed");
    expect(await db!.select().from(schema.outbox)).toHaveLength(1);
  });

  it("holds an over-limit release for approval", async () => {
    const { dealId, milestoneId } = await makeMilestone(db!, {
      state: "release_pending",
      heldMinor: 100000,
      verifiedAt: NOW,
      clientPolicy: { ...openPolicy, perActionMaxMinor: 50000 },
    });
    await makeHold(db!, milestoneId, { status: "active", authorizationId: "AUTH-1" });
    const a = await propose(dealId, {
      agent: "negotiator",
      side: "client",
      idempotencyKey: "release:big:1",
      payload: { type: "release", milestoneId, amount: { currency: "USD", minor: 100000 } },
    });
    await processActions(testDeps(db!));
    expect((await actionOf(a.id)).status).toBe("needs_approval");
    const [approval] = await db!.select().from(schema.approval);
    expect(approval).toMatchObject({ proposedActionId: a.id, side: "client", decision: null });
    expect(await db!.select().from(schema.outbox)).toHaveLength(0);

    await decideApproval(db!, { approvalId: approval!.id, decision: "approved", decidedBy: "client-user" }, NOW);
    await processActions(testDeps(db!));
    expect((await actionOf(a.id)).status).toBe("executed");
    expect(await db!.select().from(schema.outbox)).toHaveLength(1);
  });

  it("rejects mark_verified when stored evidence fails the gate", async () => {
    const { dealId, milestoneId } = await makeMilestone(db!, { state: "verifying", heldMinor: 100000 });
    const [ev] = await db!
      .insert(schema.evidence)
      .values({ milestoneId, kind: "ci_green", checkIndex: 0, passed: true, summary: "CI green", data: {}, contentHash: "hash-ci-0001" })
      .returning();
    const a = await propose(dealId, {
      agent: "verifier",
      side: "agency",
      idempotencyKey: "verify:1",
      evidenceIds: [ev!.id],
      payload: { type: "mark_verified", milestoneId, evidenceIds: [ev!.id] },
    });
    await processActions(testDeps(db!));
    expect(await actionOf(a.id)).toMatchObject({ status: "rejected", decisionReason: "verification gate failed for checks 1" });
  });

  it("executes mark_verified when every check passed", async () => {
    const { dealId, milestoneId } = await makeMilestone(db!, { state: "verifying", heldMinor: 100000 });
    const evs = await db!
      .insert(schema.evidence)
      .values([
        { milestoneId, kind: "ci_green", checkIndex: 0, passed: true, summary: "CI green", data: {}, contentHash: "hash-ci-0001" },
        { milestoneId, kind: "url_live", checkIndex: 1, passed: true, summary: "200 OK", data: {}, contentHash: "hash-url-001" },
      ])
      .returning();
    await propose(dealId, {
      agent: "verifier",
      side: "agency",
      idempotencyKey: "verify:2",
      payload: { type: "mark_verified", milestoneId, evidenceIds: evs.map((e) => e.id) },
    });
    await processActions(testDeps(db!));
    const [m] = await db!.select().from(schema.milestone).where(eq(schema.milestone.id, milestoneId));
    expect(m?.state).toBe("release_pending");
  });

  it("rejects an invalid payload", async () => {
    const { dealId } = await makeMilestone(db!);
    const [row] = await db!
      .insert(schema.proposedAction)
      .values({
        dealId,
        agent: "monitor",
        side: "agency",
        type: "flag_risk",
        payload: { type: "flag_risk", milestoneId: null, severity: "extreme", message: "x" } as never,
        reasoning: "r",
        idempotencyKey: "bad:payload:1",
      })
      .returning();
    await processActions(testDeps(db!));
    expect((await actionOf(row!.id)).status).toBe("rejected");
  });

  it("writes an approved plan, then the client agrees to it", async () => {
    const { dealId } = await makeMilestone(db!, { dealStatus: "draft" });
    await db!.delete(schema.milestone).where(eq(schema.milestone.dealId, dealId));
    const a = await propose(dealId, { agent: "planner", side: "agency", idempotencyKey: "plan:1", payload: { type: "create_plan", plan } });
    await processActions(testDeps(db!));
    expect((await actionOf(a.id)).status).toBe("needs_approval");
    const [approval] = await db!.select().from(schema.approval);
    await decideApproval(db!, { approvalId: approval!.id, decision: "approved", decidedBy: "agency-user" }, NOW);
    await processActions(testDeps(db!));

    const tasks = await db!.select().from(schema.task).where(eq(schema.task.dealId, dealId)).orderBy(asc(schema.task.position));
    expect(tasks.map((t) => [t.key, t.startDate])).toEqual([
      ["wire", "2026-10-10"],
      ["visual", "2026-10-13"],
    ]);
    const [m] = await db!.select().from(schema.milestone).where(eq(schema.milestone.dealId, dealId));
    expect(m).toMatchObject({ key: "design", startDate: "2026-10-10", endDate: "2026-10-17", state: "draft" });
    expect(await db!.select().from(schema.taskDependency)).toHaveLength(1);

    await agreeToPlan(db!, dealId, NOW);
    const [agreed] = await db!.select().from(schema.milestone).where(eq(schema.milestone.dealId, dealId));
    expect(agreed?.state).toBe("agreed");
    const [d] = await db!.select().from(schema.deal).where(eq(schema.deal.id, dealId));
    expect(d?.status).toBe("agreed");
    expect(await db!.select().from(schema.scheduledAction)).toHaveLength(1);
  });

  it("leaves notify actions approved for the notifier", async () => {
    const { dealId, milestoneId } = await makeMilestone(db!);
    const a = await propose(dealId, {
      agent: "monitor",
      side: "agency",
      idempotencyKey: "remind:x:1",
      payload: { type: "send_reminder", milestoneId, to: "client", subject: "Hi", body: "Please review" },
    });
    await processActions(testDeps(db!));
    expect((await actionOf(a.id)).status).toBe("approved");
  });

  it("lets a person release even with no client policy", async () => {
    const { dealId, milestoneId } = await makeMilestone(db!, {
      state: "release_pending",
      heldMinor: 100000,
      verifiedAt: NOW,
      clientPolicy: null,
    });
    await makeHold(db!, milestoneId, { status: "active", authorizationId: "AUTH-1" });
    const { id, created } = await submitHumanAction(db!, {
      dealId,
      agent: "human",
      side: "client",
      reasoning: "Client clicked Release",
      evidenceIds: [],
      idempotencyKey: `release:${milestoneId}:human`,
      payload: { type: "release", milestoneId, amount: { currency: "USD", minor: 100000 } },
    });
    expect(created).toBe(true);
    await processActions(testDeps(db!));
    expect((await actionOf(id)).status).toBe("executed");
    await expect(
      submitHumanAction(db!, {
        dealId,
        agent: "verifier",
        side: "agency",
        reasoning: "x",
        evidenceIds: [],
        idempotencyKey: "nope:12345",
        payload: { type: "flag_risk", milestoneId: null, severity: "low", message: "x" },
      }),
    ).rejects.toThrow(/agent human/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=postgres://tranche:tranche@localhost:5432/tranche pnpm --filter @tranche/agents-service exec vitest run src/money/actions.test.ts`
Expected: FAIL with "Failed to resolve import ./actions".

- [ ] **Step 3: Implement**

`apps/agents/src/money/actions.ts`:

```ts
import {
  ACTION_EXECUTOR,
  ACTION_TYPES,
  type PlanDraft,
  type Policy,
  ProposedActionInput,
} from "@tranche/contracts";
import { evaluatePolicy, milestoneWindows, type PolicyDecision, schedulePlan, verificationGate } from "@tranche/core";
import { type Db, schema } from "@tranche/db";
import { and, eq, inArray, max, notInArray, or, sql } from "drizzle-orm";
import type { Tx } from "./db";
import type { Deps } from "./deps";
import { errorMessage, PermanentError } from "./errors";
import { appendEvent } from "./events";
import { mustAdvance, StaleMilestoneError } from "./milestones";
import { enqueueOutbox } from "./outbox";

export type ProposedActionRow = typeof schema.proposedAction.$inferSelect;

const pa = schema.proposedAction;
const H_TYPES = ACTION_TYPES.filter((t) => ACTION_EXECUTOR[t] === "money" || ACTION_EXECUTOR[t] === "state");
const NO_POLICY: Policy = {
  perActionMaxMinor: 0,
  perMilestoneMaxMinor: 0,
  perDealMaxMinor: 0,
  autoReleaseAfterHours: null,
  cooldownMinutes: 0,
  alwaysAsk: [],
};

export async function processActions(deps: Deps, limit = 20): Promise<number> {
  const seen: string[] = [];
  while (seen.length < limit) {
    const claim: { id: string | null } = { id: null };
    try {
      await deps.db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(pa)
          .where(
            and(
              or(eq(pa.status, "pending"), and(eq(pa.status, "approved"), inArray(pa.type, H_TYPES))),
              seen.length > 0 ? notInArray(pa.id, seen) : undefined,
            ),
          )
          .orderBy(pa.createdAt)
          .limit(1)
          .for("update", { skipLocked: true });
        if (!row) return;
        claim.id = row.id;
        await handleAction(tx, deps, row);
      });
    } catch (err) {
      if (!(err instanceof StaleMilestoneError)) throw err;
    }
    if (!claim.id) break;
    seen.push(claim.id);
  }
  return seen.length;
}

async function handleAction(tx: Tx, deps: Deps, row: ProposedActionRow): Promise<void> {
  const now = deps.now();
  if (row.status === "pending") {
    const d = await decide(tx, deps, row);
    if (d.decision === "reject") {
      await tx.update(pa).set({ status: "rejected", decisionReason: d.reason, decidedAt: now }).where(eq(pa.id, row.id));
      return;
    }
    if (d.decision === "needs_approval") {
      await tx.update(pa).set({ status: "needs_approval", decisionReason: d.reason, decidedAt: now }).where(eq(pa.id, row.id));
      const [approval] = await tx
        .insert(schema.approval)
        .values({ proposedActionId: row.id, side: d.side })
        .returning({ id: schema.approval.id });
      await appendEvent(tx, {
        type: "approval.requested",
        dealId: row.dealId,
        milestoneId: milestoneIdOf(row),
        payload: { approvalId: approval!.id, proposedActionId: row.id, type: row.type, side: d.side, reason: d.reason },
      });
      return;
    }
    await tx.update(pa).set({ status: "approved", decisionReason: d.reason, decidedAt: now }).where(eq(pa.id, row.id));
    if (!H_TYPES.includes(row.type)) return;
  }
  await execute(tx, deps, row);
}

function approverSide(row: ProposedActionRow): "agency" | "client" {
  if (row.type === "release") return "client";
  return row.side === "client" ? "client" : "agency";
}

function milestoneIdOf(row: { payload: ProposedActionRow["payload"] }): string | null {
  return "milestoneId" in row.payload ? (row.payload.milestoneId ?? null) : null;
}

async function decide(tx: Tx, deps: Deps, row: ProposedActionRow): Promise<PolicyDecision & { side: "agency" | "client" }> {
  const side = approverSide(row);
  const parsed = ProposedActionInput.safeParse({
    dealId: row.dealId,
    agent: row.agent,
    side: row.side,
    reasoning: row.reasoning,
    evidenceIds: row.evidenceIds,
    idempotencyKey: row.idempotencyKey,
    payload: row.payload,
  });
  if (!parsed.success) return { decision: "reject", reason: `invalid proposal: ${parsed.error.issues[0]?.message}`, side };
  const action = parsed.data;

  const [deal] = await tx.select().from(schema.deal).where(eq(schema.deal.id, row.dealId));
  if (!deal) return { decision: "reject", reason: "deal not found", side };
  const configured = side === "client" ? deal.clientPolicy : deal.agencyPolicy;
  if (!configured && action.agent !== "human") return { decision: "needs_approval", reason: `no ${side} policy configured`, side };

  const milestoneId = milestoneIdOf(row);
  const [m] = milestoneId
    ? await tx
        .select({ heldMinor: schema.milestone.heldMinor, releasedMinor: schema.milestone.releasedMinor })
        .from(schema.milestone)
        .where(eq(schema.milestone.id, milestoneId))
    : [];
  const [dealTotals] = await tx
    .select({ released: sql<number>`coalesce(sum(${schema.milestone.releasedMinor}), 0)`.mapWith(Number) })
    .from(schema.milestone)
    .where(eq(schema.milestone.dealId, row.dealId));
  const [last] = await tx
    .select({ at: max(pa.executedAt) })
    .from(pa)
    .where(and(eq(pa.dealId, row.dealId), eq(pa.type, row.type), eq(pa.status, "executed")));

  const d = evaluatePolicy({
    action,
    policy: configured ?? NO_POLICY,
    context: {
      now: deps.now().toISOString(),
      heldForMilestoneMinor: m?.heldMinor ?? 0,
      releasedForMilestoneMinor: m?.releasedMinor ?? 0,
      releasedForDealMinor: dealTotals?.released ?? 0,
      lastExecutedAt: last?.at?.toISOString() ?? null,
    },
  });

  if (d.decision === "approve" && action.payload.type === "mark_verified") {
    const gate = await gateFor(tx, action.payload.milestoneId);
    if (!gate.passed) return { decision: "reject", reason: `verification gate failed for checks ${gate.failing.join(", ")}`, side };
  }
  return { ...d, side };
}

async function gateFor(tx: Tx, milestoneId: string) {
  const [m] = await tx.select().from(schema.milestone).where(eq(schema.milestone.id, milestoneId));
  if (!m) return { passed: false, failing: [] };
  const rows = await tx.select().from(schema.evidence).where(eq(schema.evidence.milestoneId, milestoneId));
  return verificationGate(
    m.criteria,
    rows.map((r) => ({ checkIndex: r.checkIndex, passed: r.passed, createdAt: r.createdAt.toISOString() })),
  );
}

async function execute(tx: Tx, deps: Deps, row: ProposedActionRow): Promise<void> {
  const now = deps.now();
  const ref = { dealId: row.dealId, milestoneId: milestoneIdOf(row) };
  try {
    await tx.transaction((sp) => runExecutor(sp, deps, row));
    await tx.update(pa).set({ status: "executed", executedAt: now }).where(eq(pa.id, row.id));
    await appendEvent(tx, { type: "action.executed", ...ref, payload: { proposedActionId: row.id, type: row.type } });
  } catch (err) {
    if (err instanceof StaleMilestoneError) throw err;
    await tx.update(pa).set({ status: "failed", decisionReason: errorMessage(err) }).where(eq(pa.id, row.id));
    await appendEvent(tx, {
      type: "action.failed",
      ...ref,
      payload: { proposedActionId: row.id, type: row.type, error: errorMessage(err) },
    });
  }
}

export async function runExecutor(tx: Tx, deps: Deps, row: ProposedActionRow): Promise<void> {
  const now = deps.now();
  const p = row.payload;
  const payload = { proposedActionId: row.id };
  switch (p.type) {
    case "mark_verified":
      return mustAdvance(tx, p.milestoneId, { type: "verification_passed", at: now.toISOString() }, {
        now,
        payload: { ...payload, evidenceIds: p.evidenceIds },
      });
    case "request_changes":
      return mustAdvance(tx, p.milestoneId, { type: "verification_failed", missing: p.missing }, {
        now,
        payload: { ...payload, missing: p.missing, evidenceIds: p.evidenceIds },
      });
    case "release": {
      const [m] = await tx.select().from(schema.milestone).where(eq(schema.milestone.id, p.milestoneId));
      if (!m) throw new PermanentError(`milestone ${p.milestoneId} not found`);
      if (p.amount.minor !== m.heldMinor - m.releasedMinor) throw new PermanentError("partial releases are not supported");
      return mustAdvance(tx, p.milestoneId, { type: "release_approved", at: now.toISOString() }, { now, payload });
    }
    case "create_plan":
      await writePlan(tx, row.dealId, p.plan, now);
      await tx.update(schema.deal).set({ status: "sent", updatedAt: now }).where(eq(schema.deal.id, row.dealId));
      await appendEvent(tx, { type: "deal.plan_sent", dealId: row.dealId, milestoneId: null, payload });
      return;
    case "accept_plan":
      await writePlan(tx, row.dealId, p.plan, now);
      await agreeToPlanTx(tx, row.dealId, now);
      return;
    case "submit_dispute_evidence":
      return enqueueOutbox(
        tx,
        {
          kind: "dispute_evidence",
          request: { disputeId: p.disputeId, notes: p.notes, evidenceIds: p.evidenceIds },
          requestId: `dispute:${row.id}`,
          proposedActionId: row.id,
        },
        now,
      );
    default:
      throw new PermanentError(`no executor for ${p.type}`);
  }
}

export async function writePlan(tx: Tx, dealId: string, plan: PlanDraft, now: Date): Promise<void> {
  const [deal] = await tx.select().from(schema.deal).where(eq(schema.deal.id, dealId));
  if (!deal) throw new PermanentError(`deal ${dealId} not found`);
  if (deal.currency !== plan.currency) throw new PermanentError(`plan currency ${plan.currency} differs from deal ${deal.currency}`);
  const existing = await tx.select({ state: schema.milestone.state }).from(schema.milestone).where(eq(schema.milestone.dealId, dealId));
  if (existing.some((m) => m.state !== "draft")) throw new PermanentError("a plan can only change before it is agreed");
  await tx.delete(schema.milestone).where(eq(schema.milestone.dealId, dealId));

  const schedule = schedulePlan(plan.tasks, now.toISOString().slice(0, 10));
  const windows = milestoneWindows(plan.tasks, schedule);
  const ms = await tx
    .insert(schema.milestone)
    .values(
      plan.milestones.map((m, i) => ({
        dealId,
        key: m.key,
        position: i,
        title: m.title,
        priceMinor: m.price.minor,
        criteria: m.criteria,
        payees: m.payees,
        startDate: windows.get(m.key)?.start ?? null,
        endDate: windows.get(m.key)?.end ?? null,
      })),
    )
    .returning();
  const msId = new Map(ms.map((m) => [m.key, m.id]));
  const ts = await tx
    .insert(schema.task)
    .values(
      plan.tasks.map((t, i) => ({
        dealId,
        milestoneId: msId.get(t.milestoneKey)!,
        key: t.key,
        title: t.title,
        durationDays: t.durationDays,
        startDate: schedule.get(t.key)!.start,
        position: i,
      })),
    )
    .returning();
  const taskId = new Map(ts.map((t) => [t.key, t.id]));
  const deps = plan.tasks.flatMap((t) => t.dependsOn.map((d) => ({ fromTaskId: taskId.get(d)!, toTaskId: taskId.get(t.key)! })));
  if (deps.length > 0) await tx.insert(schema.taskDependency).values(deps);
}

async function agreeToPlanTx(tx: Tx, dealId: string, now: Date): Promise<void> {
  const [deal] = await tx.select().from(schema.deal).where(eq(schema.deal.id, dealId));
  if (!deal) throw new PermanentError(`deal ${dealId} not found`);
  if (deal.status !== "sent" && deal.status !== "negotiating") {
    throw new PermanentError(`deal is ${deal.status}, a plan can only be agreed when it is sent or negotiating`);
  }
  const ms = await tx.select().from(schema.milestone).where(eq(schema.milestone.dealId, dealId)).orderBy(schema.milestone.position);
  for (const m of ms) await mustAdvance(tx, m.id, { type: "plan_agreed" }, { now });
  await tx.update(schema.deal).set({ status: "agreed", updatedAt: now }).where(eq(schema.deal.id, dealId));
  await appendEvent(tx, { type: "deal.agreed", dealId, milestoneId: null, payload: {} });
}

export async function agreeToPlan(db: Db, dealId: string, now = new Date()): Promise<void> {
  await db.transaction((tx) => agreeToPlanTx(tx, dealId, now));
}

export async function decideApproval(
  db: Db,
  input: { approvalId: string; decision: "approved" | "rejected"; decidedBy: string },
  now = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const [a] = await tx.select().from(schema.approval).where(eq(schema.approval.id, input.approvalId)).for("update");
    if (!a) throw new Error(`approval ${input.approvalId} not found`);
    if (a.decision) return;
    await tx
      .update(schema.approval)
      .set({ decision: input.decision, decidedBy: input.decidedBy, decidedAt: now })
      .where(eq(schema.approval.id, a.id));
    const [action] = await tx
      .update(pa)
      .set({ status: input.decision, decidedAt: now, decisionReason: `${input.decision} by ${input.decidedBy}` })
      .where(and(eq(pa.id, a.proposedActionId), eq(pa.status, "needs_approval")))
      .returning();
    if (!action) return;
    await appendEvent(tx, {
      type: "approval.decided",
      dealId: action.dealId,
      milestoneId: milestoneIdOf(action),
      payload: { approvalId: a.id, proposedActionId: action.id, decision: input.decision },
    });
  });
}

export async function submitHumanAction(db: Db, input: ProposedActionInput): Promise<{ id: string; created: boolean }> {
  const a = ProposedActionInput.parse(input);
  if (a.agent !== "human") throw new Error("submitHumanAction only accepts agent human");
  const rows = await db
    .insert(pa)
    .values({
      dealId: a.dealId,
      agent: a.agent,
      side: a.side,
      type: a.payload.type,
      payload: a.payload,
      reasoning: a.reasoning,
      evidenceIds: a.evidenceIds,
      idempotencyKey: a.idempotencyKey,
    })
    .onConflictDoNothing({ target: pa.idempotencyKey })
    .returning({ id: pa.id });
  if (rows[0]) return { id: rows[0].id, created: true };
  const [existing] = await db.select({ id: pa.id }).from(pa).where(eq(pa.idempotencyKey, a.idempotencyKey));
  return { id: existing!.id, created: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL=postgres://tranche:tranche@localhost:5432/tranche pnpm --filter @tranche/agents-service exec vitest run src/money/actions.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/money/actions.ts apps/agents/src/money/actions.test.ts
git commit -m "feat(money): Judge and execute proposed actions with approvals"
```

---

### Task 6: Outbox executor

**Files:**
- Modify: `apps/agents/src/money/outbox.ts`
- Create: `apps/agents/src/money/outbox-handlers.ts`
- Test: `apps/agents/src/money/outbox.test.ts`

**Interfaces:**
- Consumes: Task 2 helpers; `PayPalError` from `@tranche/paypal`.
- Produces:
  - `executeOutbox(deps: Deps, limit?: number): Promise<number>`: claims `pending` or lease-expired `sent` rows with `next_attempt_at <= now`, sets a 5 minute lease, calls PayPal outside the transaction, settles in a second transaction.
  - Retry: `PermanentError`, or `PayPalError` with `retryable: false`, or the 8th attempt -> `failed`, linked proposed action `failed`, `alert.raised` with `kind: "outbox_failed"`; anything else -> back to `pending` after `backoffMs(attempt)` = 1, 2, 4 ... minutes capped at 60.
  - `type OutboxRow`, `type OutboxHandler = { call(deps, row): Promise<Record<string, unknown>>; settle(tx, deps, row, response): Promise<void> }`
  - `outboxHandlers: Partial<Record<OutboxKind, OutboxHandler>>` in `outbox-handlers.ts` with `place_hold`, `release`, `void_hold`, `payout`, `dispute_evidence` (H4 adds `fund` and `renew_hold`).
  - PayPal calls used: `placeHold`, `releaseHold`, `voidHold`, `sendPayouts`, `submitDisputeEvidence({ requestId, disputeId, notes, evidence: Array<{ kind: string; summary: string; data: Record<string, unknown> }> })`.

- [ ] **Step 1: Write the failing test**

`apps/agents/src/money/outbox.test.ts`:

```ts
import { schema } from "@tranche/db";
import { createTestDb, truncateAll } from "@tranche/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PermanentError } from "./errors";
import { executeOutbox } from "./outbox";
import { fakePayPal, makeHold, makeMilestone, NOW, testDeps } from "./test-helpers";

const db = process.env.DATABASE_URL ? await createTestDb("agents") : null;

async function releaseReady() {
  const ids = await makeMilestone(db!, { state: "release_pending", heldMinor: 100000, verifiedAt: NOW, releaseAuthorizedAt: NOW });
  const hold = await makeHold(db!, ids.milestoneId, { status: "active", authorizationId: "AUTH-1" });
  await db!.insert(schema.outbox).values({
    kind: "release",
    request: { holdId: hold.id, amountMinor: 100000 },
    requestId: `release:${hold.id}`,
    nextAttemptAt: NOW,
  });
  return { ...ids, hold };
}
const milestoneOf = async (id: string) =>
  (await db!.select().from(schema.milestone).where(eq(schema.milestone.id, id)))[0]!;

describe.runIf(Boolean(db))("executeOutbox", () => {
  beforeEach(async () => {
    await truncateAll(db!);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await db!.$client.end();
  });

  it("releases, settles the milestone and queues the payout", async () => {
    const { milestoneId, hold } = await releaseReady();
    const paypal = fakePayPal();
    await executeOutbox(testDeps(db!, paypal));
    expect(paypal.releaseHold).toHaveBeenCalledWith(expect.objectContaining({ requestId: `release:${hold.id}`, authorizationId: "AUTH-1" }));
    expect(await milestoneOf(milestoneId)).toMatchObject({ state: "released", releasedMinor: 100000 });
    const rows = await db!.select().from(schema.outbox);
    expect(rows.map((r) => [r.kind, r.status]).sort()).toEqual([
      ["payout", "pending"],
      ["release", "succeeded"],
    ]);
  });

  it("retries with the same request id and settles once", async () => {
    const { milestoneId, hold } = await releaseReady();
    const releaseHold = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce({ releaseRef: "CAPTURE-REL-1" });
    const paypal = fakePayPal({ releaseHold });
    await executeOutbox(testDeps(db!, paypal));
    const [failed] = await db!.select().from(schema.outbox).where(eq(schema.outbox.kind, "release"));
    expect(failed).toMatchObject({ status: "pending", attempts: 1, lastError: "socket hang up" });
    expect(failed!.nextAttemptAt.toISOString()).toBe("2026-10-10T10:01:00.000Z");

    await executeOutbox(testDeps(db!, paypal, () => new Date("2026-10-10T10:02:00Z")));
    expect(releaseHold).toHaveBeenCalledTimes(2);
    expect(releaseHold.mock.calls.map((c) => c[0].requestId)).toEqual([`release:${hold.id}`, `release:${hold.id}`]);
    expect(await milestoneOf(milestoneId)).toMatchObject({ state: "released", releasedMinor: 100000 });
  });

  it("fails permanently and raises an alert", async () => {
    await releaseReady();
    const paypal = fakePayPal({ releaseHold: vi.fn().mockRejectedValue(new PermanentError("AUTHORIZATION_VOIDED")) });
    await executeOutbox(testDeps(db!, paypal));
    const [row] = await db!.select().from(schema.outbox);
    expect(row).toMatchObject({ status: "failed", lastError: "AUTHORIZATION_VOIDED" });
    expect(await db!.select().from(schema.event).where(eq(schema.event.type, "alert.raised"))).toHaveLength(1);
  });

  it("gives up after eight attempts", async () => {
    await releaseReady();
    await db!.update(schema.outbox).set({ attempts: 7 });
    await executeOutbox(testDeps(db!, fakePayPal({ releaseHold: vi.fn().mockRejectedValue(new Error("timeout")) })));
    const [row] = await db!.select().from(schema.outbox);
    expect(row).toMatchObject({ status: "failed", attempts: 8 });
  });

  it("re-claims a row whose lease expired after a crash", async () => {
    await releaseReady();
    await db!.update(schema.outbox).set({ status: "sent", attempts: 1, nextAttemptAt: new Date("2026-10-10T09:00:00Z") });
    const paypal = fakePayPal();
    await executeOutbox(testDeps(db!, paypal));
    expect(paypal.releaseHold).toHaveBeenCalledTimes(1);
  });

  it("confirms payout directly when only the agency is paid", async () => {
    const { milestoneId } = await makeMilestone(db!, {
      state: "released",
      heldMinor: 100000,
      releasedMinor: 100000,
      verifiedAt: NOW,
      releaseAuthorizedAt: NOW,
    });
    await makeHold(db!, milestoneId, { status: "released" });
    await db!.insert(schema.outbox).values({ kind: "payout", request: { milestoneId }, requestId: `payout:${milestoneId}`, nextAttemptAt: NOW });
    const paypal = fakePayPal();
    await executeOutbox(testDeps(db!, paypal));
    expect(paypal.sendPayouts).not.toHaveBeenCalled();
    expect((await milestoneOf(milestoneId)).state).toBe("paid_out");
  });

  it("pays subcontractors through Payouts when configured", async () => {
    vi.stubEnv("SUBCONTRACTOR_SPLIT", "payouts");
    const { milestoneId } = await makeMilestone(db!, {
      state: "released",
      heldMinor: 100000,
      releasedMinor: 100000,
      verifiedAt: NOW,
      releaseAuthorizedAt: NOW,
      payees: [
        { kind: "agency", shareBps: 8000 },
        { kind: "subcontractor", name: "Dev", email: "dev@x.test", shareBps: 2000 },
      ],
    });
    await makeHold(db!, milestoneId, { status: "released" });
    await db!.insert(schema.outbox).values({ kind: "payout", request: { milestoneId }, requestId: `payout:${milestoneId}`, nextAttemptAt: NOW });
    const paypal = fakePayPal();
    await executeOutbox(testDeps(db!, paypal));
    expect(paypal.sendPayouts).toHaveBeenCalledWith({
      requestId: `payout:${milestoneId}`,
      items: [{ email: "dev@x.test", amount: { currency: "USD", minor: 20000 }, note: "Tranche milestone: Build" }],
    });
    const [p] = await db!.select().from(schema.payout);
    expect(p).toMatchObject({ status: "sent", paypalRef: "BATCH-1", amountMinor: 20000 });
    expect((await milestoneOf(milestoneId)).state).toBe("released");
  });

  it("places a hold after approval and confirms it", async () => {
    const { milestoneId } = await makeMilestone(db!, { state: "funding" });
    const hold = await makeHold(db!, milestoneId);
    await db!.insert(schema.outbox).values({ kind: "place_hold", request: { holdId: hold.id }, requestId: `place:${hold.id}`, nextAttemptAt: NOW });
    await executeOutbox(testDeps(db!));
    expect((await milestoneOf(milestoneId)).state).toBe("held");
    const [h] = await db!.select().from(schema.hold);
    expect(h).toMatchObject({ status: "active", paypalAuthorizationId: "AUTH-1" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=postgres://tranche:tranche@localhost:5432/tranche pnpm --filter @tranche/agents-service exec vitest run src/money/outbox.test.ts`
Expected: FAIL with "executeOutbox is not exported" (or a type error on the import).

- [ ] **Step 3: Implement the handlers**

`apps/agents/src/money/outbox-handlers.ts`:

```ts
import type { Payee } from "@tranche/contracts";
import { schema } from "@tranche/db";
import { desc, eq, inArray } from "drizzle-orm";
import type { Tx } from "./db";
import type { Deps } from "./deps";
import { activateHold, confirmRelease, getHold } from "./holds";
import { advanceMilestone } from "./milestones";
import type { OutboxKind } from "./outbox";

export type OutboxRow = typeof schema.outbox.$inferSelect;
export type OutboxHandler = {
  call: (deps: Deps, row: OutboxRow) => Promise<Record<string, unknown>>;
  settle: (tx: Tx, deps: Deps, row: OutboxRow, response: Record<string, unknown>) => Promise<void>;
};

type Sub = Extract<Payee, { kind: "subcontractor" }>;
const splitMode = () => process.env.SUBCONTRACTOR_SPLIT ?? "agency_pays";

const placeHold: OutboxHandler = {
  async call(deps, row) {
    const hold = await getHold(deps.db, String(row.request.holdId));
    if (hold.status !== "pending") return { skipped: true };
    return deps.paypal.placeHold({ requestId: row.requestId, orderId: hold.paypalOrderId, mechanism: hold.mechanism });
  },
  async settle(tx, deps, row, res) {
    if (res.skipped) return;
    const r = res as { captureId: string | null; authorizationId: string | null; expiresAt: string };
    const hold = await getHold(tx, String(row.request.holdId));
    await activateHold(
      tx,
      hold,
      {
        captureId: r.captureId,
        authorizationId: r.authorizationId,
        anchorAt: deps.now(),
        expiresAt: new Date(r.expiresAt),
        amountMinor: hold.amountMinor,
      },
      deps.now(),
    );
  },
};

const release: OutboxHandler = {
  async call(deps, row) {
    const hold = await getHold(deps.db, String(row.request.holdId));
    if (hold.status === "released") return { releaseRef: hold.paypalCaptureId };
    return deps.paypal.releaseHold({
      requestId: row.requestId,
      mechanism: hold.mechanism,
      captureId: hold.paypalCaptureId,
      authorizationId: hold.paypalAuthorizationId,
      amount: { currency: hold.currency, minor: Number(row.request.amountMinor) },
    });
  },
  async settle(tx, deps, row, res) {
    const hold = await getHold(tx, String(row.request.holdId));
    const captureId = hold.mechanism === "authorization" && res.releaseRef ? String(res.releaseRef) : null;
    await confirmRelease(tx, hold, { captureId, amountMinor: Number(row.request.amountMinor) }, deps.now());
  },
};

const voidHold: OutboxHandler = {
  async call(deps, row) {
    const hold = await getHold(deps.db, String(row.request.holdId));
    if (hold.status !== "active") return { skipped: true };
    await deps.paypal.voidHold({
      requestId: row.requestId,
      mechanism: hold.mechanism,
      authorizationId: hold.paypalAuthorizationId,
      captureId: hold.paypalCaptureId,
    });
    return { voided: true };
  },
  async settle(tx, _deps, row, res) {
    if (res.skipped) return;
    await tx.update(schema.hold).set({ status: "voided" }).where(eq(schema.hold.id, String(row.request.holdId)));
  },
};

const payout: OutboxHandler = {
  async call(deps, row) {
    const milestoneId = String(row.request.milestoneId);
    const [m] = await deps.db.select().from(schema.milestone).where(eq(schema.milestone.id, milestoneId));
    const [d] = m ? await deps.db.select().from(schema.deal).where(eq(schema.deal.id, m.dealId)) : [];
    const subs = (m?.payees ?? []).filter((p): p is Sub => p.kind === "subcontractor");
    if (!m || !d || subs.length === 0 || splitMode() !== "payouts") return { batchId: null };
    return deps.paypal.sendPayouts({
      requestId: row.requestId,
      items: subs.map((p) => ({
        email: p.email,
        amount: { currency: d.currency, minor: Math.floor((m.releasedMinor * p.shareBps) / 10000) },
        note: `Tranche milestone: ${m.title}`,
      })),
    });
  },
  async settle(tx, deps, row, res) {
    const milestoneId = String(row.request.milestoneId);
    if (res.batchId === null) {
      await advanceMilestone(tx, milestoneId, { type: "payout_confirmed" }, { now: deps.now() });
      return;
    }
    const [m] = await tx.select().from(schema.milestone).where(eq(schema.milestone.id, milestoneId));
    const [d] = await tx.select().from(schema.deal).where(eq(schema.deal.id, m!.dealId));
    const [hold] = await tx
      .select()
      .from(schema.hold)
      .where(eq(schema.hold.milestoneId, milestoneId))
      .orderBy(desc(schema.hold.createdAt))
      .limit(1);
    const subs = m!.payees.filter((p): p is Sub => p.kind === "subcontractor");
    await tx.insert(schema.payout).values(
      subs.map((p) => ({
        milestoneId,
        holdId: hold!.id,
        payee: p,
        amountMinor: Math.floor((m!.releasedMinor * p.shareBps) / 10000),
        currency: d!.currency,
        paypalRef: String(res.batchId),
        status: "sent" as const,
      })),
    );
  },
};

const disputeEvidence: OutboxHandler = {
  async call(deps, row) {
    const r = row.request as { disputeId: string; notes: string; evidenceIds: string[] };
    const evidence = await deps.db.select().from(schema.evidence).where(inArray(schema.evidence.id, r.evidenceIds));
    await deps.paypal.submitDisputeEvidence({
      requestId: row.requestId,
      disputeId: r.disputeId,
      notes: r.notes,
      evidence: evidence.map((e) => ({ kind: e.kind, summary: e.summary, data: e.data })),
    });
    return { submitted: true };
  },
  async settle() {},
};

export const outboxHandlers: Partial<Record<OutboxKind, OutboxHandler>> = {
  place_hold: placeHold,
  release,
  void_hold: voidHold,
  payout,
  dispute_evidence: disputeEvidence,
};
```

- [ ] **Step 4: Implement the executor**

Append to `apps/agents/src/money/outbox.ts` (and merge its imports at the top of the file):

```ts
import { PayPalError } from "@tranche/paypal";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import type { Deps } from "./deps";
import { errorMessage, PermanentError } from "./errors";
import { appendEvent } from "./events";
import { type OutboxRow, outboxHandlers } from "./outbox-handlers";

const LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 8;

export function backoffMs(attempt: number): number {
  return Math.min(60_000 * 2 ** (attempt - 1), 3_600_000);
}

export async function executeOutbox(deps: Deps, limit = 10): Promise<number> {
  const now = deps.now();
  const claimed = await deps.db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.outbox)
      .where(and(inArray(schema.outbox.status, ["pending", "sent"]), lte(schema.outbox.nextAttemptAt, now)))
      .orderBy(asc(schema.outbox.createdAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    for (const r of rows) {
      await tx
        .update(schema.outbox)
        .set({ status: "sent", attempts: r.attempts + 1, nextAttemptAt: new Date(now.getTime() + LEASE_MS) })
        .where(eq(schema.outbox.id, r.id));
    }
    return rows.map((r) => ({ ...r, attempts: r.attempts + 1 }));
  });
  for (const row of claimed) await runOne(deps, row);
  return claimed.length;
}

async function runOne(deps: Deps, row: OutboxRow): Promise<void> {
  try {
    const handler = outboxHandlers[row.kind as OutboxKind];
    if (!handler) throw new PermanentError(`no outbox handler for ${row.kind}`);
    const response = await handler.call(deps, row);
    await deps.db.transaction(async (tx) => {
      await handler.settle(tx, deps, row, response);
      await tx
        .update(schema.outbox)
        .set({ status: "succeeded", response, completedAt: deps.now(), lastError: null })
        .where(eq(schema.outbox.id, row.id));
    });
  } catch (err) {
    await recordFailure(deps, row, err);
  }
}

async function recordFailure(deps: Deps, row: OutboxRow, err: unknown): Promise<void> {
  const now = deps.now();
  const permanent = err instanceof PermanentError || (err instanceof PayPalError && !err.retryable);
  await deps.db.transaction(async (tx) => {
    if (!permanent && row.attempts < MAX_ATTEMPTS) {
      await tx
        .update(schema.outbox)
        .set({ status: "pending", lastError: errorMessage(err), nextAttemptAt: new Date(now.getTime() + backoffMs(row.attempts)) })
        .where(eq(schema.outbox.id, row.id));
      return;
    }
    await tx
      .update(schema.outbox)
      .set({ status: "failed", lastError: errorMessage(err), completedAt: now })
      .where(eq(schema.outbox.id, row.id));
    let dealId: string | null = null;
    if (row.proposedActionId) {
      const [a] = await tx
        .update(schema.proposedAction)
        .set({ status: "failed", decisionReason: errorMessage(err) })
        .where(eq(schema.proposedAction.id, row.proposedActionId))
        .returning({ dealId: schema.proposedAction.dealId });
      dealId = a?.dealId ?? null;
    }
    await appendEvent(tx, {
      type: "alert.raised",
      dealId,
      milestoneId: null,
      payload: { kind: "outbox_failed", outboxId: row.id, outboxKind: row.kind, error: errorMessage(err) },
    });
  });
}
```

A settle that throws `StaleMilestoneError` is retried like a network error; the PayPal call is repeated with the same request id, so PayPal returns the original result.

- [ ] **Step 5: Run test to verify it passes**

Run: `DATABASE_URL=postgres://tranche:tranche@localhost:5432/tranche pnpm --filter @tranche/agents-service exec vitest run src/money/outbox.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/agents/src/money/outbox.ts apps/agents/src/money/outbox-handlers.ts apps/agents/src/money/outbox.test.ts
git commit -m "feat(money): Execute PayPal calls from the outbox with leases and retries"
```

---

### Task 7: PayPal webhook route

**Files:**
- Modify: `apps/web/package.json`, `apps/web/next.config.ts`
- Create: `apps/web/vitest.config.ts`, `apps/web/src/lib/server.ts`, `apps/web/src/lib/kick.ts`, `apps/web/src/app/api/webhooks/paypal/route.ts`
- Test: `apps/web/src/app/api/webhooks/paypal/route.test.ts`

**Interfaces:**
- Consumes: `createDb`, `schema`; `createPayPalClient` (`verifyWebhook`); `@renderinc/sdk`.
- Produces:
  - `POST /api/webhooks/paypal`: 400 on bad signature or malformed body, 500 when `PAYPAL_WEBHOOK_ID` is missing, otherwise inserts `inbox(source: "paypal", sourceEventId: body.id)` with `ON CONFLICT DO NOTHING` and returns 200 immediately.
  - `apps/web/src/lib/server.ts`: `getDb(): Db`, `getPayPal(): PayPal` (lazy singletons for every server route).
  - `apps/web/src/lib/kick.ts`: `kickMoneyTick(): void` starts the `moneyTick` Workflows task when `RENDER_API_KEY` and `RENDER_WORKFLOW_SLUG` are set; failures are logged, never thrown.

- [ ] **Step 1: Add dependencies and test config**

```bash
pnpm --filter @tranche/web add @tranche/db@workspace:* @tranche/paypal@workspace:* @renderinc/sdk@1.2.0 zod@4.6.5
```

In `apps/web/next.config.ts` set `transpilePackages: ["@tranche/contracts", "@tranche/db", "@tranche/paypal"],`.

`apps/web/vitest.config.ts`:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { fileParallelism: false },
});
```

- [ ] **Step 2: Write the failing test**

`apps/web/src/app/api/webhooks/paypal/route.test.ts`:

```ts
import { type Db, schema } from "@tranche/db";
import { createTestDb, truncateAll } from "@tranche/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: null as Db | null,
  verifyWebhook: vi.fn(async () => true),
  kick: vi.fn(),
}));
vi.mock("@/lib/server", () => ({ getDb: () => mocks.db, getPayPal: () => ({ verifyWebhook: mocks.verifyWebhook }) }));
vi.mock("@/lib/kick", () => ({ kickMoneyTick: mocks.kick }));

import { POST } from "./route";

mocks.db = process.env.DATABASE_URL ? await createTestDb("web") : null;

const body = JSON.stringify({ id: "WH-1", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: "ORDER-1" } });
const request = (raw: string) =>
  new Request("http://localhost/api/webhooks/paypal", {
    method: "POST",
    headers: { "content-type": "application/json", "paypal-transmission-id": "T-1" },
    body: raw,
  });

describe.runIf(Boolean(mocks.db))("POST /api/webhooks/paypal", () => {
  beforeAll(() => {
    process.env.PAYPAL_WEBHOOK_ID = "WH-ID-TEST";
  });
  beforeEach(async () => {
    await truncateAll(mocks.db!);
    mocks.verifyWebhook.mockResolvedValue(true);
  });
  afterAll(async () => {
    await mocks.db!.$client.end();
  });

  it("rejects an invalid signature", async () => {
    mocks.verifyWebhook.mockResolvedValue(false);
    expect((await POST(request(body))).status).toBe(400);
    expect(await mocks.db!.select().from(schema.inbox)).toHaveLength(0);
  });

  it("stores a verified event and passes the raw body to verification", async () => {
    expect((await POST(request(body))).status).toBe(200);
    expect(mocks.verifyWebhook).toHaveBeenCalledWith({
      headers: expect.objectContaining({ "paypal-transmission-id": "T-1" }),
      rawBody: body,
      webhookId: "WH-ID-TEST",
    });
    const [row] = await mocks.db!.select().from(schema.inbox);
    expect(row).toMatchObject({
      source: "paypal",
      sourceEventId: "WH-1",
      message: { type: "paypal.webhook", eventType: "CHECKOUT.ORDER.APPROVED", resource: { id: "ORDER-1" } },
    });
    expect(mocks.kick).toHaveBeenCalled();
  });

  it("accepts a redelivery without storing it twice", async () => {
    await POST(request(body));
    expect((await POST(request(body))).status).toBe(200);
    expect(await mocks.db!.select().from(schema.inbox)).toHaveLength(1);
  });

  it("rejects a malformed body", async () => {
    expect((await POST(request("{not json"))).status).toBe(400);
    expect((await POST(request(JSON.stringify({ id: 5 })))).status).toBe(400);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `DATABASE_URL=postgres://tranche:tranche@localhost:5432/tranche pnpm --filter @tranche/web exec vitest run src/app/api/webhooks/paypal/route.test.ts`
Expected: FAIL with "Failed to resolve import ./route".

- [ ] **Step 4: Implement**

`apps/web/src/lib/server.ts`:

```ts
import { createDb, type Db } from "@tranche/db";
import { createPayPalClient } from "@tranche/paypal";

type PayPal = ReturnType<typeof createPayPalClient>;

let db: Db | undefined;
let paypal: PayPal | undefined;

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export function getDb(): Db {
  db ??= createDb();
  return db;
}

export function getPayPal(): PayPal {
  paypal ??= createPayPalClient({
    clientId: required("PAYPAL_CLIENT_ID"),
    clientSecret: required("PAYPAL_CLIENT_SECRET"),
    baseUrl: process.env.PAYPAL_BASE_URL ?? "https://api-m.sandbox.paypal.com",
  });
  return paypal;
}
```

`apps/web/src/lib/kick.ts`:

```ts
import { Render } from "@renderinc/sdk";

let render: Render | undefined;

export function kickMoneyTick(): void {
  const slug = process.env.RENDER_WORKFLOW_SLUG;
  if (!slug || !process.env.RENDER_API_KEY) return;
  render ??= new Render();
  render.workflows.startTask(`${slug}/moneyTick`, []).catch((err: unknown) => {
    console.error("kickMoneyTick failed", err);
  });
}
```

`apps/web/src/app/api/webhooks/paypal/route.ts`:

```ts
import { schema } from "@tranche/db";
import { z } from "zod";
import { kickMoneyTick } from "@/lib/kick";
import { getDb, getPayPal } from "@/lib/server";

const Envelope = z.object({
  id: z.string().min(1),
  event_type: z.string().min(1),
  resource: z.record(z.string(), z.unknown()),
});

export async function POST(request: Request): Promise<Response> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return new Response("webhook not configured", { status: 500 });

  const rawBody = await request.text();
  const headers = Object.fromEntries(request.headers);
  if (!(await getPayPal().verifyWebhook({ headers, rawBody, webhookId }))) {
    return new Response("invalid signature", { status: 400 });
  }

  let parsed: z.infer<typeof Envelope>;
  try {
    parsed = Envelope.parse(JSON.parse(rawBody));
  } catch {
    return new Response("malformed event", { status: 400 });
  }

  await getDb()
    .insert(schema.inbox)
    .values({
      source: "paypal",
      sourceEventId: parsed.id,
      message: { type: "paypal.webhook", eventType: parsed.event_type, resource: parsed.resource },
    })
    .onConflictDoNothing();
  kickMoneyTick();
  return new Response(null, { status: 200 });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `DATABASE_URL=postgres://tranche:tranche@localhost:5432/tranche pnpm --filter @tranche/web exec vitest run src/app/api/webhooks/paypal/route.test.ts && pnpm --filter @tranche/web build`
Expected: PASS, 4 tests; the build lists `ƒ /api/webhooks/paypal`.

- [ ] **Step 6: Register the webhook in the sandbox (manual)**

1. Start a tunnel: `cloudflared tunnel --url http://localhost:3000` and copy the `https://*.trycloudflare.com` URL.
2. Developer Dashboard -> your sandbox app -> **Webhooks** -> **Add Webhook** -> URL `<tunnel>/api/webhooks/paypal`, events: `Checkout order approved`, `Payment authorization created`, `Payment authorization voided`, `Payment capture completed`, `Payment referenced payout item completed`, `Payment payouts batch success`, `Customer dispute created`, `Customer dispute resolved`.
3. Copy the webhook id into `.env` as `PAYPAL_WEBHOOK_ID`.
4. Use **Webhooks simulator** with `Payment capture completed`; expect one new `inbox` row (`pnpm --filter @tranche/db db:studio`).

- [ ] **Step 7: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): Receive verified PayPal webhooks into the inbox"
```

---

### Task 8: Reconciliation

**Files:**
- Create: `apps/agents/src/money/reconcile.ts`
- Test: `apps/agents/src/money/reconcile.test.ts`

**Interfaces:**
- Consumes: `getAuthorization(id)`, `getCapture(id)` returning at least `{ status: string }`.
- Produces: `reconcile(deps: Deps): Promise<{ checked: number; mismatches: number }>`. Expected PayPal statuses:

| Mechanism | Our hold status | PayPal object | Accepted statuses |
|---|---|---|---|
| authorization | active | authorization | `CREATED`, `PENDING` |
| authorization | released | capture (`paypalCaptureId`) | `COMPLETED`, `PENDING` |
| delayed_disbursement | active, released | capture (`paypalCaptureId`) | `COMPLETED` |

Anything else, including a lookup error, writes `alert.raised` with `{ kind: "reconciliation", holdId, ours, theirs }`.

- [ ] **Step 1: Write the failing test**

`apps/agents/src/money/reconcile.test.ts`:

```ts
import { schema } from "@tranche/db";
import { createTestDb, truncateAll } from "@tranche/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { reconcile } from "./reconcile";
import { fakePayPal, makeHold, makeMilestone, testDeps } from "./test-helpers";

const db = process.env.DATABASE_URL ? await createTestDb("agents") : null;

describe.runIf(Boolean(db))("reconcile", () => {
  beforeEach(async () => {
    await truncateAll(db!);
  });
  afterAll(async () => {
    await db!.$client.end();
  });

  it("finds nothing when PayPal agrees", async () => {
    const { milestoneId } = await makeMilestone(db!, { state: "in_progress", heldMinor: 100000 });
    await makeHold(db!, milestoneId, { status: "active", authorizationId: "AUTH-1" });
    expect(await reconcile(testDeps(db!))).toEqual({ checked: 1, mismatches: 0 });
  });

  it("alerts when PayPal voided a hold we think is active", async () => {
    const { milestoneId } = await makeMilestone(db!, { state: "in_progress", heldMinor: 100000 });
    const hold = await makeHold(db!, milestoneId, { status: "active", authorizationId: "AUTH-1" });
    const paypal = fakePayPal({ getAuthorization: vi.fn(async () => ({ status: "VOIDED" })) });
    expect(await reconcile(testDeps(db!, paypal))).toEqual({ checked: 1, mismatches: 1 });
    const [e] = await db!.select().from(schema.event).where(eq(schema.event.type, "alert.raised"));
    expect(e?.payload).toEqual({ kind: "reconciliation", holdId: hold.id, ours: "active", theirs: "VOIDED" });
  });

  it("alerts on a refunded release and on lookup errors", async () => {
    const a = await makeMilestone(db!, { state: "released", heldMinor: 100000, releasedMinor: 100000 });
    await makeHold(db!, a.milestoneId, { status: "released", captureId: "CAP-1" });
    const b = await makeMilestone(db!, { state: "in_progress", heldMinor: 100000 });
    await makeHold(db!, b.milestoneId, { status: "active", mechanism: "delayed_disbursement", captureId: "CAP-2" });
    const paypal = fakePayPal({
      getCapture: vi.fn(async (id: string) => {
        if (id === "CAP-1") return { status: "REFUNDED" };
        throw new Error("RESOURCE_NOT_FOUND");
      }),
    });
    expect(await reconcile(testDeps(db!, paypal))).toEqual({ checked: 2, mismatches: 2 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=postgres://tranche:tranche@localhost:5432/tranche pnpm --filter @tranche/agents-service exec vitest run src/money/reconcile.test.ts`
Expected: FAIL with "Failed to resolve import ./reconcile".

- [ ] **Step 3: Implement**

`apps/agents/src/money/reconcile.ts`:

```ts
import type { HoldMechanism, HoldStatus } from "@tranche/contracts";
import { schema } from "@tranche/db";
import { eq, inArray } from "drizzle-orm";
import type { Deps, PayPal } from "./deps";
import { errorMessage } from "./errors";
import { appendEvent } from "./events";
import type { HoldRow } from "./holds";

const EXPECTED: Record<HoldMechanism, Partial<Record<HoldStatus, string[]>>> = {
  authorization: { active: ["CREATED", "PENDING"], released: ["COMPLETED", "PENDING"] },
  delayed_disbursement: { active: ["COMPLETED"], released: ["COMPLETED"] },
};

async function remoteStatus(paypal: PayPal, h: HoldRow): Promise<string | null> {
  if (h.mechanism === "authorization" && h.status === "active") {
    return h.paypalAuthorizationId ? (await paypal.getAuthorization(h.paypalAuthorizationId)).status : null;
  }
  return h.paypalCaptureId ? (await paypal.getCapture(h.paypalCaptureId)).status : null;
}

export async function reconcile(deps: Deps): Promise<{ checked: number; mismatches: number }> {
  const rows = await deps.db
    .select({ hold: schema.hold, dealId: schema.milestone.dealId })
    .from(schema.hold)
    .innerJoin(schema.milestone, eq(schema.hold.milestoneId, schema.milestone.id))
    .where(inArray(schema.hold.status, ["active", "released"]));
  let mismatches = 0;
  for (const { hold, dealId } of rows) {
    let theirs: string | null;
    try {
      theirs = await remoteStatus(deps.paypal, hold);
    } catch (err) {
      theirs = `ERROR: ${errorMessage(err)}`;
    }
    if (theirs === null || EXPECTED[hold.mechanism][hold.status]?.includes(theirs)) continue;
    mismatches++;
    await deps.db.transaction((tx) =>
      appendEvent(tx, {
        type: "alert.raised",
        dealId,
        milestoneId: hold.milestoneId,
        payload: { kind: "reconciliation", holdId: hold.id, ours: hold.status, theirs },
      }),
    );
  }
  return { checked: rows.length, mismatches };
}
```

ponytail: alerts repeat every hour until the mismatch is fixed; deduplicate per hold when the alert volume becomes noise.

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL=postgres://tranche:tranche@localhost:5432/tranche pnpm --filter @tranche/agents-service exec vitest run src/money/reconcile.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/money/reconcile.ts apps/agents/src/money/reconcile.test.ts
git commit -m "feat(money): Reconcile holds against PayPal hourly"
```

---

### Task 9: Tick, cron, Workflows tasks and public API

**Files:**
- Create: `apps/agents/src/money/{tick,cron,tasks,index}.ts`
- Modify: `apps/agents/src/index.ts`, `apps/agents/tsdown.config.ts`, `apps/agents/package.json`
- Test: `apps/agents/src/money/tick.test.ts`

**Interfaces:**
- Consumes: Tasks 2-8.
- Produces:
  - `runTick(deps: Deps): Promise<{ inbox: number; actions: number; outbox: number }>` (H4 adds `timers` as the first step)
  - `dist/cron.mjs tick` drains the pipeline for up to 50 seconds (Render cron, every minute); `dist/cron.mjs reconcile` (Render cron, hourly); `tsx src/money/cron.ts loop` ticks every 2 seconds for local development.
  - Workflows tasks `moneyTick` and `reconcile`.
  - `@tranche/agents-service/money` exports: `agreeToPlan`, `decideApproval`, `submitHumanAction`, `appendEvent`, `advanceMilestone`, `StaleMilestoneError`, `runTick`, types `Tx`, `Deps`, `PayPal`.

- [ ] **Step 1: Write the failing test**

`apps/agents/src/money/tick.test.ts`:

```ts
import { schema } from "@tranche/db";
import { createTestDb, truncateAll } from "@tranche/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeHold, makeMilestone, NOW, testDeps } from "./test-helpers";
import { runTick } from "./tick";

const db = process.env.DATABASE_URL ? await createTestDb("agents") : null;

describe.runIf(Boolean(db))("runTick", () => {
  beforeEach(async () => {
    await truncateAll(db!);
  });
  afterAll(async () => {
    await db!.$client.end();
  });

  it("carries an agent release from proposal to paid out in a few ticks", async () => {
    const { dealId, milestoneId } = await makeMilestone(db!, { state: "release_pending", heldMinor: 100000, verifiedAt: NOW });
    await makeHold(db!, milestoneId, { status: "active", authorizationId: "AUTH-1" });
    await db!.insert(schema.proposedAction).values({
      dealId,
      agent: "negotiator",
      side: "client",
      type: "release",
      payload: { type: "release", milestoneId, amount: { currency: "USD", minor: 100000 } },
      reasoning: "Within mandate",
      idempotencyKey: "release:tick:1",
    });
    for (let i = 0; i < 3; i++) await runTick(testDeps(db!));
    const [m] = await db!.select().from(schema.milestone).where(eq(schema.milestone.id, milestoneId));
    expect(m?.state).toBe("paid_out");
    expect(await runTick(testDeps(db!))).toEqual({ inbox: 0, actions: 0, outbox: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=postgres://tranche:tranche@localhost:5432/tranche pnpm --filter @tranche/agents-service exec vitest run src/money/tick.test.ts`
Expected: FAIL with "Failed to resolve import ./tick".

- [ ] **Step 3: Implement**

`apps/agents/src/money/tick.ts`:

```ts
import { processActions } from "./actions";
import type { Deps } from "./deps";
import { processInbox } from "./inbox";
import { executeOutbox } from "./outbox";

export async function runTick(deps: Deps): Promise<{ inbox: number; actions: number; outbox: number }> {
  const inbox = await processInbox(deps);
  const actions = await processActions(deps);
  const outbox = await executeOutbox(deps);
  return { inbox, actions, outbox };
}
```

`apps/agents/src/money/cron.ts`:

```ts
import { getDeps } from "./deps";
import { reconcile } from "./reconcile";
import { runTick } from "./tick";

const mode = process.argv[2] ?? "tick";
const deps = getDeps();
const idle = (r: Awaited<ReturnType<typeof runTick>>) => Object.values(r).every((n) => n === 0);

if (mode === "reconcile") {
  console.log(JSON.stringify(await reconcile(deps)));
} else if (mode === "loop") {
  for (;;) {
    if (idle(await runTick(deps))) await new Promise((r) => setTimeout(r, 2000));
  }
} else {
  const until = Date.now() + 50_000;
  let busy = true;
  while (busy && Date.now() < until) busy = !idle(await runTick(deps));
}
await deps.db.$client.end();
```

`apps/agents/src/money/tasks.ts`:

```ts
import { type TaskContext, task } from "@renderinc/sdk/workflows";
import { getDeps } from "./deps";
import { reconcile } from "./reconcile";
import { runTick } from "./tick";

task(
  { name: "moneyTick", retry: { maxRetries: 3, waitDurationMs: 2000, backoffScaling: 2 } },
  async function moneyTick(_ctx: TaskContext) {
    return runTick(getDeps());
  },
);

task({ name: "reconcile" }, async function reconcileTask(_ctx: TaskContext) {
  return reconcile(getDeps());
});
```

`apps/agents/src/money/index.ts`:

```ts
export { agreeToPlan, decideApproval, submitHumanAction } from "./actions";
export type { Tx } from "./db";
export type { Deps, PayPal } from "./deps";
export { appendEvent } from "./events";
export { advanceMilestone, StaleMilestoneError } from "./milestones";
export { runTick } from "./tick";
```

Add `import "./money/tasks";` to `apps/agents/src/index.ts`.

`apps/agents/tsdown.config.ts`:

```ts
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts", cron: "src/money/cron.ts" },
  platform: "node",
  format: "esm",
  deps: { alwaysBundle: [/^@tranche\//] },
});
```

In `apps/agents/package.json` add:

```json
  "exports": {
    "./money": "./src/money/index.ts"
  },
```

and these scripts:

```json
    "money:dev": "tsx watch --env-file=../../.env src/money/cron.ts loop",
    "cron:tick": "node dist/cron.mjs tick",
    "cron:reconcile": "node dist/cron.mjs reconcile",
```

- [ ] **Step 4: Run tests and the build**

Run: `DATABASE_URL=postgres://tranche:tranche@localhost:5432/tranche pnpm --filter @tranche/agents-service test && pnpm --filter @tranche/agents-service build && ls apps/agents/dist`
Expected: all money tests PASS; `dist` contains `index.mjs` and `cron.mjs`.

- [ ] **Step 5: End-to-end smoke in the sandbox**

1. `pnpm db:up && pnpm --filter @tranche/db db:seed`
2. Terminal A: `pnpm dev`; terminal B: `pnpm --filter @tranche/agents-service money:dev`; terminal C: `cloudflared tunnel --url http://localhost:3000`.
3. Send `Payment capture completed` from the sandbox Webhooks simulator.
4. Expected: the inbox row gets `processed_at` within 2 seconds (`select source_event_id, processed_at, last_error from inbox order by received_at desc limit 1;`), with `last_error` null.

- [ ] **Step 6: Commit and open the PR**

```bash
git add apps/agents
git commit -m "feat(money): Run the money pipeline from cron and Workflows"
git push -u origin feat/money-pipeline
gh pr create --title "feat(money): Inbox, actions, outbox and reconciliation" --body "Implements plan h3."
```
