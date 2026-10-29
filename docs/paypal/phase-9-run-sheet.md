# Phase 9 sandbox run sheet

Status: prepared for review, not executed.
No public deployment URL or new provider allowance has been supplied.
Historical F0 allowances do not authorize this run.
This document proposes bounded stages; approval applies only after the operator fills the missing identities and confirms each stage.

## Required private record

Record the reviewed commit, public app origin, workflow slug, sandbox application identity, partner identity if applicable, distinct buyer and seller identities, country, and USD currency.
Store credentials, raw provider responses, portal URLs, merchant IDs, and request IDs only in an access-controlled private record, such as ignored `.sandbox-private/phase9/`.
Publish only redacted observations and outcome summaries.
Verify `PAYPAL_ENV=sandbox` and the sandbox API base on web and workflow before any operation.
Use an isolated fresh application database with no unrelated deals or pending payment jobs.
Do not run integration tests against the deployed application database.
Complete the bootstrap smoke test from [deployment instructions](../deployment.md) first.

## Proposed allowance

| Stage | Proposed bound | Approval status |
| --- | --- | --- |
| A: onboard and register webhook | One seller referral and one webhook registration; no principal | Not approved |
| B: product capture | One USD 1.00 milestone, one authorization, and one capture up to USD 1.00 | Not approved |
| C: authorization cleanup | One additional USD 1.00 milestone authorization, followed by one void and no capture | Not approved |
| All stages | At most USD 2.00 authorized principal, USD 1.00 captured principal, USD 0.02 platform fee at the current 200 basis points, and 60 application-initiated PayPal HTTP attempts including retries, OAuth and read-back | Not approved |

Provider fees are separate from the platform fee and must be observed, not assumed.
Refunds do not replenish this run's capture allowance.
Any retry that creates a new payment resource requires a new allowance.
The product route does not enforce this run sheet's global attempt limit; the operator must have a complete private request counter before approving it.
If that counter or a reliable stop mechanism is unavailable, do not execute the product run; prepare instrumentation first.
The F0 runner's budgets do not automatically cover web, webhook, or workflow traffic.
Stop before the cap is exhausted, reserving attempts for read-back and cleanup.
Provider webhook deliveries are recorded separately from application-initiated API attempts.

## Execution sequence after approval

1. Record the exact approved stages and limits, then confirm no unrelated pending jobs exist.
2. Use `/onboarding` and Connect PayPal for the selected sandbox seller, recording granted permissions and referral features.
3. Register one webhook for the actual HTTPS origin using the existing outbox-backed command below, then install its returned ID on web and workflow and redeploy.
4. Complete the ready infrastructure smoke test and verify a real signed provider delivery separately.
5. Create, send, and agree one USD 1.00 milestone through the product UI, then fund through its client portal using the selected sandbox buyer.
6. Verify the authorization ID, amount, seller, and durable request identity before continuing.
7. Submit delivery, verify it, and explicitly approve release as the client; observe one capture and the platform fee exactly once.
8. Record refund coverage as pending: the current product action schema has no general post-capture refund action, and this run sheet does not invent one.
9. If the cleanup stage was approved, use the guarded F0 authorization path for the separate USD 1.00 authorization and its separately approved `prepare-void` cleanup, confirming provider status by read-back.
10. Stop new processing, inventory every authorization and capture, reconcile all outbox records, and record any unresolved hold without guessing success.

The commands below perform provider writes or recovery and must only run for the approved stage with securely loaded environment values.

```bash
pnpm --filter @tranche/paypal webhook:register https://YOUR-APP.onrender.com
# Alternative to portal funding, not an additional order:
pnpm --filter @tranche/paypal fund:manual DEAL_ID MILESTONE_ID
# Only for a known creation operation and independently identified provider resource:
pnpm --filter @tranche/agents-service money:recover OUTBOX_ID KNOWN_RESOURCE_ID
```

Inspect the current F0 runner help and persisted operation specification before preparing any standalone cleanup operation.
F0 `prepare-void` requires an F0 authorization operation; it cannot consume a product hold ID.
Refund validation needs a separate reviewed execution path and allowance; the delayed-hold refund adapter does not establish post-capture product refund support in authorization mode.
Do not invent a new operation ID or retry a creation blindly after a timeout.
The broad `test:sandbox` suite is excluded from this allowance because it can create multiple independent payments.
Its separate allowance must enumerate the selected tests and cumulative exposure before enabling `RUN_PAYPAL_SANDBOX_TEST=1`.
Keep `TRANCHE_CRON_MODE=health` until background processing is explicitly included in the approved run.
Webhook and web-triggered tasks may still process payments in health mode, so cron mode is not a global payment stop switch.

## Observation ledger

| Assumption | Required evidence | Result |
| --- | --- | --- |
| Scope URLs | Granted permissions compared with `FEATURE_SCOPES`, including seller eligibility | Unverified |
| Assertion encoding | Seller-side authorization capture, void and refund accept the current assertion; renewal requires separate exposure approval | Unverified |
| Fee placement | USD 0.02 appears once on authorization capture; delayed-disbursement mode remains outside this run | Unverified |
| Referral features | Authorization-mode consent works without requesting delayed disbursement | Unverified |
| Already-done error names | Observed structured codes and read-back after completed void/refund; do not force duplicate writes outside the attempt allowance | Unverified |
| Cumulative refund field | Real webhook payload and provider read-back agree with the product refund total | Unverified |

For each observation record UTC time, reviewed commit, redacted request shape, HTTP status, private evidence reference, expected versus actual result, and cleanup outcome.
An absent error or unsupported provider feature remains unverified.
Any mismatch requires a reproducible regression test before changing the adapter and repeating an explicitly approved stage.
SBX-02 and SBX-03 remain pending until actual observations and product-route reconciliation are complete.
