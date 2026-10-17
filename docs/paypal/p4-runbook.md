# P4 authorization/capture operator runbook

For lost order responses and product creation recovery, see the [recovery runbook](product-recovery-runbook.md).

## Pre-dispatch recovery and authorization cleanup

Update: 2026-10-16, verified offline with the [Phase 1 slice 2 regressions](../phase-1-slice-2-record.md).
For an operation that failed or crashed before any business dispatch, run the explicit retry command to obtain the next hash-bound approval summary.

```powershell
pnpm --filter @tranche/agents-service f0:runner retry-undispatched <operation-id>
pnpm --filter @tranche/agents-service f0:runner inspect <run-id>
```

The retry command sends no PayPal request, requires an expired or cleared worker claim, and retains the immutable request ID, payload, consumed calls, and monetary exposure.
It never reuses a consumed approval; present the returned next-attempt summary and obtain fresh operator approval before approve and resume.
A possibly dispatched operation must use bounded read-only recovery and cannot use this retry path.
The original execution deadline still applies to authorization and capture.

If an authorization is open and capture preparation failed, cleanup is a separate operation with a separate approval.
The private fee input file contains exactly the reviewed integer feeBoundCents; do not assume the fee is zero or reset the campaign allowance.

```powershell
pnpm --filter @tranche/agents-service f0:runner prepare-void <authorization-operation-id> .sandbox-private/void-fee.json
pnpm --filter @tranche/agents-service f0:runner inspect <run-id>
```

Use the local successful authorization operation ID, not a raw provider resource ID.
Repeating prepare-void with the same authorization and fee input returns the existing cleanup operation, including after a timeout or completion, without another reservation or request identity.
Changing the fee input for an existing cleanup returns cleanup_identity_conflict; inspect the persisted operation rather than creating another cleanup.
Before preparing cleanup, clear any definitely undispatched capture claim with retry-undispatched; even after executeUntil, this is allowed within the existing recoverUntil window to make cleanup possible.
Preparation rejects any possibly dispatched capture, active worker, insufficient remaining lifecycle calls, or cumulative fee exposure above the agreed money cap.
The approval summary includes the cleanup fee and call bound, and cleanup preparation blocks later normal payment-stage writes for that commitment.
After reviewing and explicitly approving that cleanup operation, use the existing approve and resume commands with its own operation ID, payload hash, and next attempt.
The first resume sends at most one void POST, and subsequent resumes use only bounded reads to confirm VOIDED against the same order and authorization.
A 200/204 or lost write response alone never marks cleanup complete, and any observed capture blocks this cleanup path.
Cleanup cannot replenish the money cap, and unused capture-fee reservations remain conservative.
Provider access and real sandbox behavior for this path still need separately approved validation.

## Checkout setup

For audited retirement of an unused unapproved order before preparing a replacement, see the [read-only maintenance runbook](sandbox-maintenance-runbook.md).

New private payment inputs must include checkout.returnUrl and checkout.cancelUrl, using the same application origin and the exact paths /sandbox/checkout/return and /sandbox/checkout/cancel.
Use HTTPS for a hosted application, or HTTP on localhost, 127.0.0.1 or ::1 for local sandbox testing; embedded credentials, query parameters, fragments, mismatched origins and other paths are rejected.
For the local test, keep the web app running on the configured callback port and use the same computer for buyer checkout.
The runner includes both URLs in payment_source.paypal.experience_context and displays them in its hash-bound approval summary.
The callback pages ignore buyer-supplied query data in their content and never authorize, capture or confirm a payment; the operator must resume the runner for an authoritative API check.
New order dispatch without checkout destinations is blocked before any PayPal request, while older persisted records remain readable with their original hashes.

Date: 2026-10-12.
Status: Offline implementation verified; the earlier Indian-seller checkout failed with UNSUPPORTED_PAYEE_CURRENCY, while the replacement US-to-US order completed verified buyer approval, USD 1 authorization and capture.
The matching capture was confirmed by counted reads; see the [dated experiment evidence](evidence/p4-us-authorization-capture-2026-10-12.md).
Evidence: [P4 implementation record](p4-implementation-record.md).
Plan: [P4 implementation plan](p4-payment-protection-implementation-plan.md).
Seller consent: [P3 runbook](p3-runbook.md).

## Prerequisites

