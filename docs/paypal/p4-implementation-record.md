# P4 authorization/capture implementation record

Date: 2026-10-12.
Status: Authorization/capture is implemented and verified offline.
Delayed-disbursement implementation: Blocked on the referenced-release confirmation, idempotency and recovery contract.
Actual PayPal capability: not_tested.
Plan: [P4 implementation plan](p4-payment-protection-implementation-plan.md).
Operator commands: [P4 runbook](p4-runbook.md).

## Delivered behavior

The deterministic operator runner prepares a single-seller AUTHORIZE order, obtains explicit approval, saves the private checkout link and pauses for the buyer.
Counted order reads verify the intended buyer, seller, amount, currency, intent and commitment reference after browser approval.
A separately approved authorization places the hold; another separately approved capture collects the matching authorization.
A capture response remains pending or inconclusive until a counted capture read confirms COMPLETED with the matching order and authorization references.
Successful recorded P3 consent is required before writes, and each write rechecks current seller readiness through the merchant-integration endpoint.
All business writes retain outbox claims, immutable payload approval, stable request IDs and no automatic retry.
Recovery reads use known resource references; a lost order ID remains inconclusive rather than causing a replacement order.
An authorization lost in transit can be recovered from its order and a matching authorization read, including its expiry.
A capture lost in transit can be recovered from its order and a matching capture read.

## Files and responsibilities

| File or group | Responsibility |
|---|---|
| packages/contracts/src/sandbox-protection.ts | Strict private context, path/stage types, fee bounds, deadlines, evidence and allowance calculations |
| packages/contracts/src/sandbox-capabilities.ts | Payment context, controlled assertion metadata, approvals and sanitized report shapes |
| packages/core/src/sandbox-policy.ts | Pure predecessor checks and eligibility for additional reservations, including zero additional calls for stage transfers |
| packages/paypal/src/protection.ts | Exact requests, private checkout validation and authoritative order/authorization/capture checks |
| packages/paypal/src/client.ts | Controlled PayPal-Auth-Assertion generation and representation requests |
| packages/db/src/sandbox-schema.ts and sandbox-store.ts | Lifecycle resources, whole-path reservations, atomic evidence, consent gates and stage transfers |
| packages/db/drizzle/0003_majestic_domino.sql and generated metadata | Generated payment lifecycle table and migration journal |
| apps/agents/scripts/f0/payment-adapters.ts | Seller checks, browser wait, stage interpretation and bounded read-only recovery |
| apps/agents/scripts/f0/runner.ts and index.ts | Counted pre-write reads, adapter registration and explicit operator commands |
| Package-local tests and protection.sandbox.test.ts | Offline contracts, policy properties, transport, disposable database cases and disabled real-stage test |
| packages/paypal/package.json and pnpm-lock.yaml | Explicit Zod dependency for provider-response validation |

## Persistent limits

Preparation reserves principal once plus all three stage fee bounds against the shared 100-cent allowance.
No stage, restart, replacement payment or new run resets that allowance.
Preparation also atomically holds the whole lifecycle request allowance against the shared 50-call limit.
For a configured recovery-read allowance N of 2 to 4 per stage, the three stage allowances are 3+2N, 5+2N and 6+2N, totaling 14+6N.
These allowances include a write, OAuth, seller checks, required predecessor reads and fresh OAuth on bounded recovery resumes.
Stage claims transfer held calls rather than reserving them twice; unused terminal-stage calls return to the lifecycle, while terminal confirmed capture releases unused call reservations.
Money reservations are never replenished by recovery, expiry or cleanup.
The store conservatively counts a business attempt when it claims the operation, even if a later pre-write check prevents dispatch.
Execution is limited to an immutable deadline within 24 hours of preparation, with a separate recovery deadline within 48 hours and no earlier than the execution deadline.
These are local experiment limits, not PayPal validity guarantees.
Fresh seller checks are repeated before every write, and dispatch also requires an observation no older than 15 minutes and an unexpired known authorization.

## Executed verification

