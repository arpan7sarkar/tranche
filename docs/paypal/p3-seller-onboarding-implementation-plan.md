# P3 seller-onboarding implementation plan

Date: 2026-10-12.
Status: Offline adapter implementation verified on 2026-10-12; actual sandbox onboarding remains not tested.
Delivered behavior and tests: [P3 implementation record](p3-implementation-record.md).
Operator commands and current prerequisites: [P3 runbook](p3-runbook.md).
Implementation closeout: [P3 closeout](p3-closeout.md).
Agreed scheduling: Complete P4 offline implementation first, then separately validate P3 onboarding before any P4 payment experiment.
The ordered steps below retain the reviewed design; the implementation record identifies delivered choices and remaining execution work.
Parent: [F0 plan](f0-plan.md).
Starting evidence: [P2 closeout](p2-closeout.md), [P2 runbook](p2-runbook.md), [P1 assessment](evidence/p1-access-assessment.md).
Next phase: [P4 payment protection](p4-payment-protection-implementation-plan.md).

## Outcome and scope

Implement and test the platform-to-seller onboarding flow using the durable P2 runner.
Start with seller-a, then repeat separately for seller-b when needed for P5 and when the remaining request allocation permits.
Record referral acceptance, browser consent, merchant association, payment readiness and granted permissions as distinct facts.
This phase transfers no funds, but its OAuth, referral and status requests consume the shared 50-attempt allocation.
Writing this plan does not authorize real referral creation, permission changes, account creation or payments.
Offline implementation can proceed before arranging browser participation; actual execution requires the contributor to be available.

## Existing inputs and prerequisites

Reuse the assigned platform, buyer, seller-a and seller-b accounts and supplied private screenshots.
The platform and both sellers are distinct Business accounts; all four logins and displayed USD balances are contributor-confirmed.
The platform REST credential association is already confirmed; do not request seller-specific REST apps as a default setup step.
Partner approval and seller grants are not proven by the checked dashboard features or successful OAuth.
Privately locate the platform merchant identifier, seller identifiers where known, and sandbox attribution configuration without copying them into docs or arguments.
Before real requests, inspect the intended runner database, review/apply migrations as needed and read its existing allocation; never initialize another allowance to bypass limits.
Document required product and feature names from the selected official onboarding contract and the app's actual configuration.
Only request the permissions needed for the next supported experiment; do not copy every feature from an example.

## Endpoint contract to review before coding

