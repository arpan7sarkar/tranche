# Sandbox readiness implementation plan

## Current testing authorization: 2026-10-11

The contributor's latest instruction sets USD $1 as the maximum total testing spend across all tests and resumes, replacing the earlier $5 cap and the original image's $10-per-test and $500-total proposal.
Any individual test must fit within the remaining $1 allowance; known sender fees must also fit within that total.
Before every money-moving test, explain the purpose, sender, recipient, amount, and expected fees, then wait for explicit contributor approval.
If the amount is insufficient or a test fails, report the reason and proposed next step; do not increase the amount or send another payment without approval.
The contributor agreed that the 50-call cap counts all runner-issued PayPal requests, including OAuth, reads, writes, retries, polling, recovery, and cleanup; runtime enforcement is still pending.
No current preflight command enforces money budgets or executes payments.
Earlier requested amounts retained below are historical inputs and do not authorize spending.

Date: 2026-10-11.
Status: Planning complete; account assessment and runtime implementation pending.
Scope: the six tasks in the reference image supplied by the requesting contributor.
Parent: [F0 capability plan](f0-plan.md).
Current progress: [handoff](f0-status.md).
Historical evidence: [P1 access assessment](evidence/p1-access-assessment.md).

## Request and evidence boundary

The contributor requested planning and documentation for the image on 2026-10-11.
The image is a requirements source, not evidence of completed dashboard setup or enabled payment features.
Its transcription below is retained because the local sources directory is ignored and is not a portable documentation dependency.
This request resumes planning for the previously deferred work; no dashboard changes or PayPal calls were performed in this session.
The supplied amounts and roles are planning inputs, not values currently enforced by the code.

## Current implementation

| Area | Existing behavior | Work still needed |
|---|---|---|
| Configuration and authentication | apps/agents/scripts/f0/preflight.ts validates sandbox credentials and performs one OAuth exchange | Preserve its interface; add runner-specific readiness validation separately |
| Tests | preflight.test.ts contains the existing isolated suite; 54 tests passed in the previous validation | Add runner, budget, persistence, and transport tests when those components are built |
| Shared contracts | packages/contracts/src/index.ts defines only MilestoneState | Add sandbox participant, envelope, run, operation, and capability schemas |
| PayPal adapter | packages/paypal/src/index.ts is empty; SDK 2.5.0 is declared | Implement sandbox transport and endpoint-specific adapters |
| Database | Client factory and empty schema; no migrations | Add durable campaign, run, outbox, attempt, and browser-wait storage |
| CLI | Only f0:preflight exists | Add deterministic operator commands for start, inspect, resume, and report |
| Accounts and features | Platform setup is user-reported; OAuth success is recorded | Inspect participant mappings, countries, currency support, features, and sandbox balances |

Do not treat the web landing page or ping workflow as payment functionality.
Keep the operator CLI separate from registered AI workflows and keep packages/core free of I/O.

## Image task mapping

| Image task | Requested target | Phase | Completion evidence |
|---|---|---|---|
| Test accounts | Default Personal account as buyer; default Business account as seller-a; one additional distinct Business account as seller-b | P1 | Dated inventory confirming actual accounts, country, USD suitability, and private custodian |
| Payout sender and source | Platform app's Business account using its sandbox balance | P1 assessment; P6 probe | Confirmed app/account mapping and usable balance; later item-level payout outcome |
| Browser approvals | Requesting contributor performs buyer checkout and seller consent | P1 arrangement; P2 durable pause/resume | Confirmed private access and availability; restart-safe browser wait followed by authoritative API reads |
| Currency | USD | P1 assessment; P2 validation | Participant compatibility recorded; non-USD runs rejected |
| Test limits | Original image: $10 per test and $500 total; superseded by current $1 total cap above; 50 API calls maximum unchanged | P1 envelope; P2 enforcement | Explicit accounting agreement and persistent concurrent-safe budget enforcement |
| App features | Inspect Payouts, Vault, delayed disbursement, and partner/platform settings | P1 | Dated observations separated from API-proven capabilities |

## Step 1: Inspect and complete the participant inventory

