# P4 delayed-disbursement follow-up plan

Date: 2026-10-12.
Status: Planned and blocked on the referenced-release confirmation and recovery contract, seller permission, and a new agreed payment-test budget.
Owner: Implementing contributor and sandbox account owner.
Parent: [P4 payment-protection plan](p4-payment-protection-implementation-plan.md).
Existing test result: [US authorization and capture evidence](evidence/p4-us-authorization-capture-2026-10-12.md).

## Goal and boundary

Implement and verify the second single-seller protection path: capture a buyer payment with delayed disbursement, confirm that the capture is held for the seller, then release that exact capture through PayPal's referenced-payouts endpoint and confirm the outcome.
The completed US-to-US AUTHORIZE, authorization and capture experiment proves only the alternative path and cannot be reused as a delayed capture or release test.
This follow-up is a sandbox capability experiment; milestone verification, client release UI, scheduled auto-release, renewals, webhooks and production reconciliation remain separate work.
Do not call a delayed capture a buyer authorization hold, and do not call an accepted release request a completed seller disbursement.

## Current evidence and constraints

The existing runner has shared USD 1 total-principal and 50-request limits, a durable outbox, private resource references, seller-readiness checks, and separately approved writes for the authorization/capture path.
The live experiment committed the full USD 1 principal and consumed 40 of 50 API attempts, leaving no principal for another payment experiment under the existing agreement.
No database reset, second database, refunded amount, or unused request allowance restores that principal budget.
The tested US seller's existing P3 verification establishes the recorded PAYMENT and REFUND grants, but does not establish a DELAY_FUNDS_DISBURSEMENT seller grant.
The current P4 contracts and adapters accept only `authorization_capture`; no delayed order, capture, or referenced-release operation is registered.
The developer dashboard's delayed-disbursement checkbox is an app setting, not proof that this seller granted the feature or that a specific delayed request will succeed.

## PayPal contract gate before coding a release adapter

