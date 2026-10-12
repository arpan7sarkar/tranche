# P3 seller-onboarding operator runbook

Date: 2026-10-12.
Status: Offline implementation verified; Indian Seller A consent verified; replacement US seller consent and PPCP product readiness verified through approved read-only maintenance.
Design: [P3 implementation plan](p3-seller-onboarding-implementation-plan.md).
Evidence and limitations: [P3 implementation record](p3-implementation-record.md).
Foundation commands: [P2 runbook](p2-runbook.md).
Implementation closeout: [P3 closeout](p3-closeout.md).

## Agreed execution order

Implement and test P4 offline before actual sandbox onboarding, as requested by the contributor.
Then obtain separate approval for P3 referral execution, complete Seller A's browser consent and verify authoritative readiness and grants.
Only after those checks and the P4 path-specific prerequisites pass may a separately approved P4 payment test run.
Prepare the actual P3 operation near that browser session because its immutable deadline is at most 24 hours; no referral needs to be prepared or sent during P4 development.
The commands below describe future approved execution, not actions authorized by this documentation update.

## What this implements

The operator runner can prepare an onboarding referral for seller-a or seller-b, wait for explicit approval, create it through the outbox and save the consent link privately.
The seller signs in on PayPal and grants permissions there; Tranche does not receive their password or determine their current login session.
Resume checks the intended merchant, tracking identity, platform client grant, requested scopes, active product, payments_receivable and primary_email_confirmed through PayPal's merchant-integration endpoint.
Only a matching and ready integration produces consent_verified and a succeeded operation.
Wrong identity, missing permissions, pending readiness, malformed responses and HTTP permission errors remain incomplete or inconclusive.
P4 now registers order, authorization and capture adapters separately; use the [P4 runbook](p4-runbook.md) for their prerequisites and approvals.
Delayed release and payout adapters remain unavailable.
The generic report's capability field remains not_tested; use its separate onboarding evidence for the observed seller-connection result, not as proof of a payment capability.

## Private prerequisites

Reuse the existing assigned accounts and platform app; seller-specific REST apps are unnecessary for this flow.
Privately confirm the platform merchant ID, intended seller merchant ID, platform client ID, attribution ID and mapping version.
The configured PAYPAL_CLIENT_ID must match the platformClientId in the operation; the private secret stays in .env.
Both merchant IDs must be known before preparation, and platform and seller must be different.
P3 deliberately uses known-ID status reads and implements no arbitrary query strings or tracking lookup.
The supported product vocabulary is EXPRESS_CHECKOUT or PPCP, and the narrow feature vocabulary is PAYMENT with optional REFUND.
Select required scopes and products from the app's reviewed configuration; no default assumes that partner access has been granted.
Additional delayed-disbursement or fee permissions are not requested automatically and must be reviewed with the P4 path.
shareDataConsent must represent actual permission already received to share seller data with PayPal; it does not replace the seller's later PayPal permission approval.
Choose a UTC checkUntil deadline in the future and no more than 24 hours after preparation, plus 1-10 recoveryCalls.
The deadline and read allowance cannot be extended by repeated resume commands.
Arrange the contributor's availability to complete seller consent before actual execution; previously confirmed login access need not be rechecked just for context.

Keep the private input file under the repository's ignored .sandbox-private directory, restricted to the operator's account.
Its structure is SandboxOnboardingInput in packages/contracts/src/sandbox-onboarding.ts: context contains seller, platformMerchantId, sellerMerchantId, platformClientId, mappingVersion, trackingId, partner.attributionId, product, features, requiredScopes, shareDataConsent and checkUntil; recoveryCalls is a sibling of context.
Use a unique, stable trackingId for this seller and retain it after an interrupted request.
Preparation permanently deduplicates platform/seller and platform/tracking identities across runs, even if the mapping version changes.
This release provides no reset, replacement-referral or permission-revocation command.

### Requested product and returned products