For the immediate role-assignment and app-to-.env matching task, follow the [priority 1 confirmation plan](p1-account-role-confirmation-plan.md).
That narrower task does not complete the login, currency, or feature-readiness checks in this broader plan.

Owner: requesting contributor with the PayPal Developer Dashboard account owner.
Use the Sandbox Accounts area of the Developer Dashboard; navigation may appear as Testing Tools > Sandbox Accounts or Sandbox > Accounts.
Inspect existing accounts before creating anything.
Use the default Personal account for buyer only after confirming its type, login access, country, and USD suitability.
Use the default Business account for seller-a only after confirming it is suitable for the agency role.
Identify the Business account associated with the platform app separately.
Record explicitly whether platform and seller-a share an account; a shared account does not prove a valid third-party platform/seller flow.
Before P3, verify the selected platform/seller arrangement supports the intended third-party onboarding experiment; if it does not, document the blocker and plan a separate seller account with the owner.
Use an existing distinct Business account for seller-b, or have the owner create one when actual setup is requested.
Do not create a third seller merely because a second seller's current existence is unknown.
Use seller-b as the proposed payout-recipient if it is suitable, and record that role-sharing explicitly rather than creating an unnecessary recipient.
Keep account emails, merchant identifiers, passwords, credentials, and alias mappings private.
Record country from observation; USD as the test currency does not imply a US account.

Exit: all aliases map privately to confirmed accounts, both sellers are distinct, USD suitability is recorded, and any account-role incompatibility has a named next action.

## Step 2: Inspect features and the proposed payout funding source

Owner: dashboard account owner, with observations recorded by the contributor.
Inspect Apps & Credentials with Sandbox selected, the intended app, and any Features/settings surface available to that account.
Record Payouts, Vault, partner/platform approval, delayed disbursement, platform fees, attribution availability, and seller readiness using observed_enabled, observed_disabled, not_visible, or unknown.
Record the observer, date, app alias, and account alias for every observation.
Do not infer feature enablement from successful OAuth, scopes, app type, or a missing toggle.
Feature inspection does not include automatically enabling settings or requesting partner approval.
Check that the proposed payout sender is the platform app's Business account and has suitable USD sandbox funds, without silently replacing platform credentials.
If its balance or permissions are insufficient, record the gap before proposing a sandbox configuration change.
Record that funding the P6 experiment from a platform sandbox balance does not prove agency proceeds can reach that sender in the product.
Vault inspection is included here; vault creation and unattended charging remain outside the required F0 probes.

Exit: every feature has a dated observation or an explicit visibility/access gap, and payout sender mapping and balance readiness are recorded.

## Step 3: Record operators and finalize the execution envelope

Owner: requesting contributor and account owner.
The requested operator is the contributor for buyer approval and both sellers' consent.
Confirm private login access and availability before scheduling a run; assigning a role in this plan does not establish access.
Browser login remains human-operated; passwords must not become CLI arguments, fixtures, or workflow inputs.

The image leaves accounting details unspecified.
Use the following conservative interpretation as the implementation proposal and record agreement before payment experiments.
This table defines intended behavior; no current command enforces it.

| Setting | Proposed rule |
|---|---|
| Environment | Sandbox only |
| Currency | USD only; money stored in integer cents |
| Per-test maximum | No more than the remaining 100-cent campaign allowance, summed across all purchase units or payout items and allowing for sender fees |
| Total maximum | 100 cents of total testing spend across all tests and resumes; no automatic reset or increase |
| API-call maximum | 50 outbound PayPal API attempts across the campaign, including OAuth, reads, writes, retries, polling, recovery, and cleanup |
| Separate write count | Record business-write attempts separately; the 50-call cap must not be relabeled as 50 business writes |
| Browser actions | Record separately; the API cap applies to runner-issued PayPal API requests, not browser-internal traffic the runner cannot observe |
| Budget reset | Starting another run or process must not reset the campaign counters; a new campaign requires an explicit recorded allocation |

