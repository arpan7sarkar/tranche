# Product payment creation and recovery

Funding, seller onboarding, replacement-order creation, and webhook registration persist an outbox intent before calling PayPal.
The stored inputs and request ID remain fixed across retries and process restarts.
The dispatch marker is recorded after OAuth and immediately before the provider request, using the current outbox claim fence.
A failure before that marker can retry the original intent.
Once dispatched, an unknown creation remains pending for a verified resource read; it cannot create a blind replacement or erase unresolved exposure.
A stored response is settled without repeating the provider write.
Cancellation prevents a queued hold from being placed when the worker reads the cancelled state.
If authorization was already in flight, webhook intake or reconciliation confirms the late funds before scheduling their cleanup, preserving the void operation for a real authorization.

## Recover a known order or referral

Inspect the private outbox row and provider records to identify the correct existing resource.
Use the original outbox ID, not a new funding attempt, and wait until its worker lease or retry delay has expired.
For a product order, the read must match the requested order ID, intent, milestone, request-ID custom field, currency, amount, and seller.
For a referral, the read must match tracking identity, return destination, required features, and a sandbox consent URL.
Missing or inconsistent fields leave the operation unresolved.

```bash
pnpm --filter @tranche/agents-service money:recover <outbox-id> <known-order-or-referral-id>
```

This command performs an authoritative GET and settles only that outbox row.
It does not execute queued place-hold or release work; normal money ticks handle those rows through their existing checks.
An operation with no discoverable resource ID remains pending and requires investigation; do not delete the intent, change its dispatch marker, or invent another request ID.
Webhook registration recovery instead lists hooks and accepts only the exact destination with all required subscriptions.

## Operator entry points

The manual funding command now operates on one existing, agreed, funding-state milestone and its deal.
It uses the same creation identity as portal and scheduled funding and never creates a second demonstration payment.
It returns the product checkout result; browser approval and subsequent payment execution retain their normal prerequisites.

```bash
pnpm --filter @tranche/paypal fund:manual <deal-id> <milestone-id>
pnpm --filter @tranche/paypal webhook:register https://your-app.example
```

Webhook registration preserves existing hooks and never deletes them before creating a replacement.
An existing exact URL with incompatible subscriptions produces an explicit mismatch for review.
These commands use the product database and are not covered by the F0 runner's experiment budget journal.
Obtain the concrete sandbox allowance required by the project before using them against PayPal.
The implementation tests use fake providers and a disposable database.

## F0 experiment order adoption

The experiment runner has a separate budgeted adoption command.
Its hash must match the original operation, and the candidate is read with the original seller context and counted against the existing recovery allowance.

```bash
pnpm --filter @tranche/agents-service f0:runner adopt-order <operation-id> <known-order-id> <original-payload-hash>
```

The read checks buyer identity when present, seller, currency, amount, AUTHORIZE intent, and the original commitment reference.
An unapproved matching order restores the private checkout artifact; a matching approved order allows the existing separately approved authorization stage to proceed.
A missing buyer on an approved order, an advanced payment, changed identity, live worker, expired recovery window, or exhausted allowance is rejected.
An order without any recorded dispatch cannot be adopted.
Consumed calls, original request ID, payload hash, and principal/fee reservations remain attached to the same operation.
