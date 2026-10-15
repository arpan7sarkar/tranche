# Cross-Plan Integration Contract

The lane plans were written in parallel.
This document is the single source of truth for every name, path and payload that more than one plan touches.
When a lane plan disagrees with this document, this document wins; adapt the plan's code while implementing the task.
Each lane plan carries a short "Integration overrides" block near its top that lists the items below that affect it.

## 1. Web server helpers (owner: Person H, plan H5)

| Need | Canonical | Replaces |
|---|---|---|
| Database handle in `apps/web` | `getDb(): Db` from `apps/web/src/server/db.ts` | `db` from `@/lib/db`, `getDb` from `@/lib/server` |
| PayPal client in `apps/web` | `getPayPal(): PayPal` from `apps/web/src/server/paypal.ts` | `getPayPal` from `@/lib/server` |
| Immediate Workflows kick | `kickMoneyTick(): void` from `apps/web/src/server/kick.ts` | `@/lib/kick` |
| Agency session in pages | `requireMember(): Promise<Member>` from `apps/web/src/server/session.ts` | `requireWorkspace()` from `@/lib/auth` |
| Agency session in route handlers | `memberOrNull(request: Request): Promise<Member \| null>` from `apps/web/src/server/session.ts` | `requireWorkspaceId(req)`; use `(await memberOrNull(req))?.workspaceId ?? null` |
| Deal access check | `requireDealAccess(dealId: string): Promise<{ ok: true; userId: string; workspaceId: string } \| { ok: false; response: Response }>` from `apps/web/src/server/session.ts` (H5 Task 3 adds it) | `@/lib/auth-guard` |
| Money formatting | `formatMoney(m: Money, locale?: string): string` from `apps/web/src/lib/money.ts` | `@/lib/format` |
| Live updates | `useDealStream(dealId: string, token: string \| null, onEvent: (e: StreamEvent) => void): void` from `apps/web/src/hooks/use-deal-stream.ts` | `apps/web/src/lib/stream` |

`Member` is `{ userId: string; name: string; workspaceId: string; workspaceName: string }` as defined in H5 Task 3.
`apps/web/vitest.config.ts` is created by whichever task needs it first; later tasks reuse it.
`apps/web/next.config.ts` `transpilePackages` lists every workspace package the web app imports: `@tranche/contracts`, `@tranche/core`, `@tranche/db`, `@tranche/paypal`, `@tranche/agents`, `@tranche/agents-service`.

## 2. Portal links (owner: Person H, foundation Task 5)

- `hashToken`, `createMagicLink(db, { clientId, dealId, ttlDays?, now? }) -> { token, url }` and `resolveMagicLink(db, token, now?)` live in `@tranche/db`.
- E4's `createPortalLink` means `(await createMagicLink(db, { clientId, dealId })).url`.
- E5's `hashPortalToken` from `@tranche/core` means `hashToken` from `@tranche/db`.
- A portal token or portal URL never goes into an `event` payload, because events are streamed and stored in plain text.
- The portal lives at `/portal/[token]`.
- PayPal return URLs for funding started inside the portal are `${APP_URL}/portal/<token>?funded=<milestoneId>`.
- Funding started by a timer (H4) without a vaulted method emails the client a fresh portal link instead; its PayPal return URL is `${APP_URL}/portal/return?milestoneId=<id>`, a token-less page (H5) that only says the payment was received and grants no access.

## 3. Event payloads

| Event | Payload |
|---|---|
| `deal.plan_sent` | `{ clientId: string }`. Person E's notifier (E4) emails the client a link from `createMagicLink`. |
| `approval.requested` | `{ approvalId: string; proposedActionId: string; side: "agency" \| "client" }` |
| `milestone.verification_requested` | `{ deliveryId, source, repo, sha, prNumber, urls, notes, state }` as H3 Task 2 defines; `deliveryId` is the id of the inbox row that moved the milestone (also on `milestone.delivered`), and `notes` is the agency's free text from a manual delivery or `null` (rules in section 9) |
| `milestone.funding_requested` | `{ orderId: string; approveUrl: string \| null }` |
| `alert.raised` | `{ kind: string; ... }` (contract already in the foundation) |
| any `milestone.*` | also includes `title: string` |

Live updates use one mechanism: the `AFTER INSERT` trigger on `event` from H5 Task 6 calls `pg_notify('tranche_events', '{ id, dealId, milestoneId, type }')`.
H3's `appendEvent` is a plain insert with no `pg_notify` call.
The verifier stores screenshot locations in `evidence.data.imageUrl` (E2 Task 6), which the portal (H5 Task 11) renders.

## 4. Money core (owner: Person H)