Reserve money before an order or payout can create a new commitment.
Count an order's principal once across approval, authorization, capture, and referenced release; those lifecycle steps do not each create another allowance.
A separate payout is a new commitment even when a previous order had the same amount.
Treat a replacement order as a new commitment and sum split units/items before validation.
Do not replenish the campaign allowance after refunds or other cleanup.
Keep ambiguous commitments reserved until recovery establishes their outcome; release an unused reservation only on authoritative evidence that no commitment occurred.
Reserve API attempts atomically before network dispatch and conservatively count a reservation after a crash when dispatch cannot be excluded.
Do not start a new experiment unless sufficient remaining calls have been reserved for its bounded confirmation/recovery path; allocate that allowance from the same 50-call limit.
If the cap is exhausted, pause with an unresolved outcome instead of silently sending additional recovery or cleanup calls.
Cache OAuth tokens in memory until expiry and disable hidden SDK retries so every actual attempt is counted.

Exit: the assessment contains the requested values, agreed accounting rules, operator confirmation, and participant readiness without marking any payment feature supported.

## Step 4: Build P2 contracts and durable persistence

Follow the [P2 sandbox runner implementation plan](p2-sandbox-runner-implementation-plan.md) for the current $1 allocation, agreed 50-request accounting, approval records, implementation sequence, and validation gates.

Owner: implementing contributor coordinating shared contracts and database boundaries with the money-layer owner.
Define Zod schemas for participant aliases, feature observations, execution envelope, campaign, run, operation payloads, browser waits, and capability outcomes.
Reject missing account mappings, incompatible currency, invalid cents, and limits above the recorded campaign allocation before business calls.
Keep secret-bearing configuration separate from shared reports and capability summaries.
Add campaign-scoped money and API counters, run status, outbox operations, attempts, and browser-wait records to Postgres.
Persist operation identity, payload hash, stable PayPal-Request-Id, provider resource references, and terminal or unresolved state.
Make claiming, money reservations, and API-attempt reservations transactional and safe under concurrent runners.
Add endpoint-specific duplicate identities, including payout batch and item identifiers, where the endpoint supports them.
An expired claim must enter recovery; it must not blindly resend an operation another process may already have dispatched.
Generate migrations with Drizzle, review their scope, and integrate the sandbox schema into the existing schema export.
Do not generate migrations concurrently with another contributor or hand-edit generated output.
Use a disposable database for integration tests and make database environment loading explicit.

Exit: concurrency, restart, payload-identity, and budget-boundary tests pass against a disposable database before business probes exist.

## Step 5: Build the sandbox transport and operator runner

Owner: implementing contributor.
Inspect the installed PayPal SDK and each official endpoint contract before selecting SDK coverage or direct REST adapters.
Build sandbox-only configuration, OAuth, transport, URL validation, typed operations, and sanitized errors in packages/paypal.
Keep preflight's existing modes, exit codes, one-attempt behavior, and no-business-write scope intact if authentication is extracted.
Route every business write through the durable outbox and include PayPal-Request-Id.
Header presence is not proof of endpoint idempotency; use only documented, endpoint-specific retry and recovery behavior.
Keep automatic retry bounds and polling deadlines explicit and within the campaign's remaining API allowance.
Add proposed operator commands start, inspect, resume, and report under apps/agents/scripts/f0 with explicit root .env loading.
These runner commands do not exist yet; document their exact tested invocation only after implementation.
Persist waiting_for_buyer_approval and waiting_for_seller_consent with the intended alias and expected provider resource.
Keep token-bearing approval/referral links in an ignored private store, expose them only to the authorized operator through a deliberate private interaction, and exclude them from committed reports and ordinary logs.
Validate provider-returned URLs before use and never forward authorization headers to browser approval destinations.
Resume using the same operation identities and verify approval or consent through authoritative API reads; an operator's statement or browser return alone is insufficient.
Configure private-artifact exclusion before writing artifacts and preserve any existing .gitignore edits.

Exit: mocked end-to-end runs survive browser waits and ambiguous writes without duplicate payment dispatch, lost budgets, or secret-bearing reports.

## Step 6: Execute only eligible F0 experiments and record results

The runtime implementation and setup in steps 1-5 are prerequisites, not successful payment experiments.
After readiness is established and actual experiment execution is requested, use the parent F0 plan's P3-P7 gates.

