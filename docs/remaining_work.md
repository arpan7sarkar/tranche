# Remaining work

This is the single implementation plan, current status, and pending task list for the October 15 Lane E handoff.
The integration contract takes precedence over older lane plans.
Lane H is merged; Lane E runtime, planner, verification, and negotiation are implemented locally.

## Current checkpoint

Phases 0 through 5 are complete locally.
F0-01 through F0-06, P7-01, BASE-01, E1-01 through E1-04, E2-01 through E2-04, and E3-01 through E3-03 are complete locally: 19 of the 33 tracked tasks are complete, with 14 tasks pending in later phases.
The Phase 1 follow-up was merged as PR #22 at bad27a1.
Phase 2 was merged as PR #23 at 217d857.
Phases 3, 4, and 5 are local and uncommitted on feat/planner-and-delivery-verification.
See the [Phase 3/4 implementation record](phase-3-4-implementation-record.md) for verification results, setup, and provider limitations.
The Phase 5 full run passed 1,074 tests, all workspace typechecks, both production builds, and repository-wide Biome checks.
Six real-sandbox tests and two opt-in screenshot tests were skipped in that run.
See the [Phase 5 negotiation record](phase-5-negotiation-record.md) for implementation, migration, setup, and validation boundaries.
The PR readiness review found and corrected a CI database URL mismatch; the Phase 2 runtime and workflow tests now pass with CI's separate database URLs.
See the [Phase 2 runtime record](phase-2-runtime-record.md) for behavior, migration, command results, and limitations.
Earlier evidence remains in the [Phase 0 audit](phase-0-audit.md), [Phase 1 completion record](phase-1-completion-record.md), and [review correction record](pr-review-fixes.md).
Real provider validation, remote CI, deployment, and full product end-to-end proof remain unverified.
Every status below requires its completion evidence; skipped tests do not establish completion.

## Source plans

- [Design specification](superpowers/specs/2026-10-08-tranche-design.md).
- [Integration contract](superpowers/plans/2026-10-08-01-integration-contract.md).
- [E1 runtime and planner](superpowers/plans/2026-10-08-e1-agent-runtime-planner.md).
- [E2 verifier and GitHub](superpowers/plans/2026-10-08-e2-verifier-github.md).
- [E3 negotiation](superpowers/plans/2026-10-08-e3-negotiator.md).
- [E4 monitoring, notifications, dashboard](superpowers/plans/2026-10-08-e4-monitor-notify-dashboard.md).
- [E5 evals, deployment, end-to-end, launch](superpowers/plans/2026-10-08-e5-evals-deploy-e2e-launch.md).

## Rules for every phase

- Keep PayPal in sandbox mode and do not use live credentials.
- Let agents read data and insert typed `proposed_action` rows; only the policy engine may authorize money movement.
- Keep `packages/core` pure, with shared Zod shapes in `packages/contracts`.
- Route PayPal writes through a durable outbox with stable `PayPal-Request-Id` values, and verify and deduplicate webhooks before applying them.
- Keep funding, renewal, and automatic release as deterministic scheduled actions.
- Require machine checks before AI judgment; treat delivered pages, PRs, and notes as untrusted.
- Preserve deal ownership checks on every action, milestone, evidence item, dispute, and negotiation reference.
- Use `pnpm` and the pinned workspace tools; do not edit generated files by hand.
- Do offline implementation and fake-provider testing first; each real sandbox money run needs a concrete operator allowance and exposure calculation.

## Execution phases and checkpoints

Implement one selected phase per implementation request and finish with a reviewable result before starting the next phase.
At each checkpoint, report changed files, behavior delivered, checks actually run, remaining risks, and the next recommended phase.
Update the status and pending checklist in the same change, marking only verified work complete.
If a phase uncovers a prerequisite outside its scope, record it and adjust the sequence before expanding implementation.
The workstream sections below retain the original task IDs and acceptance criteria; this table determines execution order.

