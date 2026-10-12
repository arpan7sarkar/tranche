# P4 single-seller payment-protection implementation plan

Date: 2026-10-12.
Status: Authorization/capture implemented, verified offline and confirmed in one US-to-US sandbox transaction; delayed disbursement remains blocked on its release contract.
Implementation evidence: [P4 record](p4-implementation-record.md).
Actual payment evidence: [P4 US authorization and capture](evidence/p4-us-authorization-capture-2026-10-12.md).
Implemented commands and remaining execution prerequisites: [P4 runbook](p4-runbook.md).
Parent: [F0 plan](f0-plan.md).
Foundation: [P2 closeout](p2-closeout.md) and [P2 runbook](p2-runbook.md).
Seller readiness: [P3 implementation plan](p3-seller-onboarding-implementation-plan.md).
P3 onboarding and seller grants were verified for the tested US Business seller before this payment experiment; the earlier offline status remains in the [P3 handoff](p3-implementation-record.md).
Implementation closeout and agreed sequence: [P3 closeout](p3-closeout.md).

## Agreed implementation and execution order

P4 authorization/capture offline implementation and tests are complete using mocked seller readiness while actual P3 onboarding is deferred.
Build shared payment contracts, persistence, policy and transport first, then implement and test authorization/capture offline.
Research the delayed-release contract alongside that work; keep delayed payment adapters unregistered until their release confirmation, idempotency and recovery contracts are verified.
This development order does not select or authorize the actual experiment; delayed disbursement remains preferred when all of its prerequisites are established.
After P4 offline verification, prepare and separately approve P3 referral execution, complete Seller A's consent and verify the actual permissions required by the selected P4 path.
Successful offline P4 tests do not establish those real permissions.
Run a P4 payment experiment only after authoritative P3 readiness, path-specific prerequisites and separate explicit payment approval.
The existing $1 total including sender fees and 50-call allocation remains shared across both phases without reset or increase.

## Outcome and execution boundary

Implement and test one single-seller protection path using the Personal buyer and a ready Business seller, initially seller-a.
Prefer delayed disbursement when its prerequisites and confirmable release path are established.
Otherwise prepare the authorization/capture alternative as a separate path with its own requirements and approval.
Keep provider evidence, runner success and full product payment protection separate.
This phase does not implement milestone UI, AI payment decisions, unattended Vault funding, renewal scheduling or reconciliation.
Planning and offline implementation do not authorize order creation, authorization, capture, release or cleanup writes against PayPal.

## Prerequisites before a real experiment

Reuse the confirmed accounts and platform REST app rather than creating new apps by default.
Use P3's dated merchant mapping and required grants; an existing seller login is not permission for platform calls on that seller's behalf.
Arrange buyer browser availability and privately verify the intended buyer and seller mapping used by the adapter.
Confirm applicable USD compatibility, endpoint access, usable funding and sender-fee bounds for the specific path.
Read the authorized database's persisted allocation, including reserved money and held calls left by earlier phases.
Select principal only after checking the applicable endpoint minimum and justified fees; do not use $1 principal by default because it can consume the entire allowance.
Estimate the whole path, including OAuth, browser-status reads, each write, confirmation and recovery, before creating an order.
If prerequisites or conservative fees cannot be established within the remaining $1 and 50 attempts, report the blocker without sending a payment or increasing limits.

## Contract baseline and path selection

