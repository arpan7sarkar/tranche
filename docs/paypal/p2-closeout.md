# P2 closeout and P3 handoff

Date: 2026-10-12.
Status: Complete for the reviewed offline runner foundation scope.
Code state: Local implementation and tests; this document does not establish a commit, push or merge.
Evidence: [Implementation record](p2-implementation-record.md) and [operator runbook](p2-runbook.md).

## What P2 completed

P2 built deterministic operator tooling to prepare, approve, inspect, resume and report future sandbox experiments.
Shared contracts describe operations, exact requests, approvals, allocations, browser waits and sanitized results.
Pure core checks enforce budget eligibility and approval matching without I/O.
Seven database tables persist the allocation, runs, commitments, outbox operations, approvals, attempts and browser waits.
The store uses transactional reservations and claims, immutable payload hashes, unique operation identities and claim tokens to coordinate competing workers.
The commitment ledger counts principal once through a payment lifecycle while reserving each operation's fee bound.
The sandbox transport counts authentication and reads, requires outbox permits and request IDs for business writes, and uses finite timeouts, manual redirects and no automatic retries.
The runner supports bounded read-only recovery after interrupted or ambiguous dispatches.
Private browser artifacts and ordinary reports remain separate.
The existing P1 preflight and original MilestoneState were preserved.

## Completion evidence

| Planned foundation criterion | Evidence |
|---|---|
| Durable progress and shared limits across restarts | Actual disposable PostgreSQL tests, including reopened connections |
| Atomic money and request accounting | Concurrent reservation, shared allowance, fee and exhaustion scenarios |
| Concrete approval gating | Unapproved execution blocked; changed payloads, stale approvals and reused approvals rejected |
| Duplicate prevention and ambiguous recovery | Competing workers, consumed dispatch claims and fenced recovery exercised |
| Browser waits and private reporting | Wait persistence, counted status reads and private-artifact tests |
| Sandbox-only transport | Injected HTTP tests for destinations, redirects, malformed responses, errors and request accounting |
| Package integration | Five package typechecks and 20-file Biome check passed |

Both the implementation verification and the subsequent user-requested retest passed 109 tests.
The total includes 54 P1 regressions, 10 contract tests, 5 core tests, 17 transport tests and 23 runner/artifact tests.
Eighteen of the runner tests used real disposable PostgreSQL; none of those scenarios were skipped in the recorded runs.
Core verification also exercised 1,000 generated budget combinations.
Generated migrations were reviewed and applied only to the isolated test database.
The test container was stopped after each verification session.
No real PayPal OAuth or business requests were made during P2 implementation or its retest.

## Boundaries of this closure

P2 closes the runner foundation, not the PayPal capability assessment or F0 as a whole.
The CLI currently registers no real business adapters, and its generic capability report remains not_tested.
Endpoint payload validation, merchant permission checks, applicable fees and authoritative business-state interpretation remain P3-P6 work.
Provider-resource persistence, selected partner headers and any required structured status-query support must be extended deliberately for those adapters.
Failed or ambiguous operations retain money reservations conservatively; automatic reclamation and business-write resending are not implemented.
The application database has not received the test migrations through this work; inspect its intended configuration and apply reviewed migrations before real runner use.
P1's future browser-operator availability item remains open and must be arranged before browser-dependent experiments.
Existing login, credential and account-role confirmations should not be repeated merely to establish context.

## Limits carried forward

- Sandbox only; USD only.
- At most $1 total, including sender fees, across all tests and resumes.
- At most 50 runner-issued API attempts, including OAuth, reads, writes, retries, recovery, polling and cleanup.
- No new run, database switch or phase label may reset the authorized allowance.
- Before each money-moving test or subsequent money-moving dispatch, explain purpose, sender, recipient, principal and fees and wait for explicit contributor approval.

Read the actual authorized allocation before execution; this closeout does not assert that an uninspected database has a fresh allowance.

## Next phase and order

1. Follow the [P3 seller-onboarding implementation plan](p3-seller-onboarding-implementation-plan.md).
2. Extend the foundation only where needed for durable referral references, private mappings, controlled headers and authoritative status reads.
3. Verify those changes offline and against a disposable database before requesting real sandbox onboarding execution.
4. Complete seller-a consent and retrieve its readiness and granted permissions, or record the exact blocker.
5. Follow the [P4 payment-protection implementation plan](p4-payment-protection-implementation-plan.md) for one eligible single-seller path and its separately approved payment test.

No seller referral, account change or payment is authorized by this closeout.
Use the [F0 handoff](f0-status.md) for current phase and capability status.
