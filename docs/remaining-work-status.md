# Remaining work status

Observed on 2026-10-15 against local `main` at `81b5098` after synchronizing with `upstream/main`.
The source is [the handoff](remaining_work.md), reconciled with the [implementation plan](remaining-work-implementation-plan.md) and [pending checklist](remaining-work-pending.md).
This document records observation, not assumed completion from a plan.

## Execution checkpoint

The implementation plan now defines Phases 0 through 10, with one phase delivered per implementation request.
Current checkpoint: Phase 0 inspection and Phase 1 slice 1 are complete; see the [audit report](phase-0-audit.md) and [implementation record](phase-1-slice-1-record.md).
Recommended next scope: Phase 1 slice 2, reproducing and fixing pre-dispatch failure recovery and expired referral-recovery claims.
BASE-01 remains open because its corrective work and acceptance tests are pending.
After each phase, record its changed files, checks, results, remaining issues, and recommended next scope here.

## Current state

Lane H is merged on main according to the handoff, with core policy, PayPal, inbox/outbox actions, deterministic timers, and the web UI available for Lane E integration.
Lane E implementation has not started in this snapshot: `packages/agents/src/index.ts` and `packages/verifiers/src/index.ts` are placeholders, and `apps/agents/src/agents/` is absent.
F0-03, F0-04, and F0-06 are implemented and verified locally; F0-01, F0-02, F0-05, and P7 remain pending.
Phase 1 slice 1 ran focused package and DB integration tests, with 414 tests passing and two real-sandbox tests intentionally skipped across the recorded commands.
No real PayPal calls were performed, and the CI workflow has not been run remotely.
Historical F0 sandbox evidence is narrower than a full product-path validation.

| Workstream | Units | Observed status | Next gate |
| --- | ---: | --- | --- |
| Existing Lane H integration audit | 1 | Pending | Map real entry points and durable PayPal write paths. |
| F0 follow-ups | 6 | 3 complete; 3 pending | Reproduce and fix pre-dispatch and referral recovery next. |
| P7 payment decision | 1 | Pending | Record selected path and evidence limits. |
| E1 runtime and planner | 4 | Not started | Build structured agent runtime and draft flow. |
| E2 verifier and GitHub | 4 | Not started | Build exact-delivery verification and safe checks. |
| E3 negotiator | 3 | Not started | Implement offers against current contract. |
| E4 monitor, notification, dashboard | 3 | Not started | Build durable jobs and workspace views. |
| E5 eval, deploy, end-to-end | 6 | Not started | Run replay evals and three journeys. |
| Real sandbox proof | 3 | Preparation pending; live run externally gated | Prepare exposure sheet, then obtain concrete run allowance. |
| Completion gates | 2 | Pending | Run and record required checks and submission review. |

There are 33 tracked units in this plan, with 3 implementation units verified complete locally.
Phase 1 remains partially complete, and BASE-01 still requires corrective work.

## Task-level status

| IDs | Status | Evidence still needed |
| --- | --- | --- |
| BASE-01 | Audit complete; corrections pending | Durable write-path fixes and dynamic recovery evidence from the Phase 0 report. |
| F0-01, F0-02, F0-05 | Pending | Recovery fixes and dynamic regression evidence. |
| F0-03 | Complete locally | Port mismatch reproduced and corrected in setup and command examples. |
| F0-04 | Complete locally; remote CI unverified | Root task executes all 97 F0 DB cases; guarded migration and CI fixture configured. |
| F0-06 | Complete locally | Pure functions moved to core with tests and consumer typechecks passing. |
| P7-01 | Pending | Written decision and bounded evidence statement. |
| E1-01, E1-02, E1-03, E1-04 | Not started | Runtime, planner, API, and UI evidence. |
| E2-01, E2-02, E2-03, E2-04 | Not started | Safety, GitHub, machine checks, and exact-delivery evidence. |
| E3-01, E3-02, E3-03 | Not started | Protocol, runner, room, and eval evidence. |
| E4-01, E4-02, E4-03 | Not started | Monitor, email, and dashboard evidence. |
| E5-01, E5-02, E5-03, E5-04, E5-05, E5-06 | Not started | Evals, deploy, seed, journeys, CI, and demo evidence. |
| SBX-01 | Pending | Concrete sandbox exposure and command run sheet. |
| SBX-02 | Gated | Explicit run allowance, then six observed PayPal results. |
| SBX-03 | Pending | Corrections and full product-path proof. |
| DONE-01, DONE-02 | Pending | Dated verification and submission records. |

The handoff reports a GitHub Actions billing failure; this documentation pass did not independently recheck its current state.

## Known integration risks

- The verifier must use the `deliveryId` on `milestone.verification_requested`; selecting the newest milestone delivery can judge the wrong submission.
- Manual notes are untrusted and cannot satisfy acceptance evidence; `repo: null` must fail PR and CI criteria.
- The localhost exception for end-to-end checks must be exact, test-only, and cover redirects and browser subresources.
- The slip journey seed must create a sent and agreed plan with dates before asserting funding movement.
- Negotiation acceptance must use current side and version rules, including all four `agreeToPlan` outcomes.
- Direct PayPal write paths need an outbox/idempotency audit before claiming the design invariant is met end to end.
- TEST_DATABASE_URL forwarding and host-port corrections are verified locally; the new CI fixture still needs a remote run.
- A prior F0 authorization capture does not prove current product onboarding, webhook, or release paths.
- The handoff's `test:sandbox` and manual funding commands may perform multiple $1 operations, so the suggested sequence is not yet a bounded one-payment run.
- Sandbox spend and recovery exposure are unknown until the run sheet is prepared; no new real money run is authorized by this document.

## Evidence needed to update status

Mark a unit complete only after its deliverable exists, its completion evidence in the plan has been checked, and the command or inspection result is recorded with a date.
Mark a failed or skipped test as pending, with the reason and next action.
Record external gates separately from code progress, especially sandbox credentials, payment allowances, provider features, and hosting readiness.