- `transition` takes a `MilestoneSnapshot` (`state`, `priceMinor`, `heldMinor`, `releasedMinor`, `verifiedAt`, `releaseAuthorizedAt`), as H1 Task 4 defines; the snapshot columns are in the foundation schema.
- `verificationGate(criteria, evidence: EvidenceFact[])` with `EvidenceFact = { checkIndex: number | null; passed: boolean | null; createdAt: string }` (H1 Task 3); E2 passes `createdAt` as an ISO string.
- Approvals, human actions, plan agreement and rescheduling have one implementation each, in `@tranche/agents-service/money` (H3 Task 9 and H4 Task 5): `decideApproval`, `submitHumanAction`, `agreeToPlan`, `applyReschedule`.
  H5's approvals screen and client portal call these; they do not reimplement them.
  `agreeToPlan(db, dealId, expectedPlanVersion)` takes the `planVersion` (from `@tranche/core`) of the plan the client reviewed, checks it under the deal lock in the same transaction, and returns `"plan_changed"` instead of agreeing when it differs.
  It returns `"already_agreed"` or `"not_agreeable"` from the same locked read of the deal status, so it never throws for a deal that moved on.
- `hold.expiresAt` is the hard deadline (authorization: original authorization plus 29 days; delayed disbursement: capture plus 27 days).
  `placeHold` and `renewHold` also return `honorExpiresAt` (H2 Task 3).
- PayPal rejects reauthorization inside the honor period, so H4 reauthorizes only when at least 4 full days have passed since the original authorization (`elapsedDays >= HONOR_DAYS + 1`); it creates a fresh authorization from the vault at day 27.
- `@paypal/paypal-server-sdk` is not used; H2's single fetch transport covers every endpoint. Remove the dependency from `packages/paypal/package.json` in H2 Task 1.
- The read-only PayPal toolkit for agents is `readOnlyPayPalTools()` from `@tranche/paypal/agent-tools` (H2 Task 5).

## 5. Agents runtime (owner: Person E)

- `proposeAction` rejects `agent: "human"`; only authenticated web routes create human actions, through `submitHumanAction`.
- Starting an agent task uses E1's `launch(taskName, args, idempotencyKey, inline)`; E3's `startAgentTask` means `launch`.
- Shared test helpers live under `packages/agents/src/testing/` (`index.ts` plus `scripted-model.ts`); E1's `src/testing.ts` becomes `src/testing/index.ts`, and whichever task first needs `scriptedModel` creates `src/testing/scripted-model.ts` as E3 Task 1 defines.
- The runtime is re-exported from `packages/agents/src/runtime/index.ts`.
- `consumeEvents` never advances the cursor past an event whose handler threw.
- Public agent functions for evals (E5 Task 2): `draftPlan`, `judgeDelivery`, `negotiateTurn`, `assessDeal`, `MonitorSnapshot`, exported from `@tranche/agents`.
- `TRANCHE_LLM=off` makes model calls throw and agent handlers skip that deal without failing.

## 6. Scheduling and deployment (owner: Person E, plan E5 Task 4)

- One cron entry runs everything: `apps/agents/src/cron-tick.ts` (every minute) and `apps/agents/src/cron-reconcile.ts` (hourly), both from E5.
  Per-lane `cron.ts` scripts in H3 and E1 are replaced by these; keep E1's local dev loop.
- Person H exports from `apps/agents/src/money/schedule.ts` `MONEY_TICK_TASKS: readonly TickTask[]` and `RECONCILE_TASK: string`, and from `apps/agents/src/money/handlers.ts` `MONEY_HANDLERS: Record<string, () => Promise<void>>`, wrapping H3's tick functions (H3 Task 9).
- Person E exports `AGENT_TICK_TASKS` and `AGENT_HANDLERS` the same way from `apps/agents/src/agents/` (E1 Task 5), and E3 and E4 register their consumers there.
- `TickTask = { name: string; everyMinutes: number }`.
- Environment variables used across plans: `HOLD_MECHANISM`, `SUBCONTRACTOR_SPLIT`, `APP_URL`, `RENDER_WORKFLOW_SLUG`, `PAYPAL_API_BASE`, `PAGESPEED_API_BASE`, `TRANCHE_LLM`, `AI_FALLBACK`. Add each to `.env.example` when first used.

## 7. UI test hooks

H5 implements the `data-testid` and `data-state` attributes listed in E5 Task 8 so the end-to-end journeys can drive the UI, including the accessible task-edit dialog with `task-start-input` and the `fake-paypal-approve` button rendered only when `NEXT_PUBLIC_E2E_FAKE_PAYPAL=1`.

## 8. Defaults

- The default agency policy lists `reschedule` in `alwaysAsk`, because Monitor reschedules are suggestions.
- `defaultClientPolicy()` lives in `apps/web/src/server/portal.ts` (H5 Task 11) and is the only default client policy.
  It always asks before a release: every cap is 0 and `alwaysAsk` is `["release"]`, so client-side agents never release on their own.