| Check | Result |
|---|---|
| Workspace tests | 349 passed |
| Contracts | 88 passed |
| Core | 76 passed, including 1,000-case properties for budget eligibility and payment lineage |
| PayPal mocked transport and contracts | 58 passed |
| Foundation database | 11 passed against the isolated database |
| Agents and runner | 116 passed, including 18 P2, 19 P3 and 20 P4 database scenarios |
| Real PayPal integration tests | Two intentionally skipped opt-in tests, P3 and P4 |
| TypeScript | All eight workspace packages passed |
| Biome CI | 62 source files passed without warnings |
| Migration | Applied only to the disposable local test database; regeneration reports no schema changes |
| CLI | Offline help lists payment preparation, stage advancement and private checkout-file commands |

P4 database scenarios cover the complete flow, restart, missing consent, revoked permissions, global limits, changed payload/context, lineage, bounded polling, private artifact failure, lost responses, concurrent workers, duplicate stages, expiry and dispatch freshness.
Routine transport was mocked, with synthetic account identifiers and local PostgreSQL only.
Local links, Markdown formatting, migration journal consistency and git diff --check passed; the configured PayPal credential privacy scan passed across all 32 changed files without printing credential values.
The disposable PostgreSQL test container was stopped after verification.
No real PayPal OAuth, referral, order, authorization, capture, release or payout request was made during P4 implementation.
No application database migration, account change, credential edit, commit or push is established by this record.

## Remaining work

Complete approved actual P3 onboarding before payment execution, then privately establish the selected path's endpoint access, minimum, fee bounds, buyer browser availability and remaining allocation.
Prepare a payment only near the agreed browser session, and obtain separate approval before the order, authorization and capture writes.
The existing account logins, USD balances and app association remain contributor-confirmed context; they do not prove successful payment processing.
Delayed capture and referenced release are not implemented or registered, and the existing P3 feature contract does not establish DELAY_FUNDS_DISBURSEMENT.
No automatic fallback, refund, void, reauthorization, payout, webhook reconciliation, milestone verification or payment UI is included.
If recovery exhausts its reads or lacks a resource reference, report the unresolved resource and remaining allocation; no automatic reset, replacement or extra polling exists.
General recovery reservation extensions are not implemented; the buyer-change flow below adds only its fixed, separately approved allowance.
Actual P4 success and F0 capability selection remain pending authoritative sandbox evidence.

## Buyer-change follow-up: 2026-10-12

The actual order returned the correct seller, USD 1.00, AUTHORIZE intent and PAYER_ACTION_REQUIRED, with a provider-generated sandbox checkout link.
The screenshot 190259 browser error contains an encoded UNSUPPORTED_PAYEE_CURRENCY value; the API log screenshot 190112 shows successful order creation and reads.
This is evidence of checkout failure, not proof that the order was cancelled or that money was authorized or captured.
The local account inventory records Indian buyer and seller accounts, while the contributor later confirmed a US Personal replacement buyer and a displayed USD 5,000 balance.
Changing the buyer is an experiment to assess compatibility, not a confirmed remedy for the seller currency rejection.
The P3 verifier checks consent, permissions, identity and general readiness; it does not establish seller eligibility for a specific currency or payment path.
The create-order request also omits return and cancel URLs, a separate browser-flow gap that this buyer-change implementation does not resolve or establish as the cause of the currency error.

