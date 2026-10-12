# P3 implementation record

Date: 2026-10-12.
Status: Offline implementation and database verification complete; actual sandbox onboarding not tested.
Plan: [P3 implementation plan](p3-seller-onboarding-implementation-plan.md).
Commands and prerequisites: [P3 runbook](p3-runbook.md).
Completion review and agreed next phase: [P3 closeout](p3-closeout.md).
Execution scheduling: Implement and test P4 offline first, then perform separately approved P3 onboarding before any P4 payment test.

## Delivered behavior

| Files | Responsibility |
|---|---|
| packages/contracts/src/sandbox-onboarding.ts | Strict private inputs, narrow permission vocabulary, sanitized approval/evidence and provider-response schemas |
| packages/contracts/src/sandbox-capabilities.ts | Immutable onboarding context, partner context and optional sanitized onboarding outcomes/reports |
| packages/core/src/sandbox-policy.ts | Pure request-allowance calculation, including OAuth room for browser-separated status reads |
| packages/paypal/src/onboarding.ts | Exact referral construction, destination validation, known-ID status requests and matching grant/readiness checks |
| packages/paypal/src/client.ts | Validated attribution header, safe HTTP status metadata and redacted malformed-response handling |
| packages/db/src/sandbox-schema.ts | Durable onboarding resource, uniqueness keys, deadlines, observations and timestamps |
| packages/db/src/sandbox-store.ts | Atomic resource/evidence/state persistence, duplicate prevention and persistent recovery bounds |
| packages/db/drizzle/0002_furry_songbird.sql and generated metadata | Generated migration adding sandbox_onboarding after the foundation and P2 migrations |
| apps/agents/scripts/f0/adapters.ts | Real onboarding adapter using the existing outbox and private consent artifacts |
| apps/agents/scripts/f0/index.ts and runner.ts | Onboarding preparation, explicit consent-file/refresh commands, registration and safe failure evidence |
| Contract, transport and runner tests | Invalid mappings, approvals, grants, readiness, privacy, concurrency, persistent limits and recovery coverage |
| apps/agents/scripts/f0/onboarding.sandbox.test.ts | Disabled-by-default real test requiring explicit opt-in and an existing approved operation |

Milestone state, product agent tools and payment adapters were not changed.
Onboarding writes still require the existing operator approval and PayPal-Request-Id boundary.
The adapter saves no OAuth tokens, raw provider bodies or token-bearing links in ordinary reports.
Sensitive merchant mappings remain in the private operation record, and browser URLs remain in the ignored private artifact store.
Windows operators must restrict that directory with Windows permissions; POSIX modes alone do not establish Windows ACL protection.

## Verification

The initial schema test exposed a Zod runtime restriction on picking fields from a refined object; the approval schema now explicitly reuses its field schemas.
The final full regression run passed 295 tests after adding CLI/concurrency cases and rejecting conflicting or missing product-readiness status.
Final agents verification passed 96 tests, including the 54 existing preflight cases, 18 original P2 database cases and 19 new P3 database cases.
The only skipped test was the intentional real-sandbox opt-in test; no offline database case was skipped.
Contracts passed 76 tests, core 73, PayPal 39 and foundation database 11 in the final full regression run.
All eight workspace packages passed typechecking, and subsequent affected typechecks passed after the final additions.
Biome CI passed across 85 files with no fixes or warnings in the final recorded check.
Drizzle applied the new migration successfully to the isolated tranche-merge-tests PostgreSQL database at 127.0.0.1:55432/tranche_p2_test.
Tests used synthetic private mappings and fake HTTP transport; no real OAuth, referral or merchant-integration request was issued.
The configured application database, existing .env credentials and PayPal account settings were not changed.

## Implementation choices and remaining execution

Require known platform and seller merchant IDs instead of broadening the transport to accept tracking queries or provider-selected API destinations.
Support EXPRESS_CHECKOUT/PPCP with PAYMENT and optional REFUND; extra P4-specific features require a deliberate extension after selecting and reviewing that path.
Persist a maximum 24-hour onboarding deadline and an immutable recovery-read budget; repeated resume commands cannot renew either.
One initial referral, one initial OAuth and conservative recovery OAuth/read reservations must fit within the existing 50-call allocation.
Zero-dollar onboarding does not increase or replenish the shared $1 payment allowance.
A missing referral ID after an ambiguous write may prevent link recovery; authoritative matching integration evidence can still confirm consent, but no replacement referral is sent automatically.
Actual app partner approval, seller grants, product availability and transaction suitability remain unproven.
Before real execution, select and migrate the intended authorized database privately, inspect its allocation, confirm private mappings/products/scopes and arrange the contributor's browser availability.
Present the concrete non-payment referral and request allowance for approval, then collect seller consent and dated API evidence separately.
Offline P4 implementation can proceed now; actual P4 payment execution still requires a verified eligible seller and path-specific permissions, which these offline tests do not establish.