| Phase | Scope and task IDs | Result to review before continuing |
| --- | --- | --- |
| 0: Baseline audit | Inspect BASE-01 interfaces, direct PayPal writes, recovery behavior, and test setup | A concrete file-level audit and reproduction plan for the six F0 issues; record corrective work separately and keep BASE-01 open until required fixes are verified |
| 1: Money foundation fixes | F0-01 through F0-06, then P7-01; close the write-path corrections identified by BASE-01 | Existing money operations recover safely, test configuration works, and the selected payment path is documented |
| 2: Agent runtime | E1-01 and E1-02, plus only the shared fake-model and replay-harness foundations from E5-03 and E5-01 | A structured agent decision becomes one typed proposal through a workflow, with schema, ownership, and duplicate-event checks |
| 3: Brief to plan | E1-03 and E1-04 | An authenticated agency submits a brief, receives a validated draft, and reviews or edits it in the existing workspace |
| 4: Delivery verification | E2-01 through E2-04 | GitHub or manual delivery is verified against the exact delivery ID, with safe URL checks and machine checks that AI cannot override |
| 5: Negotiation | E3-01 through E3-03 | Two sides exchange bounded offers and either agree to the current plan version or escalate to a human |
| 6: Monitoring and communication | E4-01 through E4-03 | Risk monitoring proposes actions, approval/plan/funding emails retry safely, and the workspace dashboard shows scoped data |
| 7: Offline end-to-end proof | Finish E5-01 and E5-03; implement E5-04 and the local/CI portions of E5-05 | Replay evals and happy, rejected-delivery, and slip journeys pass against isolated fakes |
| 8: Deployment readiness | E5-02, deployment portions of E5-05, and SBX-01 | Web, workflows, cron, health checks, and deployment configuration are prepared, with a concrete bounded sandbox run sheet |
| 9: Real sandbox validation | SBX-02 and SBX-03, after the concrete run allowance | Real onboarding, webhook, funding, verification, and release evidence is recorded, with observed PayPal mismatches corrected |
| 10: Freeze and submission | E5-06, DONE-01, and DONE-02 | Final checks, UI review, deployment smoke evidence, demo, and submission artifacts are complete |

Phase 1 is itself delivered in small slices: first local DB/test configuration and pure budget rules, then pre-dispatch/referral recovery, then lost-order recovery and P7, then the product write-path corrections identified in the [Phase 0 audit](phase-0-audit.md).
The original combined F0 PR request was superseded by the merged PR #20/#21 slices; this follow-up completes the remaining Phase 1 scope against their merged baseline.
Starting fake-model and eval foundations in Phase 2 does not complete E5-01 or E5-03; their full acceptance gates remain in Phase 7.
Bring the email foundation forward from Phase 6 only if an earlier flow requires it, and record that dependency explicitly.
Phase 8 prepares deployment; record provider readiness and any release approval required before publishing changes.
Earlier slice results remain in the [slice 1 record](phase-1-slice-1-record.md) and [slice 2 record](phase-1-slice-2-record.md).
The next recommended scope is Phase 6, covering E4-01 through E4-03: monitoring, durable notifications, and the workspace dashboard.
Phases 6 through 10 remain pending; local runtime completion does not establish sandbox, deployment, or end-to-end product completion.

## Workstream: existing money path and interfaces

