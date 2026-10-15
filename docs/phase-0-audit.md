# Phase 0 audit

Date: 2026-10-15.
Baseline: local `main` at `81b5098`.
Scope: inspect the existing money paths, integration interfaces, test configuration, and six F0 follow-ups before implementation.
This is the audit checkpoint for the [implementation plan](remaining-work-implementation-plan.md).
Application code was not changed, and no PayPal operations, migrations, or test suites were executed during this audit.

## Outcome

All six F0 follow-ups have supporting code evidence or configuration evidence in this checkout.
The recovery findings below are confirmed by inspection, with dynamic reproductions still required before fixes.
The audit also identified direct PayPal write paths outside the product outbox, and a separate CI prerequisite for the guarded F0 database suite.
The audit portion of Phase 0 is complete; BASE-01 remains open because its write-path corrections and acceptance tests are not complete.

## Existing interfaces to reuse

| Integration | Existing implementation and requirement |
| --- | --- |
| Web database and PayPal | Use `getDb` and `getPayPal` from `apps/web/src/server/db.ts` and `paypal.ts`. |
| Agency access | Use `memberOrNull`, `requireMember`, and `requireDealAccess` from `apps/web/src/server/session.ts`; do not create alternate authorization paths. |
| Policy and human actions | `apps/agents/src/money/index.ts` exports `agreeToPlan`, `decideApproval`, and `submitHumanAction`. |
| Agreement | `apps/agents/src/money/actions.ts:543` accepts the reviewed plan version; callers must handle agreed, plan_changed, already_agreed, and not_agreeable. |
| Negotiation | `apps/agents/src/money/actions.ts:295` rejects acceptance from system or the offering side and compares the complete latest offer. |
| Client policy | `apps/web/src/server/portal.ts:20` supplies the shared default; do not import a Next server module into the worker runtime. |
| Rescheduling | Reuse `applyReschedule` from the money service, rather than recomputing timer changes in an agent. |
| Tick registration | `apps/agents/src/money/schedule.ts` exports moneyTick every minute and reconcile as the hourly task name. |
| Worker entry | `apps/agents/src/index.ts` registers existing money tasks and ping; Lane E consumer registration is still absent. |
| Delivery verification | `apps/agents/src/money/inbox.ts` carries the applied inbox row ID as deliveryId, including manual notes; the future verifier must load that exact row. |
| Verification evidence | `actions.ts:323` reads milestone evidence and applies the core gate; future integration must prove delivery isolation and release-time behavior rather than assuming it. |

The agent and verifier packages currently export empty placeholders, so no completed Lane E runtime is implied by the existing money worker.

## Money path map

| Path | Current behavior | Audit result |
| --- | --- | --- |
| Seller onboarding | `apps/web/src/server/onboarding.ts:12` directly calls createSellerReferral, which supplies a deterministic referral request ID in the PayPal client. | Request ID exists, but the write is outside the durable product outbox. |
| Portal funding order | `apps/web/src/server/funding.ts:94` creates the order inside the milestone DB transaction, using fund plus milestone ID and hold count. | A stable request ID exists, but no durable intent is committed before the external call; a lost response or DB rollback needs reproduction. |
| Scheduled funding order | `apps/agents/src/money/funding.ts:94` creates an order while processing funding work, then persists the hold. | The timer originates from outbox work, but recovery must prove the parent request identity survives a lost response and unchanged hold count. |
| Initial hold placement | Browser confirmation and CHECKOUT.ORDER.APPROVED enqueue the same place:<holdId> outbox identity. | Existing deduplication path should be preserved and regression-tested. |
| Renewal | `apps/agents/src/money/holds-renew.ts` uses the outbox request ID or deterministic order/hold suffixes; replacement coordination exists. | Inspectable durable path exists; no fresh runtime or PayPal verification was performed. |
| Release and cancellation | `effects.ts`, `outbox-handlers.ts`, and `holds.ts` enqueue capture/release and void/refund operations. | Existing outbox handlers should be reused; provider error names still need sandbox evidence. |
| PayPal webhook intake | `apps/web/src/app/api/webhooks/paypal/route.ts` verifies the raw body before inserting a source event ID into inbox and kicking the money tick. | Correct verification-before-insert order is present by inspection. |
| Webhook registration script | `packages/paypal/scripts/register-webhook.ts` directly deletes matching hooks before creating a replacement. | No durable outbox or request ID is supplied for these writes; a failure after deletion can leave registration missing. |
| Manual funding script | `packages/paypal/scripts/fund-manually.ts` directly creates and places two holds with random request IDs. | This is not a bounded one-milestone product-path test and does not have durable cross-run identity. |
| F0 capability runner | `apps/agents/scripts/f0/runner.ts` and `packages/db/src/sandbox-store.ts` implement a separate approval, attempt, and budget journal. | Do not treat this experiment journal as proof that the product outbox is wired end to end. |

