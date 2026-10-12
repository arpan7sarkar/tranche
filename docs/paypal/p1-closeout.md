# P1 closeout review and P2 handoff

Review date: 2026-10-12.
Reviewed code revision: 31fd64a.
P1 tooling status: Complete and revalidated.
Overall P1 status: In progress; this document records completed work and the remaining closeout item rather than declaring unconditional completion.
Next phase: P2, the durable sandbox runner; independent offline implementation may proceed.

## What P1 delivered

Implemented a sandbox-only preflight CLI with default/help, configuration validation, and one-request OAuth authentication modes.
The tool loads the root .env through the package script and documents that existing process values take precedence.
Configuration checks reject missing, blank, malformed, or non-sandbox inputs before any request.
Authentication uses the fixed sandbox token endpoint, a 15-second deadline, manual redirects, and no automatic retries.
The CLI validates token responses in memory and emits only allowlisted summaries; credentials, tokens, and raw provider errors are excluded.
Removed the redundant response.redirected check while retaining rejection of 3xx responses.
Added isolated tests, package command wiring, and TypeScript coverage for the scripts.
Created the operator runbook, access assessment, account-role confirmation plan, readiness plan, evidence template, and contributor handoff.
Prepared the P2 implementation plan without implementing business payment operations.

## Accounts and access evidence

| Role | Assigned account | Recorded evidence |
|---|---|---|
| platform | Business account associated with the Platform Partner app | Screenshot association; correct REST credentials contributor-confirmed; successful historical OAuth |
| buyer | Default Personal account | Account screenshot; browser login and displayed USD 5,000 contributor-confirmed |
| seller-a | Default Business account | Separate account in screenshot; browser login and displayed USD 5,000 contributor-confirmed |
| seller-b | Remaining Business account | Separate account in screenshot; browser login and displayed USD 5,000 contributor-confirmed |

All four accounts are distinct and have country IN in the supplied account-list screenshot.
The contributor reports that the platform account also allows login and displays USD 5,000.
The intended Payouts sender is platform, and the intended recipient is seller-b; these aliases reuse existing accounts rather than adding participants.
Actual payout receipt, usable funding, seller permissions, and USD transaction compatibility remain untested.
The contributor is the identified browser operator and has demonstrated access by reporting successful login checks.
Availability to complete buyer approval and both sellers' consent during a future experiment still needs confirmation at execution scheduling.
Exact account mappings and the sandbox BN code remain in private sources; no values are reproduced in this document.

## Dashboard feature findings

| Area | Observation | What it establishes |
|---|---|---|
| Payouts | Checked in supplied feature screenshot | observed_enabled; receipt not tested |
| Save payment methods / Vault | Checked | observed_enabled; token creation and unattended funding not tested |
| Platform fee | Checked | observed_enabled; actual fee collection not tested |
| Delay disbursement | Checked | observed_enabled; seller grants and capture/release not tested |
| Multiparty settings | Sandbox BN code visible, Business onboarding before payment selected | Configuration observation; partner approval and completed onboarding not proven |

The feature screenshots are cropped; attribution to the platform app follows the contributor's inspection context.
Unknown seller-level and partner permissions have named follow-up owners in the access assessment and are execution prerequisites for later probes.
P1 does not require a successful seller referral, checkout, capture, release, or payout to establish a dashboard observation.

## Authentication and verification

Real sandbox OAuth succeeded on 2026-10-09 and again on 2026-10-11, returning HTTP 200.
The later recorded token lifetime was 32,400 seconds; the token itself was not printed or persisted.
Authentication establishes a working credential pair, not payment-product support.
OAuth was not repeated during the 2026-10-12 audit.

| Check executed on 2026-10-12 | Result |
|---|---|
| pnpm --filter @tranche/agents-service exec vitest run scripts/f0/preflight.test.ts | Passed, 54 tests |
| pnpm --filter @tranche/agents-service typecheck | Passed |
| pnpm biome check apps/agents/scripts/f0/preflight.ts apps/agents/scripts/f0/preflight.test.ts apps/agents/package.json apps/agents/tsconfig.json | Passed, no fixes |
| node --env-file-if-exists=../../.env --import=tsx scripts/f0/preflight.ts --check-config, from apps/agents | Passed, valid sandbox configuration |
| node --import=tsx scripts/f0/preflight.ts --help, from apps/agents | Passed |
| Local Markdown links, whitespace, fences, and no-em-dash audit | Passed across the ten documents present at audit time |
| git diff --check | Passed |

Initial pnpm checks could not fetch registry signature metadata; authorized network-enabled retries passed without bypassing verification or contacting PayPal.
The audit left the working tree clean before this closeout document was written.

## Agreed limits for later testing

- Sandbox only and USD only.
- At most $1 total across all tests and resumes, including sender fees; no automatic reset or increase.
- At most 50 runner-issued API attempts, including OAuth, reads, writes, retries, polling, recovery, and cleanup.
- Before each money-moving test, explain its purpose, sender, recipient, amount, and fee allowance, then wait for explicit contributor approval.
- If the amount is insufficient or a test fails, report the reason and wait for further approval rather than increasing the amount or sending another payment.

These replace the earlier amounts in the original image and historical session records.
Budget and approval enforcement belongs to P2 and does not exist in the current preflight CLI.

## P1 completion review

| Planned completion criterion | Review result |
|---|---|
| Preflight, isolated tests, and TypeScript coverage | Complete and revalidated |
| Reproducible operator runbook | Complete |
| Account inventory with facts or explicit gaps and owners | Recorded; known payout-role sharing reconciled, transaction readiness explicitly unknown |
| Dated dashboard observations distinct from API evidence | Recorded |
| Real sandbox authentication evidence | Complete, historical results retained |
| Participants and browser operator | Accounts and access recorded; future experiment availability pending |
| Budget proposal and remaining confirmations | Current $1 and 50-call rules agreed; enforcement planned in P2 |
| Handoff and next implementation phase | Recorded; P2 starts with contracts and durable storage |
| No business writes and capabilities not_tested | Preserved |

The P1 tooling implementation is complete.
The assessment remains in progress under the existing handoff until the contributor's availability for future buyer approval and seller consent is recorded and the phase status is explicitly closed.
Do not ask the contributor to repeat account identification, credential confirmation, or login checks that are already recorded.
Do not confuse later successful seller consent and payment execution with P1 implementation work.

## Next phase: P2

Follow the [P2 sandbox runner implementation plan](p2-sandbox-runner-implementation-plan.md).

1. Define shared Zod contracts and pure budget/approval checks.
2. Add durable allocation, run, approval, outbox, attempt, and browser-wait records.
3. Implement atomic reservations, persistent counters, and duplicate-prevention/recovery rules.
4. Add sandbox transport with counted requests and endpoint-specific adapters.
5. Add operator commands to start, inspect, approve, resume, and report.
6. Verify the foundation with offline and disposable-database tests before preparing a concrete payment experiment.

Offline P2 implementation can proceed while the scheduling and later payment prerequisites remain explicit.
No payment is authorized by this handoff or by approval of the runner plan.
Every capability remains not_tested until a later eligible sandbox probe produces authoritative evidence.

## Related records

- [P1 implementation plan](p1-implementation-plan.md).
- [P1 operator runbook](p1-runbook.md).
- [Access assessment and dated evidence](evidence/p1-access-assessment.md).
- [Account-role confirmation](p1-account-role-confirmation-plan.md).
- [Current F0 handoff](f0-status.md).
