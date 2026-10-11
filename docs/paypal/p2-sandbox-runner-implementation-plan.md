# P2 sandbox runner implementation plan

Date: 2026-10-11.
Status: Planning complete; runtime implementation and payment execution have not started.
Parent: [F0 capability plan](f0-plan.md).
Prerequisites and observations: [access assessment](evidence/p1-access-assessment.md).
Broader setup: [sandbox readiness plan](sandbox-readiness-implementation-plan.md).
Current handoff: [f0-status.md](f0-status.md).

## Outcome

Build a deterministic operator CLI that can prepare, pause, resume, and report sandbox experiments with durable budget enforcement and payment approval.
The runner is operator tooling, not an AI agent, and must not give agents money-moving tools.
Implementation starts with contracts and durable storage; live sandbox payment tests follow only after offline verification and explicit approval for a concrete test.
This plan does not authorize a payment, account change, or budget increase.

## Confirmed inputs and remaining prerequisites

Four distinct accounts are assigned: Personal buyer, Business platform, default Business seller-a, and remaining Business seller-b.
Account types and country IN come from supplied screenshots; successful login and USD 5,000 displayed in each are contributor-confirmed.
The platform REST credential association is contributor-confirmed, and earlier real sandbox OAuth succeeded.
Payouts, Vault, platform fees, and delayed disbursement appear checked in the supplied feature screenshots.
Those settings do not establish granted seller permissions or working payment operations.
Use the supplied screenshots in the ignored sources directory as existing private evidence rather than requesting the same inventory again.
The intended payout route is platform to seller-b; retain the exact participant identifiers and BN code privately before implementing that adapter.
Future browser-operator availability, seller consent, endpoint prerequisites, actual USD transaction support, and usable payout funding remain execution gates.
Offline runner implementation can proceed while those execution gates are unresolved; P1 must retain its remaining gaps explicitly.

## Agreed execution limits

| Rule | Required behavior |
|---|---|
| Environment | Sandbox only; no live host or live configuration option |
| Currency | USD only, represented as integer cents |
| Total spend | At most 100 cents across all tests and resumes, including sender fees |
| Per-test spend | Must fit within the remaining shared 100-cent allowance |
| API requests | At most 50 runner-issued PayPal API attempts across the same allocation |
| Counted requests | OAuth, reads, business writes, retries, polling, recovery, and cleanup |
| Browser traffic | Record browser actions separately; do not claim to count PayPal's internal browser requests |
| Payment approval | Explain purpose, sender, recipient, amount, and fee allowance before each money-moving dispatch and wait for explicit contributor approval |
| Failures and increases | Report failure or insufficient budget; do not increase limits or send another payment automatically |
| Reset behavior | New runs, restarts, or another campaign label must not create another allowance |

The contributor accepted the 50-call accounting after its explanation in this conversation.
The earlier standalone preflight calls are dated historical checks, outside the future runner allocation; do not repeat them merely for context.
All OAuth or diagnostic calls issued as part of an active runner experiment must use that allocation's request counter.
Detailed lifecycle reservation rules below are conservative implementation choices derived from these limits and must be documented in the runbook.
Use one explicit allocation record for this authorized testing session; increasing or replacing it requires a new contributor instruction, never a CLI default.

## Step 1: Define shared contracts and pure checks

Add Zod schemas in packages/contracts for participant aliases, allocation, run, operation, approval summary, browser wait, attempts, and capability report.
Keep MilestoneState unchanged and export the new schemas through the existing package entry point.
Operations must identify their kind, intended participants, resource references, exact payload version, and principal and fee reservations.
Define which operations can create a commitment or move money; classify unknown kinds as non-executable.
Represent states such as prepared, awaiting_approval, ready, dispatching, waiting_for_browser, recovering, succeeded, failed, blocked, and inconclusive.
Keep schema validation separate from pure budget and approval eligibility checks in packages/core.
Core checks take explicit snapshots and return typed decisions without network, database, environment, or clock reads.
Reject non-USD currency, fractional or negative cents, larger allocations, missing mappings, and payload changes under an existing operation identity.
Verify these boundaries with focused unit tests and property tests for the pure budget rules.

## Step 2: Add durable allocation, approval, and outbox storage

| Proposed record | Required responsibility |
|---|---|
| sandbox_allocation | Authorized 100-cent and 50-attempt limits, committed/reserved amounts and calls, current status |
| sandbox_run | Experiment kind, allocation reference, participant aliases, progress and outcome |
| sandbox_operation | Outbox intent, operation identity, payload hash, stable request ID, resource references, claim and recovery state |
| sandbox_approval | Explicit human decision bound to the operation, participants, payload, amount, fee bound, and dispatch attempt |
| sandbox_attempt | Every reserved request attempt, dispatch evidence, sanitized outcome, and timing |
| sandbox_browser_wait | Expected buyer approval or seller consent and the resource to confirm on resume |