The product outbox executor has a five-minute lease, attempt fencing, retries under the same request ID, and a called state that preserves a response before DB settlement.
The inbox processor uses row locking, a savepoint, bounded backoff, and dead-letter handling after ten attempts.
These mechanisms were inspected, but their existence is not a claim that every PayPal endpoint supports replay for an unlimited duration.

## Six F0 findings and reproduction plans

### F0-01: approval consumed before dispatch

Evidence: `packages/db/src/sandbox-store.ts:787` consumes approval and reserves stage work in claim, while `markDispatch` at line 870 runs later.
The runner performs readiness reads after claim and catches failures into an inconclusive outcome before finish clears the claim.
There is no equivalent path that restores a definitely undispatched stage to a safely retryable or reapprovable state.
The supported F0 payment stages are create_order, authorize_order, and capture_order, with no dedicated approved void cleanup stage.
The existing test at `apps/agents/scripts/f0/runner.test.ts:1055` deliberately prevents reusing consumed approval; preserve that protection while adding a new safe recovery path.

Before changing behavior, reproduce through the public runner or CLI using the guarded disposable DB and fake HTTP transport.
Inject an OAuth failure, a readiness failure, and a stale dispatch-boundary readiness check separately, then inspect persisted approval, dispatched marker, calls, and operation state after restart.
For capture, begin with a fake live authorization and prove preparation failure leaves it open with no approved cleanup command.
Acceptance requires no repeated approval use, no retry after ambiguous dispatch under a new identity, exact accounting, and a separately approved cleanup path.

### F0-02: create-order response lost without an ID

Evidence: `apps/agents/scripts/f0/payment-adapters.ts:132` returns inconclusive when the payment resource lacks orderId.
The adapter can preserve an ID from a response it received, but it cannot recover an ID from a response lost before interpretation.
The existing test at `runner.test.ts:1869` records the lost response and forbids another POST, without establishing a successful recovery path.

Reproduce a successful fake provider order creation followed by a dropped response, restart the runner, and inspect recovery, held calls, and principal reservations.
Acceptance requires recovery under the original approved identity or explicit authoritative adoption of a validated known order ID.
Reject mismatched amount, seller, buyer, commitment, and payload identity, and never create a blind replacement or free unresolved exposure.
Endpoint replay support and retention must be checked against official endpoint documentation during implementation before selecting automatic recovery.

### F0-03: local database port mismatch

Evidence: `docker-compose.yml` maps host 5433 to container 5432, while `.env.example` sets the local application URL to host 5432.
Multiple older lane-plan commands also use host 5432.
The CI service independently publishes 5432, and the F0 disposable fixture deliberately uses 55432.

Reproduce by starting the documented local Compose setup and attempting the documented connection using a disposable setup, then repeat with host 5433.
Acceptance requires corrected local instructions and examples while keeping CI, container-internal ports, and the F0 fixture unchanged.
The example file also repeats HOLD_MECHANISM; remove that duplicate in the configuration slice.

### F0-04: guarded runner tests disappear under Turbo