Use the [Orders v2 reference](https://developer.paypal.com/api/orders/v2) and its [official schema](https://developer.paypal.com/api/orders/v2/schema.json) for order creation, retrieval, authorization and capture contracts.
The [delayed-disbursement guide](https://developer.paypal.com/platforms/checkout/delayed-disbursement/) requires partner access and seller delayed-disbursement setup, describes CAPTURE with DELAYED instructions, and identifies referenced release using a capture reference.
The [partner authorization/capture guide](https://developer.paypal.com/platforms/checkout/standard/customize/auth-capture/) describes AUTHORIZE, buyer approval, order authorization and capture of the resulting authorization; it also lists partner and seller-onboarding requirements.
The alternative is therefore not assumed to bypass missing platform or seller permissions.
Recheck the endpoint-specific request-ID support, retention, status interpretation and recovery reads before registration.
Some integration examples contain live hosts; implement only the fixed sandbox host and validated sandbox browser links.

## Payment deadlines and readiness rechecks

Persist an immutable execution deadline for each payment lifecycle, no more than 24 hours after preparation, and bind it to the approved context.
This is a conservative local experiment limit, not a claim about PayPal's order or authorization lifetime.
Prepare actual payment operations near the agreed buyer browser session rather than during offline development.
Persist any authoritative provider expiry separately and use the earlier applicable deadline to gate a new write.
An unknown provider expiry must not be replaced by an assumed validity period; verify the endpoint's applicable validity rules before enabling its adapter.
After expiry, block new payment writes and report unresolved resources; expiry does not release reservations or authorize replacement orders, voids or refunds.
Allow only explicitly implemented, counted recovery reads within their own persisted deadline and allowance to establish what happened.

Before order creation and every later payment write, perform a counted authoritative seller-readiness check against the same platform app, seller identity and required permissions.
Repeat the check after buyer browser pauses and process restarts; a previously successful P3 operation alone is insufficient evidence of current readiness.
Persist the checked identity, permission requirements and observation time with the payment lifecycle and reject mismatched or missing evidence.
Use a maximum observation age of 15 minutes at dispatch as a local safety policy; stale evidence requires another counted check before proceeding.
Revalidate the matching order or authorization state through counted provider reads before its dependent write, including amount, currency, seller, path and available buyer identity.
If a check fails or cannot fit within the remaining request allowance, block the new write and preserve existing reservations.
Delayed-path readiness must establish the required DELAY_FUNDS_DISBURSEMENT feature; P3's current PAYMENT/REFUND configuration does not establish that feature.
Review and extend P3's feature and evidence contracts with regression tests if the selected path requires additional permissions before actual onboarding.

## Step 1: Define payment-path contracts and private references

Extend contracts with explicit delayed_disbursement and authorization_capture path types, typed provider-resource relationships and sanitized evidence results.
Bind buyer/seller mapping versions, USD principal, every sender-fee bound and path choice to the immutable approved request.
Bind lifecycle deadlines, required permissions and the planned request allowance as well; changing these inputs must invalidate the existing approval.
Validate nested purchase-unit amounts, payee identity and request body against the human summary; checking the summary alone is insufficient.
Use one purchase unit and one seller in P4; multiple payees remain P5.
Persist order, authorization, capture and release references privately before completing each corresponding operation.
Store only necessary validated references and observations, not raw responses or authorization tokens.
Use separate evidence states for order_created, buyer_approved, authorized, captured_delayed, released, captured_immediate, pending and inconclusive.

## Step 2: Strengthen the P2 execution boundary for real payments

Reuse P3's controlled partner-attribution support and add a narrowly typed PayPal-Auth-Assertion context where the selected endpoint requires it.
Generate assertion tokens from the reviewed private platform/seller context at dispatch; never print or persist the token itself.
Bind that context to approval through non-secret identifiers or mapping fingerprints, preventing a changed merchant context from reusing approval.
Keep all business writes behind the outbox, stable request IDs, transactional claims and explicit human approvals.
The current generic store checks only broad predecessor kinds; extend pure policy/store checks to enforce the selected path, correct resource lineage and actual required predecessor state.
For authorization capture, require the matching successful authorization rather than accepting order creation alone.
For referenced release, require the matching delayed capture and never substitute an unrelated capture or seller.
Generate and review migrations for any necessary resource/evidence additions and test against the disposable database.
Implemented authorization/capture uses generated migration 0003_majestic_domino; it was tested on the disposable database and subsequently applied to the existing local application database before sandbox execution.

## Step 3: Implement the order and browser-approval stage

Create the exact reviewed request through POST /v2/checkout/orders with the selected intent and mapped seller.
Use a persisted operation identity, stable request ID and shared commitment identifier for the payment lifecycle.
Store the order reference and private approval-link artifact before waiting for the buyer.
Present the planned experiment and obtain explicit contributor approval before the order can create a commitment, even though order creation itself is not proof of a completed charge.
Have the contributor approve checkout as the Personal buyer.
Resume through counted order reads and validate the expected order, amount, seller and available buyer identity before allowing the next write.
A browser return, screenshot or contributor statement alone must not mark the order approved in the runner.
Each later write has its own immutable operation and concrete approval; browser approval is not a replacement for that operator approval.

## Step 4A: Delayed-disbursement path

Implement CAPTURE-intent order construction with DELAYED disbursement instructions only after the selected seller's required grants are established.
Do not add platform fees merely to reproduce a documentation example; they are a separate capability unless explicitly included in a reviewed experiment.
After verified buyer approval and fresh contributor approval, capture through POST /v2/checkout/orders/{order_id}/capture.
Validate the capture outcome and obtain evidence that distinguishes delayed disbursement from immediate settlement.
Prepare referenced release through POST /v1/payments/referenced-payouts-items using the correct persisted capture relationship, then obtain fresh approval before dispatch.
Confirm terminal release through the reviewed endpoint-specific resource/status contract; accepted submission alone is insufficient.
The precise referenced-release response, terminal-success evidence, lookup and idempotency contract still needs resolution before enabling this adapter.
Record authoritative references and representative sanitized success, pending and failure fixtures before registering the delayed path.
Offline authorization/capture completion must not be reported as delayed-disbursement implementation or capability success.
If an authoritative release confirmation or safe recovery contract cannot be established, block the delayed experiment before capture rather than deliberately leaving an unconfirmable payment.
Do not substitute a standard platform-balance payout for referenced release.

## Step 4B: Authorization/capture alternative

Choose this path only when its own prerequisites are available and delayed disbursement is unavailable or not selected.
Create an AUTHORIZE-intent order, obtain buyer approval, then prepare POST /v2/checkout/orders/{order_id}/authorize.
Obtain concrete contributor approval before authorization because it creates a hold, even if settlement follows later.
Persist and verify the returned authorization relationship and any provider expiry data before allowing capture.
Prepare POST /v2/payments/authorizations/{authorization_id}/capture and obtain fresh approval before dispatch.
Limit capture to the approved principal and matching authorization; do not implement over-capture or partial-capture experiments in P4.
Verify terminal capture status and recipient/amount evidence through authoritative provider reads.
Do not automatically begin this path after a failed delayed-path write; first resolve the existing operation, inspect remaining allowance and obtain approval for any new commitment.
If delayed disbursement succeeds, leave this alternative not_tested unless separately requested and eligible.

## Step 5: Preserve money and request accounting

Count the original principal once across order, authorization, capture and referenced release, while reserving additional sender-fee bounds per operation.
Document sender fees separately from seller deductions; never infer a zero sender fee solely from a generic example or a displayed balance.
Each replacement order or independent payment is a new commitment and consumes additional allowance.
Failed, timed-out or pending writes retain their reservations until an explicitly implemented authoritative resolution permits otherwise; P2 currently reclaims no money automatically.
Refunds, voids and cleanup must not replenish the authorized allowance or bypass outbox, request counting and applicable approvals.
No cleanup adapter is assumed to exist; plan any required cleanup before the experiment and report unresolved resources if it cannot be performed within the limits.
Hold adequate authentication and bounded confirmation/recovery calls before each write; preserve the 50-attempt cap across P3, P4 and later phases.
Replace the generic non-onboarding request estimate with a payment-path allowance that covers the whole planned lifecycle before the first order write.
Include seller-readiness checks, order/authorization validation reads, all business writes, confirmation reads and bounded recovery or planned cleanup.
Budget an OAuth attempt for each separately invoked command or resume that may create a fresh client; browser pauses must not assume a cached token survives.
Persist the remaining lifecycle allowance and per-stage recovery-read counts so restarts, repeated resumes and polling cannot reset them.
Reserve that allowance atomically against the shared allocation and transfer stage reservations without double counting or releasing calls needed by later stages.
The current store holds calls per operation rather than for an entire payment path, so implement and test lifecycle reservations before registering payment adapters.
An estimate displayed to the operator is insufficient without persistent enforcement; unrelated runs must not consume calls already held for the approved path.
Each actual attempt consumes its reserved call, including failed authentication and recovery reads; no automatic retry or extra poll is authorized by the estimate.
If more calls are needed, report the remaining allocation and proposed bounded reads before extending a reservation within the existing 50-call limit.
Any changed write plan requires fresh approval, and no request-limit increase is authorized.
Stop with pending or inconclusive evidence at exhaustion rather than sending uncounted requests.

## Step 6: Verify before payment execution

| Test area | Required cases |
|---|---|
| Exact request validation | Wrong seller, buyer context, amount, currency, intent, fees, mapping version and nested purchase-unit mismatch |
| Policy and lineage | Capture before approval, authorization capture without authorization, mixed paths and unrelated capture/release references |
| Approval | Changed request or context, reused decision, missing approval before each write and no automatic fallback |
| Database | Atomic resource persistence, principal counted once, additional fees, new commitment limits and restart recovery |
| Lifecycle limits | Whole-path call reservations, stage transfers, competing runs, OAuth after each resume and persistent polling/recovery exhaustion |
| Readiness and deadlines | Revoked grants, changed app/seller mapping, stale observations, browser delays, provider expiry and expired local write deadlines |
| Transport | Controlled partner/assertion headers, sandbox destinations, request IDs, redaction and no hidden retries |
| Browser | Correct order, denied checkout, expired link, pending status and resume after restart |
| Recovery | Timeout after provider success, missing local resource reference, bounded reads, stale worker and no duplicate write |
| Reporting | Distinguish capture acceptance, terminal capture, delayed evidence, release confirmation and actual blockers |

Retain P1/P2/P3 regressions, add focused pure/property tests where policy changes, and use mocked transport plus the disposable database for routine checks.
Create opted-in real sandbox tests only after these checks pass and the concrete execution approval is recorded.
Document executable commands after implementation; no new payment command exists solely because this plan names it.

## Step 7: Execute one approved real sandbox experiment

Present the selected path, purpose, buyer/seller aliases, principal, justified fee bounds, expected result and normal/recovery request estimate.
Wait for explicit contributor approval before the initial commitment and every subsequent money-moving operation.
Execute only the selected eligible path, pausing for browser actions and additional approvals.
Use the [F0 evidence template](f0-evidence-template.md) to record dated sanitized outcomes, resource relationships by safe aliases, remaining allocation and unresolved resources.
Record provider expiry observations without claiming long-term renewal or elapsed-time behavior was tested.
If an error occurs, report the stage and reason before proposing another attempt or path; never increase the amount or request limit automatically.

## Exit criteria and handoff

Implementation completion requires reviewed adapters, path-specific policy/persistence checks and passing relevant offline/database tests.
Record implementation status separately for authorization_capture and delayed_disbursement; if the release contract remains unresolved, close only the implemented path and keep delayed implementation explicitly blocked.
P4 payment-path success additionally requires actual authoritative evidence of delayed capture plus referenced release, or authorization plus terminal capture, for the tested seller and configuration.
Order creation, buyer approval or an accepted write is insufficient by itself.
If permissions, fee bounds, minimums, browser participation or release contracts block execution, record that specific blocker and retain missing capability evidence.
Do not mark F0 or the full Tranche payment lifecycle complete based on P4.
Update the access assessment, capability tracker, operator runbook and F0 handoff with actual results and remaining allocation.
Continue to P5 only with two ready sellers and enough remaining budget; do not reset the allocation at the phase boundary.

## Proposed implementation locations

| Location | Responsibility |
|---|---|
| packages/contracts/src/sandbox-protection.ts | Path inputs, resource lineage and sanitized payment evidence |
| packages/core/src/sandbox-policy.ts | Pure path eligibility, approval and predecessor checks |
| packages/paypal/src/protection.ts | Order, authorize, capture and reviewed referenced-release adapters |
| packages/paypal/src/client.ts | Controlled partner context, safe response metadata and assertion handling |
| packages/db/src/sandbox-schema.ts and sandbox-store.ts | Private resource relationships, atomic outcomes and lifecycle accounting |
| apps/agents/scripts/f0/adapters.ts, runner.ts and index.ts | Explicit path registration and operator orchestration |
| Package-local tests and generated migrations | Mocked, persistence and opted-in real sandbox coverage |

Official references were checked on 2026-10-12; unresolved endpoint details above are implementation prerequisites, not inferred account capabilities.
