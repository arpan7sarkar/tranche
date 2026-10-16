# Phase 1 slice 2 implementation record

Date: 2026-10-16.
Baseline: `b994685` on `fix/f0-test-setup-and-budget-rules`.
Scope: F0-01 pre-dispatch recovery and approved authorization cleanup, plus F0-05 referral-recovery crash handling.
Both units are implemented and verified locally with fake providers; real PayPal behavior remains unverified for these changes.

## Reproduction before implementation

Seven new CLI/runner regression cases were executed before production changes, and all seven failed.
Three demonstrated missing recovery after OAuth, seller-status, and readiness failures before a payment write.
Three demonstrated failed referral recovery after an expired lease, with zero, one, or two issued requests.
The final case demonstrated the missing separately approved cleanup path after capture preparation failed.
These cases used only the guarded disposable database and fake HTTP responses.

## Implemented recovery behavior

`retry-undispatched` locks the operation and allocation, validates the persisted payload hash, and requires every business attempt to be marked undispatched.
It rejects a live worker and any possibly dispatched operation, retains the original request ID and immutable payload, and returns the operation to awaiting_approval for the next attempt.
Consumed calls and monetary reservations never reset; unused stage calls return to the existing payment allowance, rather than creating a new allowance.
Expired workers lose their token and cannot dispatch or settle after recovery.
Capture execution retains its original deadline, while preparation for separately approved cleanup remains possible within recoverUntil.

Referral recovery now replaces an expired worker's token when that worker issued no requests, preserving the existing approved reservation.
If the worker already issued OAuth or GET requests, the same recovery row returns to awaiting_approval, retaining consumed calls and returning only the unused portion of that specific two-call reservation.
Fresh approval reserves the next bounded read pair against the same global cap, original deadline, and persisted recovery-read limit.
Active workers, stale settlement, altered referral identity, and allowance exhaustion are rejected.
No reclaim path creates or repeats a referral POST.

## Approved cleanup

`prepare-void` creates a separate void_authorization operation from the successful authorization operation and an explicit private fee-bound input.
It reuses the original commitment and verified references, reserves the reviewed cleanup fee, and uses remaining lifecycle calls without increasing the global allowance.
Existing payment stages cannot dispatch once cleanup is prepared.
Cleanup is refused when capture may have dispatched, another worker is active, or the order or authorization cannot be matched.
The adapter checks the order and live authorization before one journaled POST with its own stable request ID.
A successful 200/204 response or a lost response remains inconclusive until bounded order and authorization GETs confirm VOIDED for the matching uncaptured authorization.
Read-back checks bind the amount, buyer, seller, commitment, order, and authorization; any observed capture prevents this cleanup path.
Voiding does not replenish the campaign's money budget, and unused original capture-fee reservations remain conservative.

The [PayPal void endpoint reference](https://developer.paypal.com/api/payments/v2/authorizations-void/) was checked for the endpoint, request-ID header, successful response forms, and fully captured authorization restriction.
This documentation check does not prove seller access, fees, provider retention, or real sandbox behavior.
No automatic replay of a possibly dispatched write was introduced.

## Validation

| Executed check | Result |
| --- | --- |
| Initial runner regression selection before fixes | Seven expected failures. |
| `pnpm --filter @tranche/agents-service exec vitest run --silent` | 203 passed; two real-sandbox cases skipped. |
| `pnpm --filter @tranche/contracts --filter @tranche/core --filter @tranche/paypal test` | Contracts 104 passed, core 125 passed, PayPal 99 passed and four real-sandbox cases skipped. |
| Affected package typechecks | Contracts, core, DB, PayPal, and agents-service passed. |
| Biome on changed TypeScript files | Passed after fixing formatting, imports, and an unsafe optional-chain assertion. |
| `git diff --check` | Passed. |

The final commands total 531 passing tests and six intentionally skipped real-sandbox cases.
The agents run explicitly set DATABASE_URL and TEST_DATABASE_URL to localhost:55432/tranche_p2_test and disabled live sandbox test flags.
Database scenarios also create separate prefixed application-test databases on that isolated server.
Docker Desktop was started and the disposable Compose test service was brought up and migrated; no application database or real experiment allocation was reset.
One intermediate negative test was corrected to model an actually lost capture response instead of a known pending response.
No PayPal calls, real approvals, new schema migrations, commits, pushes, or deployment occurred.
Remote CI and a full web build were not run.

## Next checkpoint

F0-02 lost-order recovery and P7 remain for Phase 1 slice 3.
BASE-01 product outbox corrections remain for slice 4.
See the consolidated [implementation plan and status](remaining_work.md).