| ID | Status | Work and deliverable | Completion evidence |
| --- | --- | --- | --- |
| BASE-01 | Complete locally | Reconcile the actual Lane H interfaces with the integration contract, trace onboarding, funding, webhook, renewal, capture, refund, and manual scripts for direct PayPal writes, and define durable intent/outbox fixes where required | An interface map and tests show that each business write has a stable request ID, recovery path, and verified inbound confirmation before the end-to-end claim |
| F0-01 | Complete locally | Separate pre-dispatch failure from a dispatched PayPal write; retry or reapprove only when no write was dispatched, and provide a separately approved void path for an open authorization after failed capture preparation | Failure injection covers OAuth, readiness, status reads, dispatched uncertainty, and capture cleanup without duplicate calls |
| F0-02 | Complete locally | Recover a lost create-order response using the original stable identity or authoritative operator adoption of a known order ID, with identity and amount checks | A lost response neither creates a replacement order blindly nor releases committed budget falsely |
| F0-03 | Complete locally | Correct local Postgres examples for host port 5433 while retaining service-internal port 5432 and the isolated test database configuration | Local setup instructions and example environment match `docker-compose.yml` |
| F0-04 | Complete locally | Pass `TEST_DATABASE_URL` into the actual Turbo test task and prove the guarded runner database suite executes | Test logs show the DB suite ran rather than silently skipping; read installed Turbo docs before configuration changes |
| F0-05 | Complete locally | Add fenced lease recovery for a crash during `apply-referral-recovery`, preserving the same operation identity and reservations | Crash and retry tests show no duplicate POST and exact budget counts |
| F0-06 | Complete locally | Move `paymentStageCalls`, `paymentTotalCalls`, and `paymentApproval` from contracts to pure core, updating imports and tests without a dependency cycle | Core property/unit tests and affected package typechecks pass |
| P7-01 | Complete locally | Record the chosen authorization hold and `agency_pays` payment path in a PayPal decision document; mark P5 multi-payee and P6 Payouts deferred | Decision states what earlier F0 evidence proves, what product validation remains, and what cannot yet be claimed |

The six F0 follow-ups and P7 decision are now implemented across the merged slices and this Phase 1 follow-up.
Use `docs/paypal/f0-plan.md` as the starting evidence for the P7 decision and save the decision under `docs/paypal/`.
Do not confuse the October 12 F0 authorization capture with proof that onboarding, webhook intake, and the full product route work.

## Workstream: E1 runtime and planner

| ID | Status | Work and deliverable | Completion evidence |
| --- | --- | --- | --- |
| E1-01 | Complete locally | Build `packages/agents` model routing, structured outputs, untrusted-input wrapper, read-only tools, and a stable database-free decision boundary (`decideAction`); domain functions such as `draftPlan` follow in their owning phases | Schema tests reject malformed output and hostile brief content cannot become instructions or invoke money tools |
| E1-02 | Complete locally | Add the proposal writer and Render Workflows consumers in `apps/agents`, using the current DB and money service contracts | Duplicate event delivery makes at most one logical proposal and every resource belongs to the deal |
| E1-03 | Complete locally | Implement planner constraints, dependency validation, priced milestones, acceptance criteria, and a draft-plan API | Unit tests and a brief-to-plan integration case cover invalid budgets, cycles, dates, and a valid saved draft |
| E1-04 | Complete locally | Connect the authenticated agency brief flow to plan review and the existing Gantt, with empty, loading, failure, light, and dark states | A member can create and edit a draft through the UI; unauthenticated and cross-workspace calls fail |

Use the existing Better Auth flow and server helpers, rather than an older development login shim.
Freeze db-free decision function contracts before wiring workflows so evals exercise production logic.
When the model is unavailable, only model-dependent jobs pause; deterministic money timers and machine-only verification continue.
The production registry now consumes deal.created for planning, milestone.verification_requested for exact-delivery verification, and negotiation.started for bounded negotiation.
Independent consumer retries allow later machine-only deliveries to proceed while an earlier model-dependent delivery is paused.
Generated migration 0012 adds per-event consumer receipts and must be applied before the new consumers run against an application database.
E5-01 and E5-03 remain pending: Phase 2 supplies only their scripted-model, replay, and scoring foundations.

## Workstream: E2 verification and GitHub