| Phase | Experiment | Required result or explicit blocker |
|---|---|---|
| P3 | Partner Referrals and seller consent | Retrieved seller readiness and permissions; separate evidence for each seller |
| P4 | Single-seller protection path | Confirmed delayed capture and referenced release, or confirmed authorization and capture fallback |
| P5 | CAPTURE order with both sellers | Both payees and unit amounts confirmed; no inference about AUTHORIZE multi-payee support |
| P6 | Platform-balance payout to the selected recipient | Item-level receipt outcome; product source-funding feasibility recorded separately |
| P7 | Payment-path review | Evidence-backed protection/split decision and remaining resources |

Keep all experiments within the current $1 total allowance, including known sender fees; purchase units and payout items must share that allowance.
Obtain explicit approval before each money-moving test, stating its purpose, sender, recipient, amount, and expected fees.
If fees or the required minimum cannot be established within the remaining allowance, pause and report the gap before executing.
Estimate normal, pending, and recovery API attempts before each experiment; 50 calls is a cap, not a promise that all experiments can finish within it.
Pause rather than exceed the budget, invent feature support, or force an ambiguous operation through a fresh identity.
Record supported, unsupported, blocked, inconclusive, or not_tested based on the actual outcome.
Do not claim unattended funding, vaulting, long-term renewal, webhook processing, or complete product money flow from these experiments.

## Proposed code changes

These are implementation targets, not existing files or completed work.

| Location | Responsibility |
|---|---|
| packages/contracts/src/sandbox-capabilities.ts | Readiness, participant, envelope, operation, and outcome schemas |
| packages/paypal/src/{config,client,operations,errors}.ts | Sandbox transport, OAuth, endpoint adapters, safe errors |
| packages/db/src/{sandbox-schema,sandbox-store}.ts | Campaign/run persistence, counters, claims, outbox, attempts, and waits |
| packages/db/src/schema.ts | Export sandbox schema for Drizzle discovery |
| packages/db/drizzle/ | Generated and reviewed migrations |
| apps/agents/scripts/f0/{index,runner,executor,probes,report}.ts | Deterministic human-operated execution |
| apps/agents/package.json | Runner script with explicit environment loading after implementation |
| .env.example | Document additional private configuration names if implementation requires them; no secrets |
| .gitignore | Exclude private probe artifacts before use, preserving existing edits |
| Package-local tests | Contract, transport, store, runner, budget, and security coverage |

Do not add a product UI, AI money tools, new workspace, or Turborepo task for these setup requirements.

## Verification and closeout

For the account work, inspect the dashboard and write dated observations with provenance; do not substitute mocked tests for account evidence.
For the code, test USD and amount boundaries, split totals, accumulated campaign limits, read/write/OAuth call counting, polling, retries, restart persistence, concurrent reservations, and exhausted-budget behavior.
Test redirects, invalid provider URLs, secret-bearing responses, browser waiting across restart, denied consent, pending state, and ambiguous-write recovery.
Retain the existing preflight regression suite and run typechecking and Biome for changed code.
Run claiming and persistence integration tests against a disposable database before opting into real sandbox experiments.
Keep normal CI offline from PayPal and keep real sandbox integration execution explicit.
Use package-scoped pnpm commands and record exact invocations and results once the test paths and runner exist.
Update the assessment, handoff, and each experiment's evidence after actual work; leave unknowns and remaining resources explicit.

Planning-session validation: local Markdown links, fences, whitespace, no-em-dash convention, and git diff --check must pass before handoff.
No application code, migrations, account settings, or PayPal resources are changed by this planning document.

## Official references

Consulted on 2026-10-11; provider guidance does not establish our account's permissions.

- [Sandbox accounts](https://developer.paypal.com/sandbox-testing/accounts): Personal/Business roles and additional sandbox accounts.
- [Payouts integration](https://developer.paypal.com/api/payouts): payout execution, status retrieval, and OAuth-token reuse.
- [Delayed disbursement](https://developer.paypal.com/platforms/checkout/delayed-disbursement): partner/seller prerequisites and referenced release.
- [Idempotency](https://developer.paypal.com/api/rest/reference/idempotency/): endpoint-specific request identity support.

Recheck endpoint contracts and SDK behavior when implementing each adapter.