Use sandbox credentials for the confirmed platform REST app and privately review the intended migrated application's existing allocation.
The generated payment and maintenance migrations were applied to the existing local application database before the actual sandbox experiment.
Complete separately approved P3 onboarding and record successful consent for the same seller, platform app, mapping, tracking ID, product and required permissions.
Use authorization/capture permissions, including the authcapture scope; delayed disbursement is disabled.
Privately establish applicable USD compatibility, endpoint access, minimum principal and conservative sender-fee bounds before requesting approval.
Arrange the buyer's browser session and explain the selected path, accounts, principal, total sender-fee bounds and request reservation.
All phases share $1 total including sender fees and 50 runner-issued API attempts, including OAuth, reads, writes, retries, polling, recovery and cleanup.
These commands describe future separately approved execution; reading this runbook does not authorize PayPal requests.

## Private input

Store a JSON context outside tracked files, such as an ignored .sandbox-private/payment-input.json.
Do not paste actual merchant IDs, app context or checkout URLs into issues, ordinary logs or tracked evidence.
The context requires path=authorization_capture, the full reviewed P3 seller context, buyerMerchantId, buyerMappingVersion, principalCents and feeBounds for create_order, authorize_order and capture_order.
Set executeUntil to a future UTC ISO timestamp no more than 24 hours away and recoverUntil no more than 48 hours away, with recovery no earlier than execution.
Set recoveryCalls to 2, 3 or 4; this is the persistent maximum recovery GET count per stage, not a fresh allowance on each resume.
Principal plus all sender-fee bounds must fit within the remaining shared allowance; a numeric zero is not evidence that fees are absent.
The total request hold is 14+6N for recoveryCalls=N, in addition to already consumed or held calls from other phases.
Use the same P3 seller context and privately verified buyer identity; changed mappings or fees cannot reuse approvals.
Prepare actual inputs near the browser session to avoid consuming the execution window during development.

## Future approved execution

Run commands from the repository root.
Preparation and inspection are local database operations; resume can make actual sandbox requests.

```powershell
pnpm --filter @tranche/agents-service f0:runner protect ../../.sandbox-private/payment-input.json
pnpm --filter @tranche/agents-service f0:runner inspect <run-id>
```

Protect creates an awaiting_approval order operation and atomically reserves the entire payment money and request budget.
It does not send an order or authentication request.
Present the returned purpose, accounts, principal, stage fee, total fee bound, deadlines and call allowance to the contributor and wait for explicit approval before recording it.

```powershell
pnpm --filter @tranche/agents-service f0:runner approve <order-operation-id> <payload-hash> <attempt>
pnpm --filter @tranche/agents-service f0:runner resume <order-operation-id>
pnpm --filter @tranche/agents-service f0:runner checkout-file <order-operation-id>
```

Resume checks recorded P3 consent and current seller readiness before creating the order with a stable PayPal-Request-Id.
Checkout-file prints only the ignored private artifact location; open its URL privately and sign in as the intended Personal buyer.
Buyer approval does not automatically authorize or capture money in this AUTHORIZE flow.

```powershell
pnpm --filter @tranche/agents-service f0:runner resume <order-operation-id>
pnpm --filter @tranche/agents-service f0:runner payment-next <order-operation-id>
```

The first command performs counted reads to verify buyer approval and the matching order details.
Payment-next prepares the authorization only after the order operation succeeds; preparation sends no PayPal request.
Explain that authorization creates a hold, obtain fresh contributor approval, then record and execute that approval.

```powershell
pnpm --filter @tranche/agents-service f0:runner approve <authorization-operation-id> <payload-hash> <attempt>
pnpm --filter @tranche/agents-service f0:runner resume <authorization-operation-id>
pnpm --filter @tranche/agents-service f0:runner payment-next <authorization-operation-id>
```

A successful authorization persists the provider reference and verified expiry; an incomplete response may require a separately reviewed, counted recovery resume before advancing.
Payment-next prepares capture of the matching authorization and does not itself collect money.
Explain the payment purpose, buyer, seller, principal and fees again and obtain fresh contributor approval for capture.

```powershell
pnpm --filter @tranche/agents-service f0:runner approve <capture-operation-id> <payload-hash> <attempt>
pnpm --filter @tranche/agents-service f0:runner resume <capture-operation-id>
pnpm --filter @tranche/agents-service f0:runner resume <capture-operation-id>
pnpm --filter @tranche/agents-service f0:runner report <run-id>
```

The first capture resume checks readiness and predecessor resources, then sends the approved capture once.
The second is read-only confirmation of the order and capture; only terminal matching capture evidence produces succeeded.
Review any error and report it before attempting another resume; the two capture resumes above describe the expected successful sequence, not an automatic retry policy.
An inconclusive write is never repeated automatically, and payment-next never switches paths or creates replacement commitments.
Reports hide provider IDs, client context, assertions and checkout tokens while showing stage state, payment evidence and remaining allocation.
The generic capability field remains not_tested; record actual dated results separately with the [F0 evidence template](f0-evidence-template.md).