| ID | Status | Work and deliverable | Completion evidence |
| --- | --- | --- | --- |
| E2-01 | Complete locally | Build URL safety, `url_live`, PageSpeed, screenshot, and image evidence checks; guard DNS, redirects, and browser subresources | SSRF cases reject private targets; an exact `localhost:4020` allowance works only behind a test environment flag and cannot be enabled in production |
| E2-02 | Complete locally | Build a read-only GitHub App reader for PR merge and CI results, including authenticated webhook verification, deduplication, and delayed CI reconciliation | Signed webhooks and repeat deliveries yield one logical delivery; forged hooks and inaccessible repos fail safely |
| E2-03 | Complete locally | Implement machine criteria and structured `judgeDelivery`, applying the current core `verificationGate` semantics | A failed or absent machine check cannot be overridden by the model; `repo: null` fails `pr_merged` and `ci_green` |
| E2-04 | Complete locally | Register verification orchestration on `milestone.verification_requested`, loading the exact referenced `deliveryId` and its original `delivery.detected` inbox row | A merged PR and manual submission on the same milestone verify only the applied delivery; notes up to 2000 characters enter only `untrusted("agency notes", notes, 2000)` in non-system content and never count as evidence |

Screenshot bytes are stored separately in evidence_image by generated migration 0013 and served through authenticated workspace/client routes.
Legacy external images still require the configured trusted evidence origin.
Manual deliveries carry `source: "manual"` with `repo`, `sha`, and `prNumber` set to null.
The verifier may use delivery notes for context but cannot turn them into machine-check proof.

## Workstream: E3 negotiation

| ID | Status | Work and deliverable | Completion evidence |
| --- | --- | --- | --- |
| E3-01 | Complete locally | Implement the structured negotiation protocol, fixture model, private mandate handling, and bounded rounds | Tests reject scope changes, mandate leaks, and non-monotonic concessions |
| E3-02 | Complete locally | Implement initiation, turn runner, offers, and acceptance with current `acceptIssue`, `defaultClientPolicy()`, and `agreeToPlan(db, dealId, expectedPlanVersion)` | Acceptance uses the accepting client or agency side, exactly matches the other side's latest full offer, rechecks version and mandate, and handles all four `agreeToPlan` results |
| E3-03 | Complete locally | Add authenticated negotiation routes, room UI, escalation, and evaluation fixtures | Two-party happy and stale-offer cases pass; a release initiated by the agency still waits for client approval |

## Workstream: E4 monitor, notifications, and dashboard

| ID | Status | Work and deliverable | Completion evidence |
| --- | --- | --- | --- |
| E4-01 | Pending | Add read-only slip/risk detectors and `assessDeal`, with typed monitor proposals and Render consumers | Deterministic schedule changes remain in existing money handlers; duplicate monitor jobs do not multiply actions |
| E4-02 | Pending | Add durable email notification jobs for approval, plan sent, and funding requested events, with recipient checks and private fresh portal links | Retries, expiry, and provider uncertainty are tested; no magic-link token appears in an event payload or logs |
| E4-03 | Pending | Add workspace-scoped dashboard APIs, AG Grid Studio views, and a read-only model proxy | Role and workspace isolation, empty/loading/error states, and currency-separated totals are verified |

Do not claim exactly-once email delivery until provider idempotency and crash recovery are demonstrated.
For `milestone.funding_requested`, consume `{ orderId, approveUrl, title }` and create a fresh client link with `createMagicLink`; the event must never carry a portal token.

## Workstream: E5 evals, deployment, and end-to-end proof

| ID | Status | Work and deliverable | Completion evidence |
| --- | --- | --- | --- |
| E5-01 | Pending | Create a replay-first eval harness and cases for planner, verifier, negotiator, and monitor, including the six demo regressions | Critical safety cases all pass; target scores from the E5 plan are planner 0.80, verifier 1.00, negotiator 0.75, monitor 0.75 without weakening cases |
| E5-02 | Pending | Wire the existing `MONEY_TICK_TASKS`, `RECONCILE_TASK`, and `MONEY_HANDLERS` into health-checked Render cron entry points and a deploy blueprint | Timers and reconciliation run even when Gemini is unavailable; configuration uses current SDK and package APIs |
| E5-03 | Pending | Build isolated fake PayPal, GitHub, model, and email fixtures plus a complete seed for the slip journey | A sent and agreed deal starts with design at D(7) for 5 days, build at D(12) for 5 days, milestone D(7)-D(17), funding Due D(4); moving design to D(14) yields build D(19), milestone D(14)-D(24), funding Due D(11), including after reload |
| E5-04 | Pending | Add Playwright happy, rejected-delivery, and slip-and-replan journeys using actual manual-delivery UI hooks | Tests use `delivery-notes-input`, `delivery-pending-<key>`, `delivery-failed-<key>`, `resubmit-delivery-<key>`, and `delivery-via-pr-<key>` and pass locally |
| E5-05 | Pending | Add eval and end-to-end CI jobs, deployment smoke tests, and runnable setup and submission instructions | CI runs rather than skips expected suites; deployed smoke test records app, agent, cron, DB, and webhook readiness |
| E5-06 | Pending | Prepare the three-minute demo, evidence ledger, final checklist, and feature freeze review | Demo shows brief, plan, fund, deliver, verify, approve/release, and slip; submission assets are ready before the stated deadline |

