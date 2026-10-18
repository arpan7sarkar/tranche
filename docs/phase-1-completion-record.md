# Phase 1 completion record

Date: 2026-10-17.
Baseline: main at 0aef343, containing the merged PR #20/#21 changes.
Branch: fix/phase-1-money-foundation.
Scope: finish F0-02, P7-01, and BASE-01, while preserving F0-01 and F0-03 through F0-06.
Phase 1 is complete locally; the canonical status and pending list are in [remaining_work.md](remaining_work.md).

## Remaining work identified before implementation

F0-02 had no successful recovery path for an order created by PayPal when its response and ID were lost.
P7-01 needed an evidence-limited authorization and agency_pays decision with P5/P6 explicitly deferred.
BASE-01 still had portal order creation and seller referrals outside the product outbox, destructive webhook re-registration, and an unbounded two-payment manual script.
Scheduled funding and renewal needed durable creation results across failures and restarts.

## Reproduction

The new F0 CLI regression failed with invalid_command when attempting to recover a lost order by its known provider ID after reopening the database.
The portal funding regression failed because no creation intent survived a simulated lost response.
The first attempt to run these tests found a stopped Docker daemon and missing web workspace dependencies, so no behavior conclusion was drawn from that attempt.
The owned disposable Compose fixture and pinned dependencies were restored, and both behavior failures were then reproduced before production changes.
Final review reproduced two cancellation failures through the database-backed creation, outbox, and webhook paths: an early no-op void consumed the cleanup identity before late authorization, and a queued hold still dispatched after cancellation.
Both regressions passed after deferring cleanup until funds are confirmed and checking cancellation before queued hold placement.

## Changes and evidence map

| Task or path | Implemented behavior | Local proof |
| --- | --- | --- |
| F0-02 | Explicit known-order adoption under the original payload hash, claim fence, payment context, and counted recovery allowance | Restart recovery reaches the browser or approved state; mismatched amount, seller, buyer, commitment, order, intent, hash, and active claims are rejected |
| Portal and scheduled funding | Both callers commit one shared creation intent with frozen terms before dispatch | A missing response retains one intent and no hold; concurrent callers share it; a valid authoritative read settles it without another creation |
| Seller onboarding | Referral input and request ID are committed before dispatch; known referrals recover by verified read | Repeated calls reuse the saved response, preserve active onboarding, and do not replay an ambiguous referral POST |
| Renewal | Replacement order has its own durable creation response before hold placement | Existing renewal and cancellation regressions pass through the new persisted order path |
| Webhook registration | List and reuse an exact destination with the required subscriptions; persist any new registration before dispatch | A lost registration response recovers through listing, with one POST and no DELETE |
| Manual funding | Operate on one real deal and funding-state milestone through the shared service | Same service ownership, state, concurrency, and request identity checks as portal funding |
| Dispatch boundary | Persist the creation dispatch marker after OAuth using the current outbox attempt and lease fence | OAuth failure permits retry of the original intent; a lost claim prevents the provider POST |
| P7-01 | Select authorization and agency_pays, defer P5/P6, and record historical evidence limits | [Payment-path decision](paypal/payment-path-decision.md) links the dated experiment and checked endpoint references |

Existing release, cancellation, hold placement, inbox deduplication, and stale-worker settlement paths remain part of the affected regression suites.
The PayPal package's signature verification tests also pass; no real webhook delivery was exercised.
New creation kinds reuse the existing JSON outbox schema, so no schema migration is required.
Shared request and response shapes are exported from contracts; core remains pure.
Product order custom_id now identifies the exact creation request, while reference_id retains the milestone ID.
Order recovery refuses legacy or mismatched custom IDs rather than guessing which creation they belong to.
Portal return URLs use the existing tokenless return page so a portal bearer token is not persisted in outbox requests.

## Verification

Validation date: 2026-10-17, using pnpm 12.10.1 and the owned disposable PostgreSQL fixture at localhost:55432/tranche_p2_test.
Database suites ran with DATABASE_URL and TEST_DATABASE_URL pointing to that fixture and RUN_PAYPAL_SANDBOX_TEST=0.
The shared fixture guard and migrations passed before the database suites ran.

| Command | Result |
| --- | --- |
| `pnpm --filter @tranche/agents-service test` | 225 passed, 2 real-sandbox tests skipped; final rerun includes both cancellation regressions |
| `pnpm --filter @tranche/web test` | 374 passed |
| `pnpm --filter @tranche/contracts test` | 104 passed |
| `pnpm --filter @tranche/core test` | 125 passed |
| `pnpm --filter @tranche/paypal test` | 101 passed, 4 real-sandbox tests skipped |
| `pnpm --filter @tranche/db test` | 16 passed |
| `pnpm --filter <package> typecheck` for contracts, core, db, paypal, agents-service, and web | All passed; agents-service rerun after the final cancellation changes |
| `pnpm --filter @tranche/agents-service build` | Passed after the final cancellation changes |
| Local pinned `biome check` across the 30 changed/new TypeScript and JSON files | Passed |
| `git diff --check` | Passed |

Total: 945 passing tests and 6 intentionally skipped real-sandbox tests across these suites.
These are the latest successful results per package, not a claim that one root command executed every suite.
The web auth suite initially exceeded its default setup timeout while loading modules and preparing its database; its setup timeout is now 30 seconds, and all 374 web tests passed on rerun.
No web production build, Playwright journey, remote CI, deployment, or real-provider validation is claimed by this checkpoint.

## Limits and follow-up

All provider responses in the implementation tests are fake; no real PayPal request or payment was made.
The historical USD 1 experiment allowance remains exhausted and unchanged.
The retrieved endpoint references did not establish creation replay retention, so ambiguous creation POSTs are not automatically repeated.
If the provider resource ID is unavailable or its returned fields cannot establish identity, the operation remains pending for investigation.
The [operator recovery runbook](paypal/product-recovery-runbook.md) documents these limits and the commands.
The original F0 capability campaign and Phase 9 real-sandbox product validation remain separate, incomplete work.
Remote CI and deployment are not established by local test results.
