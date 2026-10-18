# P7 payment-path decision

Date: 2026-10-17.
Scope: Phase 1 implementation choice for the sandbox product, based on the existing F0 evidence and remaining-work handoff.

## Selected path

Use `HOLD_MECHANISM=authorization` and `SUBCONTRACTOR_SPLIT=agency_pays`.
Create one AUTHORIZE order for the agency, place the authorization after verified buyer approval, and capture only through the existing policy-approved release outbox.
Place the platform fee on capture for this path.
The agency pays subcontractors outside Tranche; subcontractor entries remain planning data.
P5 multiple-payee experiments and P6 Payouts are deferred for the current product scope, not claimed unsupported by PayPal.
The service already rejects subcontractor split modes other than agency_pays.

## Evidence and limits

The [October 12 experiment](evidence/p4-us-authorization-capture-2026-10-12.md) records one USD 1 authorization and capture between the tested US buyer and US seller.
Its final accounting was 40 of 50 API attempts and 100 committed cents, with no remaining principal allowance.
The same record describes verified seller consent and grants for that configuration.
The earlier Indian-seller failure does not establish general country or currency support.
Delayed disbursement release remains unverified and its experimental adapter remains blocked.
No P5 multiple-payee or P6 Payouts experiment was run for this decision.
This selects the implementation path requested by the handoff; it does not close all original F0 capability experiments or prove the full product route in PayPal.

## Product consequences

H2 uses agency authorization and capture, with every product write dispatched through the outbox and every webhook verified before inbox insertion.
Funding orders and seller referrals are journaled before dispatch, with frozen request fields and responses saved before local settlement.
A definitely undispatched failure may retry the same intent.
A creation whose dispatch marker was committed requires authoritative recovery of the known resource instead of an automatic replacement POST.
H4 keeps deterministic renewal and funding timers, preserves the original authorization anchor, and records replacement-order creation separately before placing the replacement hold.
The existing renewal and cancellation coordination remains responsible for retiring old holds only after the replacement is confirmed.
Phase 2 agents must insert proposals and use read-only tools; this decision adds no agent payment authority.

## Endpoint contract checked during implementation

[Orders create](https://developer.paypal.com/api/orders/v2/orders-create) documents the request-ID header for idempotency and disallows multiple purchase units for AUTHORIZE.
The retrieved create-order reference does not specify a retention duration, so this implementation does not assume an unlimited or configured replay window.
[Order details](https://developer.paypal.com/sdk/orders/v2/orders-get/) supports reading a known order ID for recovery.
[Partner Referrals](https://developer.paypal.com/api/partner-referrals/v2) provides a known-referral read; the retrieved create reference did not establish replay retention.
[Webhook management](https://developer.paypal.com/api/webhooks/v1) provides listing by app, used to recover a registration by its exact URL and required subscriptions.
These documentation checks describe endpoint contracts, not observed access for this app.

## Outstanding sandbox proof and resources

The historical capture is terminal and was not refunded or otherwise cleaned up during this implementation.
Existing seller referrals, consent, and private provider identifiers remain in their original database and ignored artifacts.
No new PayPal resources or real payment calls were created for Phase 1 implementation.
Vault persistence, unattended future funding, renewal, void/refund behavior, fee placement, webhook fields, and end-to-end product onboarding through release still require the bounded Phase 9 validation.
The original capability campaign remains incomplete where observations are missing.
A new real-money sandbox run requires a new explicit allowance because the historical principal allowance is exhausted.