Integrate these records through packages/db/src/schema.ts and the existing Drizzle configuration.
Store exact merchant mappings and provider references in access-controlled storage; keep secrets, raw provider responses, and token-bearing browser links out of reports.
Use database transactions and row locking or equivalent atomic updates to claim work, check approval, reserve budgets, and record attempts.
Use unique constraints for operation identity, request identity, allocation ownership, and endpoint-specific duplicate keys.
A second worker must not dispatch an operation already claimed or in an ambiguous state.
An expired claim enters recovery instead of becoming permission to send again.
Do not promise that database locks alone guarantee exactly-once behavior across a network; unresolved dispatches require endpoint-specific recovery.
Generate migrations with pnpm --filter @tranche/db db:generate and review them before applying to a disposable database with explicit environment loading.
Do not hand-edit generated migration files or run migration generation concurrently with another contributor.

## Step 3: Enforce persistent money and API accounting

Maintain committed plus reserved spend at or below 100 cents and reserved or consumed requests at or below 50.
Reserve principal and a justified upper bound for sender fees before an operation can create a payment commitment.
If no trustworthy fee bound is available, stop before dispatch and report the gap; a guessed zero fee is insufficient.
Count an order's principal once across authorization, capture, and referenced release rather than charging the allowance again for each lifecycle step.
Count a separate payout or replacement order as new principal, even when its amount matches a previous order.
Sum all purchase units and payout items before checking the shared limit.
Do not replenish the allowance after refunds or other cleanup.
Release an unused reservation only when authoritative evidence establishes that no commitment occurred.
Keep ambiguous principal reserved while recovery is incomplete.
Reserve one API attempt before every dispatch, including OAuth and recovery reads.
Conservatively consume an attempt after a crash if dispatch cannot be excluded; do not promise perfect counting of packets the process cannot observe.
Reserve enough remaining API allowance for a bounded confirmation and recovery path before starting an experiment.
Stop at exhaustion even if a resource remains pending; report unresolved work rather than issuing extra cleanup calls.
Test concurrent reservations, 100-cent and 50-attempt boundaries, split amounts, sender fees, restart persistence, refunds, and ambiguous commitments against a disposable database.

## Step 4: Implement sandbox transport and endpoint recovery contracts

Build sandbox-only configuration, OAuth, transport, typed operation adapters, and sanitized errors in packages/paypal.
Inspect the installed SDK and official endpoint documentation before choosing SDK calls or direct fetch adapters.
Disable hidden retries and automatic redirects, and make each actual request pass through the persistent request counter.
Cache OAuth tokens in memory until expiry; never persist or print access tokens.
Use fixed API sandbox destinations and reject untrusted resource URLs before attaching credentials.
Validate browser destinations separately and never forward API authorization headers to them.
Every business write must originate from the durable outbox and include PayPal-Request-Id, as required by AGENTS.md.
For each adapter, document request-ID support and retention, duplicate keys, authoritative recovery reads, expected terminal states, and bounded polling behavior.
If the endpoint has no proven safe recovery path, leave an ambiguous operation inconclusive rather than blindly retrying.
Preserve the existing preflight modes, output, exit codes, manual redirects, and one-attempt behavior; do not route runner authentication through an uncounted preflight subprocess.
Test redirects, malformed responses, timeouts, denied permission, rate limits, secret-bearing failures, and exactly one transport dispatch per reserved attempt.

## Step 5: Implement human approval and restart-safe browser waits

Prepare a concrete payment summary containing the experiment's purpose, sender alias, recipient alias or aliases, amount, fee bound, remaining budget, and expected result.
For assistant-operated tests, present that summary in conversation and wait for the contributor's explicit approval before recording the approval through the trusted local operator interface.
Starting the runner, approving this plan, or approving PayPal checkout in the browser is not a substitute for that payment-test approval.
Bind recorded approval to the immutable operation payload and attempt; altered amounts, participants, fees, or payloads require a new approval.
Reserve money before order creation and obtain approval for the experiment before any operation can create a commitment, even if that first operation does not immediately move funds.
Require a fresh approval before each subsequent money-moving operation, including capture, release, payout, or money-moving cleanup.
Do not automatically retry a money-moving write; first perform bounded authoritative recovery reads, then request fresh approval if a supported resend is necessary.
A retry reuses the original operation identity and provider duplicate keys and does not create fresh principal automatically.
Consume approval atomically with the dispatch claim so competing workers cannot reuse it.
Persist buyer-approval and seller-consent waits with the expected account alias and resource identity.
Keep browser URLs containing tokens in an ignored private artifact store, revealed only through an explicit private operator action.
After resume, use authoritative PayPal reads to confirm approval or consent; do not treat a browser return or operator statement alone as transaction confirmation.
Test denied approval, altered payloads, reused approvals, crash recovery, consent denial, pending state, and repeated resume commands.