Added strict shared buyer-change input and sanitized summary schemas, a pure policy that changes only buyer identity and increments its version, and a generated sandbox_buyer_change audit-table migration.
The store prepares and approves one proposal per order, binds approval to both specifications and the provider reference, preserves the original audit data, and applies a change under a current recovery claim after a counted provider read.
The CLI adds buyer-change, approve-buyer-change and apply-buyer-change; application is GET-only and never creates a replacement order.
Four additional attempts are reserved within the same global 50-call cap, with two additional order recovery GET slots; used calls and recovery counters are not reset.
The original request body, request ID, order, checkout artifact, deadlines, seller, fees and money commitment remain unchanged.
Pending proposals block ordinary recovery, and an already identified or approved buyer blocks application; the old buyer cannot pass later identity verification after application.
No general recovery extension, proposal cancellation, money reset or payment cleanup is introduced.
See the [buyer-change runbook](p4-runbook.md#change-the-expected-buyer-of-an-existing-unapproved-order) for concrete approval and execution boundaries.

### Follow-up verification and handoff

The initial CLI-to-database reproduction failed with invalid_command before implementation and passed after the commands were added.
Affected suites passed 369 tests: contracts 91, core 84, PayPal 67, and agents 127, including 68 isolated PostgreSQL runner scenarios and a 1,000-case buyer-mapping policy property.
The two real PayPal integration tests remained disabled; the 11 separately gated foundation database tests were skipped in this follow-up run rather than counted as passing.
All five affected package typechecks and Biome CI for the 12 changed source files passed; migration regeneration reported no schema changes.
Generated migration 0004_absurd_madame_hydra was tested on the isolated database, then applied to the existing local application database without resetting its allocation or payment records.
The contributor approved the US buyer change, and the counted sandbox order read verified that the existing order remained unapproved before the local buyer mapping was applied.
Local inspection confirms the applied amendment, the same order operation and browser artifact, 13 consumed attempts, 27 held calls, 100 reserved cents and zero committed cents.
The follow-up used OAuth and an order GET; no authorization, capture, replacement order, provider account change or credential change was made.
Checkout with the replacement US Personal buyer and the Indian seller remains pending browser evidence.

## Checkout destination follow-up

The contributor reported the same generic checkout failure, switched the intended test pair to a US Personal buyer and US Business seller, approved local retirement of the unused Indian-seller order, and approved verification of the US seller's existing PPCP product and grants.
Both read-only maintenance checks passed; the US seller's effective consent context is verified, while successful payment processing is still unproven.
Added validated same-origin return and cancel destinations to the private payment context and approval summary, and included them in new order requests as documented in [PayPal's Orders flow](https://developer.paypal.com/whats-an-order/).
Added informational Next.js callback pages; neither page trusts callback query data as payment evidence or calls a payment endpoint.
The create-order adapter rejects missing destinations before network dispatch; the protect command rejects such inputs before preparing a new run or reserving budget.
Older operation requests and hashes remain unchanged, including the locally retired order.
Validation passed 92 isolated-database runner tests, 29 payment-context contract tests and 19 payment adapter unit tests, plus typechecks for web, agents-service, paypal and contracts and affected-file lint and formatting checks.
Local HTTP checks returned 200 for both callback routes with fake PayPal query parameters and confirmed that the page content ignored those values.
The fresh USD 1 US-to-US commitment is prepared and awaiting create-order approval, with 26 lifecycle calls reserved; shared accounting is 23 consumed calls, 26 held calls, 100 reserved cents and zero committed cents.
No new PayPal order, authorization or capture was sent by this follow-up, and the previous UNSUPPORTED_PAYEE_CURRENCY cause is not proven fixed by adding destinations or changing accounts.

## Actual US-to-US payment progress

The contributor approved creation of a USD 1 AUTHORIZE order for the verified US Business seller and completed checkout as the US Personal buyer.
A counted order read verified buyer_approved for the intended payment.
The contributor separately approved authorization, and the runner's authoritative result is authorized for the matching commitment.
The saved allocation shows 32 of 50 attempts consumed, 17 calls held, zero reserved cents and 100 committed cents; committed cents are internal budget accounting for this USD 1 test.
The capture operation is prepared locally and awaits separate approval to collect the same authorized USD 1; no capture has been sent and the generic capability remains not_tested.
The contributor subsequently approved capture of that same authorization.
The capture write was sent once, its initial runner result was inconclusive, and a read-only resume verified the matching capture with captured_immediate evidence.
Final shared accounting is 40 of 50 attempts consumed, zero held calls, zero reserved cents and 100 committed cents.
The [dated experiment evidence](evidence/p4-us-authorization-capture-2026-10-12.md) records the transaction conclusion and its limits.
