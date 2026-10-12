# P2 implementation record and handoff

Date: 2026-10-12.
Status: Offline runner foundation implemented and verified.
Real PayPal business adapters: Deferred to P3-P6 as specified in the reviewed plan.
Payment capability status: All not_tested.

## Delivered implementation

| Location | Delivered behavior |
|---|---|
| packages/contracts/src/sandbox-capabilities.ts | Strict Zod operation, allocation, run, attempt, browser-wait, approval, inspection and report shapes; original MilestoneState unchanged |
| packages/core/src/sandbox-policy.ts | Pure budget and approval checks, with no I/O or clock access |
| packages/db/src/sandbox-schema.ts | Seven sandbox tables, including a commitment ledger for lifecycle principal accounting |
| packages/db/src/sandbox-store.ts | Transactional reservations, immutable payload hashes, approval consumption, competing-worker claims, fenced recovery, browser waits and sanitized reports |
| packages/db/drizzle/ | Two Drizzle-generated migrations, reviewed and applied only to the disposable local test database |
| packages/paypal/src/client.ts | Fixed sandbox HTTP destination, counted OAuth/reads, outbox permits for writes, request IDs, bounded requests, manual redirects and sanitized errors |
| apps/agents/scripts/f0/runner.ts | Adapter boundary, approved dispatch, bounded read-only recovery and restart-safe orchestration |
| apps/agents/scripts/f0/index.ts | start, inspect, approve, resume and report commands; safe default and help; empty real adapter registry |
| apps/agents/scripts/f0/private-artifacts.ts | Sandbox browser URL validation and private artifact storage under opaque keys |

The existing preflight implementation and its 54 tests were preserved.
No agent workflows gained payment tools and no product UI, webhook processor or full policy engine was added.
The implementation keeps executor and report responsibilities in runner.ts, index.ts and the store instead of creating empty executor/report modules.
The transport uses direct fetch after inspecting the installed SDK and official OAuth/idempotency documentation.
fast-check was added to the core package for required property tests, and the database package now depends on the pure core checks.
Package-manager changes and the lockfile were generated with the pinned pnpm version; signature verification was not bypassed.

## Limits and recovery decisions

One allocation per authorized database fixes total exposure at 100 USD cents and API attempts at 50 across runs and restarts.
Principal and per-operation fee bounds are reserved before commitment and approval is bound to the complete canonical request and next attempt.
The shared commitment ledger avoids counting the same principal again for authorization, capture and release.
Fresh orders and payouts cannot reuse an existing commitment to bypass the money limit.
Semantic operation uniqueness and stable request IDs prevent preparing a second operation under the same kind/resource identity.
Claiming reserves a dispatch attempt and holds authentication/recovery calls against competing work.
Expired claims enter recovery rather than becoming executable again; stale workers cannot reuse claims or consumed approvals.
Recovery uses authoritative-read adapters and never blindly resends a write.
Failed and inconclusive operations conservatively retain money reservations, and no reset, automatic budget increase or refund-based replenishment exists.
Real adapters must establish trustworthy fee bounds, payload/summary agreement, merchant mapping, required permissions and endpoint-specific recovery before registration.

## Verification actually executed

| Check | Result |
|---|---|
| Contracts tests | 10 passed |
| Core tests | 5 passed, including 1,000 generated budget combinations |
| PayPal transport tests | 17 passed with fake credentials and injected HTTP responses |
| P1 preflight regression tests | 54 passed |
| Runner/private-artifact tests | 23 passed, including 18 actual PostgreSQL integration scenarios |
| Typechecking | Passed for contracts, core, db, paypal and agents-service |
| Generated migrations | Applied successfully to the disposable local PostgreSQL 18 database |
| Packaged runner help and default invocation | Passed without database or PayPal requests |
| Biome | Passed across 20 source and package files |
| Documentation and privacy scan | Local links/fences, whitespace, no em dashes and no configured PayPal credentials passed across 32 source/doc files |
| Git whitespace and ignored private paths | Passed; .env, sources and .sandbox-private remain ignored |

Total: 109 passing tests; no database scenarios were skipped in the recorded integration run.
The database suite rejects destinations other than the explicitly named local test database on port 55432.
Tests covered concurrent reservations and dispatch, shared limits across runs, restart persistence, approval mismatches and reuse, payload tampering, lifecycle fees, browser waits, stale claims, ambiguous writes, recovery bounds, missing adapters and private output.
An initial transport fixture reused a consumed Response body; the fixture was corrected, and the affected suites passed on rerun.
Routine pnpm checks needed authorized registry access in this environment; Docker also needed authorized access to start and run the isolated test service.
No real OAuth or PayPal business requests were issued during P2 implementation.
The configured application database and existing credentials were not modified.
The isolated tranche-p2-tests container was stopped after verification; its test data contains only synthetic fixtures.

Exact test and operator commands are in the [P2 runbook](p2-runbook.md).
The contributor-requested retest on 2026-10-12 again passed all 109 tests, five affected-package typechecks and the 20-file Biome check.
That retest used mocked PayPal transport and the isolated test database, with no real PayPal requests; the test container was stopped afterward.

## Completion criteria and remaining prerequisites

P2's offline foundation criteria are met: persistent state, atomic limits, approval gating, duplicate prevention, bounded recovery and sanitized reporting were exercised against mocks and a disposable database.
These checks establish runner behavior, not successful PayPal endpoint behavior.
The CLI deliberately registers no real capability adapters, so resume cannot authenticate or send a business request for an executable operation until a reviewed adapter is installed.
Applicable fees, seller grants, usable payout funding and actual USD transaction support remain unproven.
The P1 browser-operator availability confirmation remains open; passing P2 tests does not close that assessment.
A concrete eligible payment experiment cannot yet be prepared with established endpoint prerequisites and fee bounds; retain that blocker rather than guessing a fee or increasing the budget.

## Next phase

The next implementation task is the P3 seller-onboarding adapter and its endpoint-specific contract tests.
Confirm platform onboarding prerequisites and the contributor's browser availability before requesting a real referral operation.
Keep seller onboarding, consent completion and granted permissions as separate evidence results.
After P3 readiness, prepare the P4 protection-path experiment within the remaining $1 and 50-call allocation.
Before any money-moving test, present its purpose, sender, recipient, principal and fee allowance and wait for explicit approval.
Later phases remain P5 multiple payees, P6 Payouts and P7 evidence review, subject to prerequisites and remaining budget.

Related records: [P2 plan](p2-sandbox-runner-implementation-plan.md), [current F0 handoff](f0-status.md), [access assessment](evidence/p1-access-assessment.md).
Completion review: [P2 closeout](p2-closeout.md).
Implementation handoff: [P3 seller onboarding](p3-seller-onboarding-implementation-plan.md) and [P4 payment protection](p4-payment-protection-implementation-plan.md).