## Step 6: Add the operator CLI and safe reports

Proposed command behavior below is an interface target, not an existing runnable command.

| Command | Behavior |
|---|---|
| start | Attach to the authorized allocation, validate inputs, prepare an operation, and pause at an approval or prerequisite gate |
| inspect | Show sanitized persisted progress and budget; perform no network requests by default |
| approve | Record a concrete explicit human decision through the trusted local operator interface; no general approve-all option |
| resume | Continue the same run, recover uncertain state, verify browser actions, and stop at the next required approval |
| report | Export sanitized results from persisted state without making network calls |

Add package-local wiring under apps/agents/scripts/f0 with explicit root .env loading; retain f0:preflight unchanged unless extraction is independently verified.
Load database configuration explicitly for CLI and migration commands rather than assuming every package reads root .env.
Keep private participant mappings, sandbox BN code, and browser artifacts out of CLI arguments, ordinary logs, and committed reports.
Do not add new workspaces, a product UI, agent registrations, or Turborepo tasks for this runner.
Configure private-artifact exclusions before generating artifacts and preserve the contributor's existing .gitignore edit.
Document exact executable invocations only after they exist and have been tested.

## Step 7: Verify offline and prepare one reviewable experiment

Retain the existing preflight regression suite and run focused tests, typechecking, and Biome for changed packages and files.
Use injected transport and recognizable fake secrets for routine CI; real sandbox execution must be explicit.
Run persistence, claiming, approval, counter, and recovery integration tests against a disposable database.
Run a mocked end-to-end scenario from preparation through approval, browser wait, restart, recovery, and report.
Verify that neither default startup nor missing approval can send a business operation.
Verify that reaching either limit blocks every additional relevant dispatch and that a new run cannot reset counters.
Verify output excludes credentials, tokens, account emails, merchant IDs, and browser approval links.
Record actual commands and results in the handoff rather than claiming validation from this plan.
Then prepare one eligible F0 experiment with confirmed prerequisites, principal and fee bounds, and a request-count estimate that fits both limits.
The existing phase order remains P3 seller onboarding, P4 one protection path, P5 multiple payees, P6 Payouts, and P7 evidence review, subject to prerequisites and remaining budget.
Do not assume that all experiments can finish within $1 and 50 calls, or select $1 principal if that leaves no allowance for sender fees or later tests.
If an experiment requires more than the remaining budget or a missing permission, report blocked or inconclusive evidence and the reason; do not increase limits.
Ask the contributor to approve the first concrete payment only after the implementation and its relevant checks pass.

## Proposed implementation locations

| Location | Responsibility |
|---|---|
| packages/contracts/src/sandbox-capabilities.ts | Shared runner, approval, operation, allocation, and report schemas |
| packages/core/src/sandbox-policy.ts | Pure budget and approval eligibility rules |
| packages/db/src/sandbox-schema.ts | Allocation, run, operation, approval, attempt, and browser-wait records |
| packages/db/src/sandbox-store.ts | Transactional claims, reservations, decisions, and recovery persistence |
| packages/db/src/schema.ts | Export the sandbox tables for Drizzle discovery |
| packages/db/drizzle/ | Generated and reviewed migrations |
| packages/paypal/src/{config,client,operations,errors}.ts | Sandbox transport and endpoint adapters |
| apps/agents/scripts/f0/{index,runner,executor,report}.ts | Operator commands, dispatch gates, and sanitized reports |
| Package-local tests | Pure rules, contracts, transport, database, and runner scenarios |
| .env.example and package scripts | Necessary private configuration names and tested invocations, without secret values |

File boundaries are proposed; keep the implementation small and update the plan if the reviewed code requires a clearer division.
The full product policy engine, inbox/webhooks, reconciliation, agents, Vault charging, and milestone UI are outside this phase.

## Completion and handoff

P2 completes when the offline and disposable-database checks prove persistence, budget enforcement, approval gating, safe recovery, and private reporting.
A passing P2 test does not mark any PayPal business capability supported.
P1 account and permission gaps must remain documented even if the independent P2 foundation is ready.
Update the access assessment, F0 handoff, and operator runbook with implemented behavior and exact next action.
No generated code, migrations, account settings, or PayPal resources are changed by this planning document.

## Official references

Reviewed on 2026-10-11; recheck individual endpoint contracts when implementing adapters.

- [PayPal idempotency](https://developer.paypal.com/api/rest/reference/idempotency/): support and retention vary by endpoint; the header alone does not establish safe retries.
- [Payout fees](https://developer.paypal.com/payouts/fees/): the sender needs funds for both principal and fees; do not assume the applicable fee from a generic example.
- [Design spec](../superpowers/specs/2026-10-08-tranche-design.md): pure core, deterministic execution, outbox, and separation from agents.