Use the current [PayPal delayed-disbursement guide](https://developer.paypal.com/platforms/checkout/delayed-disbursement/) and [Orders v2 purchase-unit schema](https://developer.paypal.com/api/orders/v2/definitions/purchase_unit) as the starting sources.
The guide describes a `CAPTURE` intent order with `purchase_units[].payment_instruction.disbursement_mode` set to `DELAYED`, a capture after buyer approval, and a later POST to `/v1/payments/referenced-payouts-items` using the capture ID as `reference_id` with `reference_type: TRANSACTION_ID`.
It states that PayPal automatically disburses after 28 days, so the experiment must not describe this as an indefinite hold.
The [seller-onboarding checklist](https://developer.paypal.com/platforms/seller-onboarding/onboarding-checklist/) requires the app's configured features to match the referral request and identifies DELAY_FUNDS_DISBURSEMENT as a seller feature.

Before registering the release operation, document and validate the endpoint's supported `PayPal-Request-Id` behavior, response shape, pending and terminal states, and authoritative lookup or reconciliation path after timeout or lost response.
Determine what evidence distinguishes delayed capture from ordinary completed capture, which capture state permits release, how to recognize automatic disbursement, and whether the release response alone proves recipient receipt.
Check whether this platform app and the chosen seller can use referenced release, including any country, product, partner, or seller-grant restrictions.
Resolve those facts from official API material or sanitized sandbox evidence without creating a payment; if they remain unknown, leave the release adapter unregistered and do not send a delayed capture.
Treat any live sandbox diagnostic request as a counted campaign request and obtain the appropriate operator authorization before using remaining calls.

## Implementation order

### 1. Record seller and app eligibility

Privately inspect the platform app's delayed-disbursement setting and the intended US seller's actual consent and merchant-integration evidence.
If DELAY_FUNDS_DISBURSEMENT is absent, determine the supported re-onboarding or permission-upgrade procedure and obtain seller browser consent again when required.
Do not reinterpret the existing PAYMENT and REFUND grant or silently alter the approved onboarding context.
Extend `packages/contracts/src/sandbox-onboarding.ts` and the P3 verifier only for documented fields needed to prove the new grant.
Use a versioned seller mapping and an audited approval so old payment requests and P3 evidence remain immutable.
The readiness result must identify the platform app, seller, product, feature grant, required scopes, observation time and any missing prerequisite.

### 2. Define delayed-path contracts and policy

Add an explicit delayed-disbursement payment path in `packages/contracts/src/sandbox-protection.ts`, with distinct create-order, capture-order and referenced-release stages and evidence states.
Bind the path, single seller, buyer mapping, USD principal, sender-fee bounds, checkout destinations, seller permission version, deadlines and full request allowance to the reviewed approval payload.
Represent provider order, capture and release references separately, and require the exact capture ID from the selected purchase unit for release.
Extend pure `packages/core` policy to reject an immediate capture as delayed evidence, cross-seller or cross-commitment release, duplicate release, release before confirmed delayed capture, changed amount, expired local deadline, and a missing current grant.
Keep platform fees out of the request unless a separately reviewed requirement and PARTNER_FEE grant justify them.

### 3. Extend durable accounting and outbox state

Add only the necessary fields and generated Drizzle migration in `packages/db` for delayed capture/release references, provider status, evidence timestamps and recoverable operation state.
Reserve the entire delayed lifecycle's principal, bounded fees, authentication, readiness reads, writes, confirmation reads and recovery calls before the first order write.
Count each runner-issued PayPal request once under the same persistent allocation and keep the principal committed after capture; a failed release does not free it.
Give each write one stable outbox identity and `PayPal-Request-Id`, and persist response references before advancing to the next stage.
On crash or timeout, reconcile the known provider resource through the verified read path before deciding whether another dispatch is safe.
If the release endpoint lacks a safe idempotency and recovery contract, the state must stop as unresolved rather than retry or claim success.
Generate migrations with `pnpm --filter @tranche/db db:generate`, review them, and test them on the disposable PostgreSQL database before any application-database migration.

### 4. Add sandbox transport and runner stages

Build the exact reviewed `CAPTURE` plus `DELAYED` order request in `packages/paypal`, preserving the existing validated return and cancel destinations and seller assertion/partner attribution handling.
Use PayPal API reads after the buyer returns to verify the expected buyer, seller, amount, order state and absence of prior capture before allowing a separately approved order capture.
Verify the capture ID, USD amount, seller and delayed-disbursement evidence with authoritative provider data before preparing a release.
Implement referenced release only after the contract gate above is satisfied, using the persisted matching capture ID and a separate concrete operator approval.
Make the runner's report distinguish `buyer_approved`, `captured_delayed`, `release_pending`, `released`, `auto_disbursed`, `failed` and `inconclusive` only where provider evidence supports them.
Keep browser callback pages informational and never infer payment or release success from a redirect.
Do not add live-host fallbacks or reuse the previously captured authorization-path order.

### 5. Verify offline before another payment

Add contract and pure-policy tests for wrong path, missing grant, mixed identities, altered amount, incorrect capture reference, expired deadline and duplicate release.
Add PayPal transport tests for exact delayed order fields, bounded response parsing, partner and assertion headers, stable request ID and safe redaction.
Add disposable-database runner tests for success, pending release, lost release response, restart recovery, concurrent workers, exhausted calls, seller-grant revocation and automatic-disbursement observation where a verified provider fixture supports it.
Use a mocked browser return followed by authoritative reads, and ensure malformed or mismatched provider data cannot advance the stage.
Run affected package typechecks, relevant Vitest suites, Biome checks, migration consistency checks and `git diff --check`.
Do not make a real PayPal payment merely to satisfy an offline test.

### 6. Prepare a separately approved live experiment

After offline checks pass, privately confirm the chosen buyer and seller, active seller grant, applicable USD minimum, available funding, sender-fee bound, and the provider's release/recovery behavior.
Agree a new total-principal and request-call budget with the contributor before preparing a new payment; the existing USD 1 campaign remains spent and its 40 consumed calls stay recorded.
Present the exact buyer, seller, principal, any sender fees, expected provider states, auto-disbursement deadline, normal and recovery call count, and each proposed write before asking for approval.
Create the delayed order only after its approval, pause for the buyer's browser action, and separately approve capture and later release.
Record sanitized provider statuses, private resource references, each approval, API-call accounting, and unresolved results using the [F0 evidence template](f0-evidence-template.md).
Do not start a delayed experiment if recipient release cannot be confirmed or safely recovered within the approved limits.

## Completion criteria and handoff

The delayed adapter is implementation-complete only when the provider contract gate is resolved, the seller grant is verified, all writes are approval-bound and outboxed, lifecycle limits persist across restarts, and the offline/database checks pass.
The delayed path is capability-verified only when actual sandbox reads confirm one matching delayed capture and its subsequent referenced release for the same seller and amount.
If the provider response establishes only submission or an ambiguous pending state, report `inconclusive` and the exact missing evidence instead of `released`.
Record the tested region, app, seller and amount as the limit of the conclusion; do not infer support for multiple payees, Payouts, automatic milestone release or other countries.
Update the P4 runbook, implementation record, F0 capability tracker and dated evidence before moving to P5 or P6.
If the contract or permissions gate cannot be resolved, close the follow-up as blocked while retaining the already verified authorization/capture alternative.
