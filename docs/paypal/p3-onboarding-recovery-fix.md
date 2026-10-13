# P3 onboarding recovery fix

Date: 2026-10-12.
Status: Implemented and verified offline on the P3 branch.
Operator instructions: [P3 runbook](p3-runbook.md).

## Why this change exists

A referral POST can reach PayPal while its response is lost before the runner saves the referral ID and browser link.
A pre-consent merchant status read can then return 404, which does not establish that no referral was created.
The original seller and tracking uniqueness keys remain reserved so another referral cannot be sent accidentally.
Before this fix, there was no approved path to recover a known original referral ID, unused call reservations remained held after expiry, and a transient status failure hid a saved consent file.

## Behavior

The operator can privately supply an authoritative original referral ID in a file containing `{"referralId":"PROVIDER_REFERRAL_ID"}`.
The `referral-recovery` command records a proposal bound to the original operation, approved request hash and request ID without making a PayPal request.
The `approve-referral-recovery` command reserves two calls under the existing shared 50-call limit.
The `apply-referral-recovery` command makes one OAuth request and one GET by that ID, then requires the returned referral ID, submitter client ID and tracking ID to match the original operation.
A matching action link is validated and saved only in the ignored private artifact directory, and the original operation returns to browser wait without another referral POST.
A failed read or mismatch records the consumed calls, releases any unused calls from that attempt and requires fresh approval before another try.
The runner never automatically replays the referral POST because the reviewed Partner Referrals create reference does not explicitly confirm endpoint-specific `PayPal-Request-Id` replay support.
If no authoritative referral ID is available, the case remains unresolved and the seller/tracking keys stay reserved.

Onboarding that reaches its deadline or uses its recovery allowance becomes blocked and atomically releases unused held calls.
The operation keeps its consumed attempts and provider evidence for audit.
A transient 404, 5xx or network error during a funded status read keeps an existing browser wait and consent file available without marking the seller ready.
The `consent-file` command also accepts an older inconclusive operation when its original referral, seller wait and private artifact still match and its deadline remains open.
It returns an absolute file path and does not print the token-bearing URL or make a PayPal request.

## Limits and verification

The original deadline and unused recovery-read allowance still apply to a known-ID recovery.
One referral-recovery proposal is stored per onboarding operation; no new seller onboarding is created by this command.
Offline tests used synthetic accounts and mocked PayPal responses against a disposable PostgreSQL database.
The final P3 agents suite passed 105 tests with its one opt-in real-sandbox test skipped; contracts passed 76, core 73, PayPal 39 and database 11.
All eight workspaces passed typechecking, Biome passed for the changed source, and a second Drizzle generation reported no schema drift.
No real PayPal referral, payment or configured application database record was changed to verify this fix.
The [PayPal create reference](https://developer.paypal.com/api/partner-referrals/v2/partner-referrals-create) and [known-ID read reference](https://developer.paypal.com/api/partner-referrals/v2/partner-referrals-read/) are the provider contract consulted for this recovery route.