The [Partner Referrals reference](https://developer.paypal.com/api/partner-referrals/v2/) documents POST /v2/customer/partner-referrals and GET /v2/customer/partner-referrals/{partner_referral_id}.
Use the [create-referral contract](https://developer.paypal.com/api/partner-referrals/v2/partner-referrals-create) to validate tracking identity, selected products, requested operations and consent fields.
For authoritative readiness, the [before-payment onboarding guide](https://developer.paypal.com/docs/multiparty/seller-onboarding/before-payment/) describes GET /v1/customer/partners/{partner_id}/merchant-integrations/{seller_id}, and lookup by tracking_id when necessary.
Check payments_receivable, primary_email_confirmed and grants associated with our platform integration; a referral response or browser-return query alone does not prove these.
Recheck the exact response schemas, requested product requirements and endpoint idempotency rules when implementing; do not infer request-ID retention from the generic header requirement.

## Step 1: Add typed onboarding inputs and results

Extend packages/contracts with strict onboarding input, private resource-reference and sanitized evidence schemas.
Bind the seller alias, stable tracking identity, requested permissions, product configuration and private mapping version to the immutable operation request.
Represent referral_created, waiting_for_consent, consent_verified, readiness_incomplete and inconclusive as adapter evidence, without treating generic runner success as payment readiness.
Represent denied permission, malformed input and unavailable prerequisites separately.
The existing onboard_seller operation reserves zero principal and zero sender fees; it still requires the runner's concrete business-write approval.
Keep MilestoneState and agent interfaces unchanged.

## Step 2: Persist referral references and private mappings

Extend sandbox-schema.ts and sandbox-store.ts with the minimal typed referral/resource and evidence records required by the adapter.
Persist the tracking identity before dispatch, with uniqueness scoped to the platform and seller mapping.
After a valid provider response, atomically save the referral identifier, resource relationship, browser-artifact key and state transition.
Store only validated necessary fields; do not persist raw provider responses, OAuth tokens or assertion tokens.
Keep merchant identifiers and account mappings in access-controlled storage and expose aliases in reports.
A resource identifier must not exist only in adapter memory or stdout if resume depends on it.
Generate and review migrations through Drizzle and verify them against the disposable database first.

## Step 3: Extend the transport narrowly

Add a typed, validated PayPal-Partner-Attribution-Id context when the selected endpoint requires it.
Do not allow arbitrary header overrides of Authorization, PayPal-Request-Id or the sandbox destination.
The existing path validator rejects query strings; prefer known merchant identifiers for status reads where available.
If tracking lookup is necessary, add structured, allowlisted query parameters and safe serialization rather than weakening the validator to accept arbitrary URLs.
Bind the non-secret partner/merchant context to the prepared operation; changing account context must invalidate approval.
Preserve counted OAuth, request reservations, timeouts, manual redirects and no automatic write retries.
Return only the safe status/error metadata needed to distinguish permission failures from malformed requests, excluding provider messages and private payloads.

## Step 4: Implement the onboarding adapter

Add the adapter in packages/paypal and wire its runner-facing registration under apps/agents/scripts/f0.
Validate that the exact stored request matches the selected seller mapping, approved permissions and onboarding contract before claiming it.
Create the referral only through the existing outbox, stable request ID, approval and dispatch permit.
Validate provider-returned API and browser destinations separately.
Save the consent link through the private-artifact store and persist the expected seller and resource before pausing.
Expose the link only through a deliberate private operator action, not ordinary output.
On resume, retrieve authoritative integration status and compare merchant identity and grants with the intended seller and platform.
If required permissions are missing, retain incomplete readiness rather than reporting onboarding as usable for P4.
Do not add webhooks or a product UI; this F0 adapter confirms status through counted reads.

## Step 5: Recovery and request budgeting

Before execution, estimate one referral write, any tracking lookup, readiness reads, actual OAuth calls and a bounded recovery allowance.
Read persisted counters and leave room for P4 and later probes; no fixed estimate guarantees that all phases fit within 50 calls.
Preserve tracking and request identities after a timeout; use documented referral or integration reads where identifiers make that possible.
If no identifier or reliable lookup can establish whether the referral exists, report inconclusive and do not send a replacement POST automatically.
Keep browser waiting separate from network polling so an idle browser interval consumes no runner requests.
Bound readiness polling by both a persistent per-operation read count and deadline, including across repeated resume commands.
If refresh of a private consent link is needed, confirm the documented read behavior and count that request; do not create another referral as an implicit refresh.

## Step 6: Verify before real execution

| Test area | Required cases |
|---|---|
| Contracts | Wrong seller/platform mapping, unsupported product, extra fields, mismatched permissions and changed payload |
| Transport | Attribution context, safe tracking lookup, redirects, permission failures, malformed responses and redaction |
| Persistence | Referral references survive restart; resource/state saving is atomic; duplicate tracking identities cannot dispatch twice |
| Browser consent | Correct seller, denied consent, missing grants, pending readiness, wrong merchant and private-link storage |
| Recovery | Timeout before referral ID persistence, restart after provider success, bounded reads and no blind referral resend |
| Limits | OAuth/referral/reads all counted, exhaustion stops dispatch and existing money allocation remains unchanged |
| Regression | Preserve the P2 scenarios and 54 P1 preflight tests; run affected typechecks and Biome |

Use fake credentials and injected transport for routine tests, plus a disposable PostgreSQL database for resource persistence and recovery.
Add explicitly opted-in real sandbox tests only after the adapter and its safeguards pass locally.
Document exact commands after they exist; this plan does not introduce a new runnable onboarding command.

## Step 7: Run the actual sandbox onboarding test

Confirm the contributor's availability for seller-a consent without repeating the already completed login checks.
Present the non-payment referral purpose, selected seller, requested permissions and request-budget estimate, then obtain the concrete operator approval required by the runner.
Create one referral, have the contributor complete consent privately as seller-a, and resume with counted status reads.
Capture sanitized dated evidence using the [F0 evidence template](f0-evidence-template.md).
Record the observed merchant association, readiness fields, required grants, remaining allocation and unresolved resources.
Only repeat for seller-b when requested or needed for the next eligible phase; use separate tracking and evidence records.

## Exit criteria and handoff

Implementation is complete when the adapter, necessary persistence/transport extensions and relevant offline/database tests pass.
P3 capability success additionally requires an actual seller consent and authoritative readiness/grant evidence for the tested configuration.
If partner access or browser availability prevents that test, record implementation status and the precise execution blocker separately; do not claim successful onboarding.
A permission denial applies to the tested app/configuration and is not proof that PayPal onboarding is universally unsupported.
Update the runbook, assessment, capability tracker and F0 handoff with actual commands, evidence and remaining allocation.
Hand P4 the verified seller mapping and grants, or the exact missing prerequisite.

## Proposed implementation locations

| Location | Responsibility |
|---|---|
| packages/contracts/src/sandbox-onboarding.ts | Typed onboarding inputs, resource relationships and evidence |
| packages/paypal/src/onboarding.ts | Referral construction, response validation and readiness reads |
| packages/paypal/src/client.ts | Controlled partner context, optional structured lookup and safe response metadata |
| packages/db/src/sandbox-schema.ts and sandbox-store.ts | Durable referral references, mapping versions and evidence transitions |
| apps/agents/scripts/f0/adapters.ts and index.ts | Reviewed onboarding registration and explicit operator entry points |
| apps/agents/scripts/f0/private-artifacts.ts | Existing private browser-link storage reused and tested |
| Package-local tests and generated migrations | Offline, database and explicitly opted-in sandbox coverage |

File boundaries are proposed; keep the implementation small and review any shared schema changes deliberately.
Official references were checked on 2026-10-12; documentation describes the intended contract, not proven access for our accounts.