Evidence: `turbo.json` lists only DATABASE_URL for test, and `runner.test.ts:83` skips the DB suite if TEST_DATABASE_URL is absent.
Installed Turbo 2.11.7 documentation states that its default strict environment filters undeclared variables.
The CI workflow also supplies only an application DB on port 5432, so forwarding alone cannot make the guarded F0 suite run in CI.

Reproduce with a configured disposable localhost:55432/tranche_p2_test database and compare direct package execution with root Turbo test execution, recording whether the suite runs or skips.
Acceptance requires TEST_DATABASE_URL forwarding, an explicitly provisioned guarded CI fixture, and logs that prove the suite executed.
Never substitute DATABASE_URL for TEST_DATABASE_URL or remove the test destination guard.
Review caching so a previous skipped result cannot count as fresh DB validation.

### F0-05: referral recovery cannot reclaim an expired worker

Evidence: `sandbox-store.ts:1206` rejects beginReferralRecovery whenever the recovery row already has claimToken.
The operation is moved to recovering with a 60-second lease, but general beginRecovery at line 1357 refuses unfinished referral recovery rows.
A process crash bypasses the catch handler that would normally call failReferralRecovery, leaving no usable reclaim path until deadline handling.

Reproduce by approving referral recovery, claiming it, terminating the worker before completion, expiring the lease, and invoking the same public recovery command after restart.
Acceptance requires same-operation reclaim with a fresh fence, rejection of stale-worker settlement, no second referral POST, and exact call reservations.
Test crashes before GET, after GET, and before settlement separately.

### F0-06: pure call rules live in contracts

Evidence: `packages/contracts/src/sandbox-protection.ts:118` defines paymentStageCalls, paymentTotalCalls, and paymentApproval.
The DB sandbox store imports these behavioral rules from contracts.

This is a package-boundary refactor, rather than a runtime failure requiring a user-journey reproduction.
Before moving the rules, record their current outputs and enumerate all imports.
Acceptance requires the functions exported from pure core, unchanged schemas in contracts, no contracts-to-core dependency, and passing affected tests and typechecks.

## Test setup and evidence limits

The application money tests use `packages/db/src/testing.ts`, which reads DATABASE_URL, creates a prefixed test database, migrates it, and serializes access with an advisory lock.
The F0 runner integration suite instead truncates its explicitly guarded disposable database at localhost or 127.0.0.1, port 55432, name tranche_p2_test.
The two mechanisms require separate setup and must not be conflated.
Node reported v22.19.0, satisfying the root minimum of 22.12.
The root pins pnpm 12.10.1 and Turbo 2.11.7; Turbo resolved locally and its bundled README and environment-variable guide were read.
The pnpm version probe did not finish and was cancelled; package-manager readiness remains unverified before Phase 1 commands.
No test suite was executed, so there are no new passing, failing, or skipped test counts to report.
Database availability and migration compatibility were not probed.
GitHub Actions billing status was not checked; the handoff's report remains unverified.

Historical evidence in `docs/paypal/evidence/p4-us-authorization-capture-2026-10-12.md` records a successful specific capture, 40 of 50 API attempts used, and 100 committed cents.
It is not fresh evidence from this audit and does not authorize further money writes or prove the H2 product flow.

## Phase 1 correction slices

1. Verify pnpm and disposable DB readiness, reproduce the configuration issue, fix local port examples and TEST_DATABASE_URL forwarding, provision the matching CI fixture, and move pure budget rules with focused checks.
2. Reproduce and repair definitely undispatched failure recovery and expired referral-recovery claims, with crash and accounting tests.
3. Reproduce and implement lost-order recovery, retaining identity and exposure checks, then document the P7 authorization plus agency_pays decision.
4. Close BASE-01 gaps in portal order creation, seller referral, and operator scripts using durable intents and endpoint-appropriate recovery; prove scheduled order creation recovery without rebuilding already durable handlers.

Review and test each slice separately while retaining the handoff's one-PR grouping for the six F0 fixes.
Keep the product write-path corrections identifiable in the diff so they can be reviewed independently of the F0 runner.
Phase 1 starts with reproduction and environment verification, not with real sandbox calls.
