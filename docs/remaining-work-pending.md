# Remaining work pending checklist

Use the stable IDs in the [implementation plan](remaining-work-implementation-plan.md) and update the [status tracker](remaining-work-status.md) when evidence is recorded.
F0-03, F0-04, and F0-06 are complete locally as of 2026-10-15, with evidence in the [Phase 1 slice 1 record](phase-1-slice-1-record.md).
Follow the execution phases in the plan, completing one selected phase per implementation request.
Phase 0 inspection is complete in the [audit report](phase-0-audit.md), and the next recommended scope is Phase 1 slice 2 for pre-dispatch and referral recovery.
For partial tasks shared between phases, record completed substeps in the status tracker and leave the task unchecked until all acceptance criteria pass.

## Existing path and F0

- [ ] BASE-01: The audit is complete; close the identified durable outbox and request-ID gaps and verify recovery before completing this unit.
- [ ] F0-01: Recover pre-dispatch failures without consuming approval; add separately approved open-authorization cleanup after capture preparation fails.
- [ ] F0-02: Recover a lost create-order response under the original identity without duplicate orders or false budget release.
- [x] F0-03: Correct host port 5433 examples while preserving internal port 5432 and the guarded test DB setting.
- [x] F0-04: Forward `TEST_DATABASE_URL` in Turbo and prove runner DB tests execute; remote CI execution remains unverified.
- [ ] F0-05: Recover `apply-referral-recovery` from a crash using a fenced lease and the original operation.
- [x] F0-06: Move pure payment budget rules into core and update dependents and tests.
- [ ] P7-01: After the six F0 fixes, write the authorization plus `agency_pays` decision under `docs/paypal/`, with P5/P6 deferred and evidence limits explicit.

## E1 runtime and planner

- [ ] E1-01: Implement structured model decisions, untrusted handling, and read-only agent tools.
- [ ] E1-02: Persist typed proposals and register idempotent Render agent consumers.
- [ ] E1-03: Validate and save complete draft plans from briefs.
- [ ] E1-04: Connect authenticated brief and Gantt review UI with all required UI states.

## E2 verifier and GitHub

- [ ] E2-01: Implement safe URL, PageSpeed, screenshot, and image checks with exact test-only localhost allowance.
- [ ] E2-02: Implement signed GitHub webhook intake, read-only PR/CI queries, and CI reconciliation.
- [ ] E2-03: Gate model judgment on machine checks and fail PR/CI criteria when repo is null.
- [ ] E2-04: Verify the event's exact delivery ID, read its notes from the same inbox row, and keep notes untrusted and non-evidentiary; handle manual deliveries with null repo, SHA, and PR number.

## E3 negotiator

- [ ] E3-01: Implement structured turns, bounded concessions, private mandates, and fixtures.
- [ ] E3-02: Add version-safe acceptance that matches the other side's latest offer and handles every `agreeToPlan` result.
- [ ] E3-03: Add authenticated room, routes, escalation, and negotiation evals.

## E4 monitor, notification, dashboard

- [ ] E4-01: Add read-only risk detection and typed monitor proposals.
- [ ] E4-02: Add durable approval, plan, and funding emails; use the funding event's order ID, approval URL, and title to create a fresh private portal link with retry evidence.
- [ ] E4-03: Add workspace-scoped dashboard and AG Grid views with currency-separated totals.

## E5 evals, deploy, end-to-end

- [ ] E5-01: Build replay-first evals with critical safety cases and stated score thresholds.
- [ ] E5-02: Wire money tick, reconciliation, health, and Render deployment entry points.
- [ ] E5-03: Build isolated fakes and a sent, agreed slip seed that calls versioned `agreeToPlan` and asserts exact `D(7) - D(17)`/`Due D(4)` to `D(14) - D(24)`/`Due D(11)` strings.
- [ ] E5-04: Pass happy, rejected, and slip Playwright journeys using the actual manual-delivery hooks.
- [ ] E5-05: Run eval and end-to-end CI, deployed smoke checks, and setup/submission instructions.
- [ ] E5-06: Prepare demo video, evidence ledger, and pre-freeze submission review.

## Sandbox and completion

- [ ] SBX-01: Prepare a concrete run sheet for the PayPal suite, `/onboarding`, webhook registration, and portal/manual funding, with sandbox identities, principal, fees, API calls, cleanup, and cumulative exposure.
- [ ] SBX-02: With explicit operator allowance, record real sandbox observations for scopes, assertion encoding, fee placement, referral features, already-done errors, and refund amount fields.
- [ ] SBX-03: Fix observed mismatches and prove onboarding through release on the product route.
- [ ] DONE-01: Record passing relevant tests, evals, typechecks, Biome, build, and all three Playwright journeys; resolve skips and failures.
- [ ] DONE-02: Record UI state/accessibility, security, deployment, and submission readiness evidence.

Do not check SBX-02 because offline tests passed; it requires the actual bounded sandbox run and its recorded observations.
Record PayPal mismatches in `docs/paypal/` and prepare the requested report of incorrect rows for Arpan when results exist.
