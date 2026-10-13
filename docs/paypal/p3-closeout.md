# P3 implementation closeout and P4 handoff

Date: 2026-10-12.
Status: Complete for offline seller-onboarding implementation and verification.
Actual PayPal onboarding: Deferred until after P4 offline implementation, as agreed with the contributor.
Capability status: not_tested; this closeout does not establish successful sandbox consent or granted permissions.
Evidence: [P3 implementation record](p3-implementation-record.md).
Commands and prerequisites: [P3 runbook](p3-runbook.md).
Next implementation: [P4 payment-protection plan](p4-payment-protection-implementation-plan.md).

## What P3 completed

P3 adds deterministic seller onboarding to the durable P2 operator runner.
The platform can prepare a zero-dollar referral, obtain operator approval, request a PayPal consent link and pause for the intended seller's browser action.
The link is stored in an ignored private artifact file; ordinary output contains its file location rather than its token-bearing URL.
Referral references, tracking identity, mapping version, browser progress, observations and deadlines survive restart.
After browser consent, the adapter checks the known seller's merchant-integration record and matches merchant identity, tracking identity and the configured platform client grant.
It verifies requested scopes, product readiness, payments_receivable and primary_email_confirmed before reporting consent_verified.
Incomplete permissions, wrong identities, malformed responses and unavailable prerequisites remain incomplete or inconclusive.
Duplicate prevention, payload-bound approvals, counted requests and read-only recovery reuse the P2 foundation.
Consent-link refresh uses a counted GET for the existing referral and does not send a replacement POST.
The generated 0002_furry_songbird migration adds durable onboarding storage on top of the merged foundation and P2 migrations.
The real sandbox test is disabled by default and requires explicit opt-in plus an existing approved operation.

## Completion evidence

| Criterion | Recorded result |
|---|---|
| Strict inputs and sanitized output | Contracts reject invalid mappings, unsupported permissions, extra fields and unsafe attribution context |
| Exact referral and permission checks | Mocked transport verifies request construction, sandbox destinations, matching grants and seller readiness |
| Restart-safe progress | Disposable PostgreSQL tests verify persistent resources, browser waits and atomic state/evidence updates |
| Approval and duplicate protection | Tests verify changed context, wrong app, duplicate identities, concurrent dispatch and stale claims |
| Bounded recovery | Tests verify ambiguous writes, private-storage failure, same-referral refresh, deadlines and persistent read limits |
| Shared limits and privacy | Tests verify zero money use, OAuth/read counting, 50-call enforcement and sanitized reports |
| Regression validation | 295 tests passed across contracts, core, PayPal, foundation database and agents |
| Database coverage | All 18 original P2 and 19 new P3 database cases ran; none were skipped |
| Real integration test | One intentionally skipped opt-in test; actual PayPal behavior remains unverified |
| Static checks | All eight package typechecks and Biome CI across 85 files passed |
| Migration and documentation checks | Isolated database migration, no schema drift, local links, whitespace and configured-credential privacy checks passed |

These are previously executed implementation checks recorded in the P3 record; this documentation closeout does not claim another runtime test run.
PayPal transport was mocked throughout routine testing, with synthetic mappings and a guarded local database.
No real OAuth, referral, seller-status request or payment was made during P3 implementation.
The configured application database, existing .env credentials and PayPal account settings were unchanged.
The isolated test container was stopped after verification.
This document does not establish commit, push or merge status.

## Boundaries and deferred evidence

The current adapter requires known platform and seller merchant IDs; arbitrary tracking queries are not implemented.
Supported onboarding products are EXPRESS_CHECKOUT/PPCP with PAYMENT and optional REFUND.
Additional permissions needed for delayed disbursement or platform fees must be reviewed with the selected P4 path rather than assumed granted.
Each operation has an immutable recovery-read allowance and a deadline no more than 24 hours after preparation.
Prepare the actual referral near the scheduled browser session, not during P4 development, so its deadline is not consumed while implementation continues.
If an ambiguous write loses the referral ID, matching authoritative integration evidence may still confirm consent, but the adapter cannot invent a missing link or automatically create a replacement referral.
No product UI, invitation email, webhook processor, payment adapter or bank-account inspection is included in P3.
Actual partner access, seller consent, product activation, permissions and transaction suitability remain unproven for the project's accounts.
P1's future browser-operator availability item remains open; existing login and account-role confirmations need not be repeated merely to establish context.
The application database still needs private selection and reviewed migration application before actual runner execution.

## Agreed next steps

1. Implement and test P4 offline using mocked PayPal responses and an isolated database, following its reviewed plan.
2. Review the selected path's prerequisites and align the P3 permission configuration with that path before actual referral creation.
3. Privately verify account mappings, app context, the intended database's existing allocation and browser availability.
4. Present the concrete P3 referral purpose, seller, permissions and request allowance for approval, then run onboarding and have the contributor complete Seller A's consent.
5. Verify and record authoritative P3 seller readiness and grants; leave the payment test blocked if required evidence is missing.
6. Present the concrete P4 payment purpose, sender, recipient, principal and sender fees for separate approval before any money-moving test or subsequent dispatch.

Offline P4 work can proceed while P3's actual validation is deferred; real P4 payment execution depends on successful P3 readiness and the path-specific gates.
All phases share the existing $1 total allowance including sender fees and 50 runner-issued API attempts, including OAuth, reads, writes, retries, polling, recovery and cleanup.
No phase, new run, database switch or restart resets the authorized allowance, and no increase is authorized.