The intended replacement payment test uses a US Personal buyer and a separate US Business seller.
The US seller's merchant-integration response returned PPCP_STANDARD and PPCP_CUSTOM with vetting_status SUBSCRIBED, but no EXPRESS_CHECKOUT product, after an EXPRESS_CHECKOUT referral.
Identity, platform grant, required scopes, payments_receivable and primary_email_confirmed passed; the initial EXPRESS_CHECKOUT product check remained incomplete.
The existing verifier supports PPCP requests with subscribed PPCP_STANDARD or PPCP_CUSTOM products, but does not treat them as proof of the separately requested EXPRESS_CHECKOUT product.
PayPal describes the requested products and their response examples in its [before-payment onboarding guide](https://developer.paypal.com/platforms/seller-onboarding/before-payment/).
Do not change an approved or dispatched operation's private JSON or database rows to switch products, reset recovery limits, or create another run to bypass seller deduplication.
The [read-only maintenance flow](sandbox-maintenance-runbook.md) now supports a separately approved check of the existing PPCP subscription and unchanged grants, without replacing the original referral.
The US onboarding operation has exhausted its two original recovery reads; maintenance requires a separate two-call approval rather than another ordinary resume.
The previous Indian-seller order was subsequently verified as unapproved with no authorization or capture, then retired locally through approved maintenance; its reservation is released and its original commitment cannot advance in this runner.
Return and cancel URLs are now included for newly prepared orders, with local informational callback pages that do not confirm or initiate a payment.
No US seller payment order, authorization or capture is authorized by these findings.

## Database and authorization

Review 0002_furry_songbird.sql and select the intended database privately before applying migrations.
This implementation applied migrations only to the isolated test database; it did not migrate the configured application database.
Inspect the existing authorized allocation and account for earlier consumed or held calls; do not select another database or change counters to obtain more allowance.
P3 reserves zero money, and every OAuth, referral, status and refresh attempt still consumes the shared 50-call allowance.
For N configured recovery reads, preparation and claiming require room for 2 + 2N attempts: one referral, its initial OAuth, N reads and up to N recovery OAuth exchanges.
Unused held calls are released on terminal completion; a waiting or inconclusive operation retains its remaining reservation.
This conservative reservation does not guarantee the remaining phases fit within 50 calls.
Before a real referral, explain its seller, product, permissions and request allowance to the contributor and obtain concrete approval.
Offline implementation does not authorize that execution.

## Commands

Run these from the repository root with pnpm; package scripts explicitly load root .env, with existing process environment values taking precedence.
Replace placeholders with local file locations and runner-generated operation IDs, never private merchant IDs or credentials in command arguments.

```powershell
pnpm --filter @tranche/agents-service f0:runner onboard <private-input-file>
pnpm --filter @tranche/agents-service f0:runner inspect <run-id>
pnpm --filter @tranche/agents-service f0:runner approve <operation-id> <payload-hash> 1
pnpm --filter @tranche/agents-service f0:runner resume <operation-id>
pnpm --filter @tranche/agents-service f0:runner consent-file <operation-id>
```

onboard only persists preparation and prints a sanitized approval summary; it sends no PayPal request.
Review the summary, private mapping and exact request before approving.
The first approved resume is the actual referral dispatch and can use OAuth plus one business write.
consent-file returns a private JSON file location, not the token-bearing URL; open that file privately and use its link while signed in as the intended seller.
After completing browser consent, run resume again to make a counted authoritative status read and then inspect or report the run.
No requests occur merely because the runner is waiting for the browser.

```powershell
pnpm --filter @tranche/agents-service f0:runner resume <operation-id>
pnpm --filter @tranche/agents-service f0:runner report <run-id>
pnpm --filter @tranche/agents-service f0:runner refresh-consent <operation-id>
```

Use refresh-consent only when the stored link needs refreshing and a persisted referral ID exists.
It performs a counted GET for the same referral, validates the returned destinations and atomically updates the artifact reference and browser wait; it never creates another referral.
After refresh, request consent-file again because the private file key changes.
If a referral timed out before its ID was saved, resume can verify a matching integration through the known seller ID, but it cannot invent a missing referral ID or issue a replacement POST.
Treat missing evidence as inconclusive and investigate privately without resetting counters.
On deadline or read-limit exhaustion, resume refuses further network work; inspect the existing evidence and allocation rather than repeatedly retrying.

## Verification and optional real test

Routine tests use fake credentials and fake HTTP responses, and database scenarios require the guarded disposable tranche_p2_test database at localhost or 127.0.0.1 port 55432.
Apply migrations to that disposable database first, set DATABASE_URL and TEST_DATABASE_URL to it in the test process, and run the suites without loading application credentials.

```powershell
pnpm --filter @tranche/contracts --filter @tranche/core --filter @tranche/paypal test
pnpm --filter @tranche/db test
pnpm --filter @tranche/agents-service test
pnpm -r typecheck
pnpm biome ci .
```

onboarding.sandbox.test.ts is skipped unless RUN_PAYPAL_P3_SANDBOX_TEST is exactly 1.
It additionally requires PAYPAL_ENV=sandbox, PAYPAL_P3_OPERATION_ID for an existing prepared operation, and PAYPAL_P3_EXPECT_STATE set to waiting_for_browser for referral dispatch or succeeded after actual consent.
The stored operation must already be approved before its first write; the test does not create operations, grant approval, migrate databases or reset allocations.
After explicit authorization for that stage, an operator may set those process variables and run the opt-in test with the intended environment loaded privately.

```powershell
pnpm --filter @tranche/agents-service exec node --env-file-if-exists=../../.env ../../node_modules/vitest/vitest.mjs run scripts/f0/onboarding.sandbox.test.ts
```

Do not enable this test merely to make ordinary CI pass.
Record real results using the [F0 evidence template](f0-evidence-template.md), keeping seller identifiers, attribution values, tokens and URLs private.
Actual partner access, consent and payment readiness remain unproven until this separate execution occurs.

## Official contracts reviewed

Referral construction follows the [Partner Referrals API](https://developer.paypal.com/api/partner-referrals/v2/partner-referrals-create).
Consent-link refresh and merchant/grant verification follow [before-payment onboarding](https://developer.paypal.com/platforms/seller-onboarding/before-payment).
These references establish request and response handling, not permission grants for the project's accounts.
