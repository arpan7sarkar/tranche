# P4 US sandbox authorization and capture evidence

## Identity and scope

| Field | Observed value |
|---|---|
| Experiment | P4 US buyer to US Business seller, 2026-10-12 |
| Environment | PayPal sandbox |
| App and accounts | Confirmed platform app, US Personal buyer, verified US Business seller |
| Country and currency | US to US, USD |
| Intent and path | AUTHORIZE, authorization then capture |
| Principal and sender-fee bound | USD 1.00 principal, zero additional sender-fee bound in the approved runner context |
| Campaign limit | USD 1 total principal including allowed sender fees, 50 runner-issued API attempts |
| Local run | `af2949fa-2a35-4af7-879a-02f1f901d50a` |
| Local order operation | `c23c3f2c-cb15-4c5b-a0c1-78b303c91b85` |
| Local authorization operation | `3a04f412-98ad-461c-968f-9cd59e0c0109` |
| Local capture operation | `a012f274-4a9b-4c62-bfe7-6f565501fc6e` |
| Capability conclusion | Authorization and capture succeeded for this transaction; delayed disbursement and milestone release remain untested |

Provider order, authorization, capture and account identifiers remain in the local database and ignored private artifacts.
The actual code revision is uncommitted at the time of this record; this evidence must travel with the matching P4 code and migrations.

## Prerequisites and execution

The seller's existing PPCP subscription, platform connection, required grants, payments receivable and email confirmation were verified in the approved P3 product-readiness amendment.
The contributor confirmed the US Personal buyer and US Business seller and approved each payment write separately.

| Step | Observed result | Shared API attempts after step |
|---|---|---:|
| Create USD 1 AUTHORIZE order after approval | Order created and browser checkout offered | 26 |
| Buyer completes checkout, runner performs counted order reads | Expected buyer, seller, amount and buyer approval verified | 28 |
| Authorize after separate approval | Matching authorization succeeded | 32 |
| Capture after separate approval | Write was sent once; initial runner state was inconclusive pending reads | 37 |
| Resume same capture operation for read-only confirmation | Matching capture confirmed; runner state succeeded with `captured_immediate` evidence | 40 |

All three business-write stages used attempt one of their own hash-bound approval and stable outbox operation.
The final runner allocation reports 40 of 50 API attempts consumed, zero held calls, zero reserved cents and 100 committed cents.
The runner's `committedCents` is campaign accounting; the authoritative capture evidence is the basis for concluding this USD 1 payment was collected.
No additional test principal remains within the agreed USD 1 total limit.

## Interpretation and limits

This transaction verifies that the tested US buyer and US seller can complete buyer approval, authorization and capture through the selected sandbox path.
It does not verify holding funds until a real project milestone, release of delayed disbursement, recipient balance credit, Payouts, multiple payees, refunds or webhook handling.
The runner's generic capability field still reads `not_tested`; the dated operation states and `captured_immediate` payment evidence support the narrower transaction conclusion above.
The earlier Indian-seller checkout failed with `UNSUPPORTED_PAYEE_CURRENCY`; this US-to-US success does not identify the exact setting responsible for that failure.
No cleanup was attempted; capture is terminal for this authorization/capture path.

## Handoff

Review the saved runner report and provider references privately before making a broader product or settlement claim.
Do not run another principal test under this USD 1 campaign limit.
Continue with P4 evidence review and the separate plans for delayed disbursement, multiple payees and Payouts when their prerequisites and test budget are established.
Reviewer and review date: pending.