## Recovery and stopping

### Change the expected buyer of an existing unapproved order

Changing the buyer does not establish seller currency eligibility or fix UNSUPPORTED_PAYEE_CURRENCY by itself.
The contributor reported creating a US Personal sandbox buyer, confirming its country and a displayed USD 5,000 balance after the original Indian-account checkout failed.
For a fresh database, apply the current generated migration sequence through `0004_gorgeous_spencer_smythe` before using the buyer-change commands.
The existing local sandbox application database used before the P3/P4 merge has an older migration journal; do not run the new sequence against it until that journal and its existing tables are reconciled without resetting payment or allocation records.
Store only buyerMerchantId and buyerMappingVersion in an ignored private JSON file; the mapping version must advance by exactly one.
Do not pass the full payment context or change money, seller, currency, deadlines, fees, recovery policy or provider order references.
Preparation creates a durable proposal with the original and proposed specifications; it makes no PayPal call and changes neither the active buyer nor the allocation.
Only one buyer-change proposal is permitted for each order operation.

```powershell
pnpm --filter @tranche/agents-service f0:runner buyer-change <order-operation-id> ../../.sandbox-private/buyer-change-input.json
pnpm --filter @tranche/agents-service f0:runner inspect <run-id>
```

Present the old and new buyer assignments privately, mapping versions, unchanged USD principal and fees, deadlines, and four additional reserved API attempts before obtaining explicit approval.
Approval reserves four additional calls within the existing shared 50-call cap; the money reservation, provider order, commitment and consumed request count remain unchanged.
These calls cover fresh OAuth and a GET to check the unapproved order, followed by fresh OAuth and a GET to verify the new buyer's browser approval.
The order gets two additional recovery GET slots without resetting its used recovery counter or changing later-stage allowances.
Further failures consume those fixed reservations; this is not an unlimited polling extension.

```powershell
pnpm --filter @tranche/agents-service f0:runner approve-buyer-change <change-id> <approval-hash>
pnpm --filter @tranche/agents-service f0:runner apply-buyer-change <change-id>
```

Apply uses counted reads only and requires a matching CREATED or PAYER_ACTION_REQUIRED order with no recorded buyer identity, authorization or capture.
The transaction checks the current claim, proposal approval, original payload and payment context before replacing the expected buyer locally and recording the applied amendment.
The original request ID, request body, order reference, checkout artifact, money reservation, attempts and recovery counters are preserved.
The original specification and approval remain available in the audit record; their approval cannot authorize a new payment write under the changed context.
Pending proposals block ordinary order recovery, and no new order or money-moving write is issued by these commands.
Apply failure leaves the active buyer unchanged and the approved proposal unresolved for review; do not reset accounting or replay the create-order POST.
No proposal cancellation, replacement order or automated resolution is implemented.
After successful application, open the same private checkout link as the new buyer and resume the existing order for authoritative identity verification.
If the old buyer approves during the browser pause or between the provider read and local amendment, subsequent identity verification blocks advancement.
Authorization and capture still require their own fresh approvals after the correct buyer is verified.

Each resume may need a fresh OAuth request and consumes the existing reservation.
For authorization or capture recovery, one resume may consume two recovery GETs; capture with N=2 allows one such confirmation pass.
Pending capture, missing references, wrong buyer/seller, revoked grants, invalid amounts, stale readiness or exhausted calls must remain unresolved rather than becoming successful.
The 24-hour execution limit blocks new writes, while the separate bounded recovery window permits implemented reads only.
No expiry, refund or void resets the spend allowance, and no reservation-extension command exists.
The separately approved prepare-void path described above provides authorization cleanup within the existing recovery window.
Do not run standalone preflight calls as an uncounted substitute during an active experiment.

## Opt-in real integration test

Routine tests mock PayPal and leave the real P3 and P4 tests disabled.
After concrete execution approval is recorded, the P4 test can resume one existing operation; it does not create or approve operations, migrate databases or reset allowances.
Set RUN_PAYPAL_P4_SANDBOX_TEST=1, PAYPAL_ENV=sandbox, PAYPAL_P4_OPERATION_ID to that existing operation ID and PAYPAL_P4_EXPECT_STATE to its reviewed expected result: waiting_for_browser, succeeded or inconclusive.
Use inconclusive for the expected first capture response while its final read remains pending.

```powershell
pnpm --filter @tranche/agents-service exec node --env-file-if-exists=../../.env ../../node_modules/vitest/vitest.mjs run scripts/f0/protection.sandbox.test.ts
```

Do not enable the test until P3 readiness, endpoint prerequisites, applicable fees, remaining allocation and the concrete stage approval are confirmed.