The slip seed calls `agreeToPlan(db, dealId, planVersion(deal.currency, milestonesOrderedByPosition))` and asserts `"agreed"` before testing funding timers.
Assert the exact UI strings `D(7) - D(17)` and `Due D(4)` before the move, then `D(14) - D(24)` and `Due D(11)` after the move and reload.
Fake-provider tests and replay evals must never fall through to network or paid model calls.

## Sandbox validation and release gates

| ID | Status | Work and deliverable | Completion evidence |
| --- | --- | --- | --- |
| SBX-01 | Pending | Prepare a bounded sandbox run sheet covering credentials, buyer/seller identities, principal, fee, API call count, hold cleanup, and exact commands | A reviewer can approve a concrete run without guessing exposure; no live credentials are used |
| SBX-02 | Pending | After explicit operator allowance, run the real PayPal integration and product path: scopes, referral, webhook registration, manual or portal funding, authorization, capture, void/refund recovery | Write raw observations into `docs/paypal/` for the six open assumptions: scope URLs, assertion encoding, fee placement, referral features, already-done error names, and cumulative refund field |
| SBX-03 | Pending | Correct behavior and documentation from sandbox results, then demonstrate onboarding through release on the product route | Each observed mismatch has a regression test; any unverified capability stays marked unverified |
| DONE-01 | Pending | Run relevant package tests, core property tests, agent evals, typechecks, Biome, build, and three Playwright journeys | Record exact commands, date, result, and environment; investigate skips and failures rather than counting them as passes |
| DONE-02 | Pending | Finish accessibility and light/dark/empty/loading/error review, security pass, deployment smoke test, and submission artifact check | Evidence links and unresolved risks are recorded before the 2026-11-05 feature freeze and the 2026-11-12 12:00 PT submission deadline |

The handoff's suggested `test:sandbox` and manual funding commands can perform multiple $1 payment operations, so count their cumulative exposure before running them.
Earlier F0 evidence showed a specific US-to-US authorization capture; it does not establish all product or seller capabilities.
Create the run sheet and code locally before seeking approval for any new PayPal money write.
The handoff's run sequence is the gated `RUN_PAYPAL_SANDBOX_TEST=1 pnpm --filter @tranche/paypal test:sandbox` suite, real agency onboarding via `/onboarding` and Connect PayPal, webhook registration via `packages/paypal/scripts/register-webhook.ts`, and one milestone funded through the portal or `scripts/fund-manually.ts`.
Document observed sandbox mismatches in `docs/paypal/` and prepare a concise report of incorrect rows for Arpan; sending that report requires a separate explicit instruction.

## Handoff traceability

| Handoff requirement | Tracked by |
| --- | --- |
| Judge the exact applied delivery | E2-04 |
| Keep manual notes untrusted and fail PR/CI without a repo | E2-03, E2-04 |
| Permit only exact test localhost through all URL fetch paths | E2-01, E5-04 |
| Seed a dated, sent, agreed slip deal and assert funding movement | E5-03, E5-04 |
| Use `agreeToPlan` with the current plan version and assert `agreed` | E3-02, E5-03 |
| Use the existing manual-delivery test hooks | E5-04 |
| Validate six PayPal assumptions and product onboarding | SBX-01, SBX-02, SBX-03 |
| Resolve six F0 follow-ups in one PR and record P7 | F0-01 through F0-06, P7-01 |
| Use current deal access, action ownership, and client release policy | BASE-01, E1-02, E3-02 |
| Accept only the opposite side's latest complete negotiation offer | E3-02 |
| Match delivery event and manual payload shapes | E2-03, E2-04 |
| Use fresh links for funding notification and current money tick exports | E4-02, E5-02 |
| Keep `agency_pays` in deployment configuration | P7-01, E5-02 |
| Run local checks while GitHub Actions billing is unresolved | DONE-01 |