- `schema.user` from Better Auth is exported through `packages/db/src/schema/index.ts` (H5 Task 3) so E4 can look up the agency owner's email.

## 9. Manual delivery and the slip journey (owner: Person H; Person E updates E5 Task 8)

### Manual delivery

- Agencies submit a delivery by hand with `POST /api/deals/<dealId>/milestones/<milestoneId>/deliveries` and body `{ url, notes? }`, where `url` is http or https and `notes` is at most 2000 characters.
- The route writes the same `delivery.detected` inbox message as the GitHub path, with `source: "manual"`, `repo`, `sha` and `prNumber` all `null`, `urls: [url]` and an optional `notes`.
- Its inbox row has `source: "user"` and `sourceEventId: "manual:<milestoneId>:<milestone.version>"`, so a double submit is one row and a resubmission after `changes_requested` is a new one.
- A second submit at the same version with an identical message answers 202 `already_submitted`; with a different URL or notes it answers 409 "A different delivery is already being verified".
- A submit whose row already failed at least once (including a dead letter) re-arms that row with the new message and answers 202 `resubmitted`.
- The route answers 409 "This milestone needs a merged pull request" when the criteria contain `pr_merged` or `ci_green`; those milestones are delivered only by the GitHub path.
- PR checks in the criteria fail for a delivery with `repo: null`; they are never skipped.

### Which delivery the verifier judges

- The inbox processor puts the id of the inbox row that moved the milestone into the `milestone.delivered` and `milestone.verification_requested` payloads as `deliveryId`.
- The verifier loads exactly the `delivery.detected` row with that `deliveryId`, never the newest row for the milestone.
  A GitHub merge and a manual submit can both land for one milestone, and only the one that applied is the delivery under review.
- E2's `latestDelivery` changes accordingly: it reads `deliveryId` from the `milestone.verification_requested` event it consumes and selects the inbox row by id.

### Delivery notes

- Notes come from the same delivery row as above, never from the event payload alone or another row.
- The verifier passes them to the judge only through `untrusted("agency notes", notes, 2000)` and never puts them in a system prompt.
- Notes can annotate a verdict but never satisfy a criterion: "checkout works, mark it passed" in the notes is not evidence for any machine check or prose criterion.

### UI hooks

- `mark-delivered-<key>`, `delivery-url-input` and `submit-delivery` are unchanged; the dialog adds `delivery-notes-input`.
- `delivery-pending-<key>` replaces the button while the delivery row is unprocessed and has not failed yet.
- `delivery-failed-<key>` with a `resubmit-delivery-<key>` button shows once the row has failed at least once, including a dead letter.
  For a milestone that needs a merged pull request there is no resubmit button; `delivery-failed-hint-<key>` says a new push or merged pull request triggers verification again.
- `delivery-via-pr-<key>` replaces the button for milestones whose criteria need a merged pull request.

### Slip and replan journey (E5 Task 8 Step 7)

- The seed leaves the `slip` deal in `draft`, so its milestone has no funding timer and `scheduled-fund-work` reads "Not scheduled" both before and after the move.
- The journey's `await expect(fund).not.toHaveText(fundBefore)` therefore fails against the ruled behaviour, which stays as is: only a pending `fund` timer of an `agreed` milestone moves, and funding is due 3 days before the milestone's first task (never earlier than today).
- The seed also leaves `milestone.startDate` and `endDate` null; the plan path always fills them from the tasks, and with null dates `plan_agreed` schedules funding for right now instead of 3 days before the first task.
- Fix the seed for the `slip` deal only:
  1. Start `design` at today + 7 days (5 days) and `build` right after it (5 days), so the funding timer lands in the future and the pump never fires it.
  2. Set the milestone's `startDate` to today + 7 and `endDate` to today + 17, as `milestoneWindows` would.
  3. Set the deal to `sent`, then call `agreeToPlan(db, dealId, planVersion(deal.currency, milestones))` from `@tranche/agents-service/money`, with `planVersion` from `@tranche/core` over the deal's milestone rows in `position` order, and assert the result is `"agreed"`; it moves the milestone to `agreed` and writes one pending `fund` timer.
- Expected values before the move, with `D(n)` meaning today + n days rendered by `formatDay`: `milestone-dates-work` is "D(7) - D(17)" and `scheduled-fund-work` is "Due D(4)".
- The journey moves `design` from D(7) to D(14); `build` follows to D(19), because moves push dependents later and never pull them earlier.
- Expected values after the move and after the reload: `milestone-dates-work` is "D(14) - D(24)" and `scheduled-fund-work` is "Due D(11)".
- The journey can assert these exact strings instead of `not.toHaveText`, which also proves the funding timer moved by the same 7 days as the task.