## Sequence and dates

The execution phases above are the implementation sequence, with a checkpoint after each phase and separately reviewed slices within the money foundation phase.
The six demo fixes are embedded in E2-01, E2-03, E2-04, E3-02, E5-03, and E5-04, so they cannot disappear into a separate backlog.
Aim to finish implementation and local proof by the November 5 feature freeze, leaving November 6 through 11 for deployment hardening and submission review.
These dates are targets, and externally gated sandbox work remains pending until credentials, budget, and operator allowance are available.

## PayPal observations still required

| Check | Why it matters | Where |
| --- | --- | --- |
| Granted-permission scope URLs match what PayPal returns | A wrong URL leaves every agency stuck at pending after onboarding | `FEATURE_SCOPES` in `packages/paypal` |
| Auth assertion header encoding | We kept your proven standard base64; confirm seller-side reauthorize, capture, void and refund calls accept it | `packages/paypal/src/http.ts`, `docs/paypal/auth-assertion-encoding.md` |
| Platform fee placement | Fee is on the order for delayed disbursement and on the capture for authorization; a double fee is the failure mode | `client.ts` `createFundingOrder`, `releaseHold` |
| Referral features by hold mechanism | With `HOLD_MECHANISM=authorization` we no longer request `DELAY_FUNDS_DISBURSEMENT`; confirm consent works for your seller | `createSellerReferral` |
| "Already done" error names | `AUTHORIZATION_ALREADY_VOIDED` and `CAPTURE_FULLY_REFUNDED` are guesses; a wrong name only means a retry instead of a read-back | `apps/agents/src/money/outbox-handlers.ts` |
| Refund webhook field | `seller_payable_breakdown.total_refunded_amount` drives cumulative refunds | `apps/agents/src/money/paypal-events.ts` |


## Integration changes from the handoff

| Change | Affects | Contract |
| --- | --- | --- |
| `agreeToPlan(db, dealId, expectedPlanVersion)` returns `"agreed" \| "plan_changed" \| "already_agreed" \| "not_agreeable"` | E3 negotiator accept path, E5 seeds | Section 4 |
| `defaultClientPolicy()` takes no argument and always asks before a release | E3 client-side agent proposals | Section 8 |
| A release proposed by anyone but the client side waits for client approval | E3, any agent proposing `release` | H3, `apps/agents/src/money/actions.ts` |
| `accept_plan` must match the other side's latest `negotiation_turn` offer exactly | E3 must write `negotiation_turn` offers | H3, `actions.ts` |
| Every action's milestone, evidence, dispute or negotiation must belong to the action's deal | All agents inserting `proposed_action` | H3, `actions.ts` |
| `deliveryId` in `milestone.delivered` and `milestone.verification_requested`; `notes` on `delivery.detected` | E2 verifier | Section 9 |
| Manual deliveries: `source: "manual"`, `repo`, `sha`, `prNumber` null | E2 verifier | Section 9 |
| `milestone.funding_requested` carries `{ orderId, approveUrl, title }`, never a portal token | E4 notifier emails the client a fresh link from `createMagicLink` | Sections 2 and 3 |
| Only `SUBCONTRACTOR_SPLIT=agency_pays` is supported | E5 `render.yaml` env | `docs/paypal/subcontractor-split.md` |
| Money tick exports: `MONEY_TICK_TASKS`, `RECONCILE_TASK`, `MONEY_HANDLERS` | E5 `cron-tick.ts`, `cron-reconcile.ts` | Section 6 |
