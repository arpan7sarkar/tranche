# P2 sandbox runner operator runbook

Completion and limitations: [P2 closeout](p2-closeout.md).
Capability adapter plans: [P3 seller onboarding](p3-seller-onboarding-implementation-plan.md) and [P4 payment protection](p4-payment-protection-implementation-plan.md).

Date: 2026-10-12.
Scope: deterministic operator tooling with durable accounting; no real capability adapters are registered in the CLI yet.
Read the [implementation plan](p2-sandbox-runner-implementation-plan.md) and [P1 closeout](p1-closeout.md) first.

## Implemented behavior

The runner stores runs, immutable operation requests, approvals, dispatch attempts, browser waits, and a shared allocation in PostgreSQL.
All runs in the authorized database share allocation 1 with 100 USD cents and 50 API attempts; there is no reset or increase command.
Do not switch databases, delete records, or change counters to obtain another allowance.
The allocation counts reserved plus committed principal and sender-fee bounds, not just payments already completed.
Each new order or payout has its own commitment; authorization, capture and referenced release share the original principal while reserving any additional operation fee bounds.
Failed and ambiguous operations retain their money reservations conservatively; this version does not automatically reclaim unused money or replenish funds after cleanup.
OAuth and every read or write attempt consume the allocation before dispatch.
Claiming a business operation also holds calls for initial authentication, recovery authentication, and the configured recovery reads, preventing unrelated runs from consuming that allowance.
Terminal results release unused held calls, not consumed calls or money reservations.
An interruption after claiming may conservatively consume a request even if dispatch never happened.

Every write needs a concrete approval bound to the canonical request, participant aliases, amounts, fee bound and next dispatch attempt.
The exact method, path and JSON body are persisted and included in the approval hash.
The adapter must validate that the private merchant mappings, payload amounts and fee evidence match the approved summary before dispatch.
Private mappings cannot be silently changed behind an approved request.
Competing workers claim under a database lock; claim tokens fence stale workers, and expired claims enter read-only recovery.
This version never resends a business write after a timeout or crash.
Recovery uses only bounded GET requests and retains inconclusive results when an endpoint cannot establish the outcome.
Each HTTP request has a 15-second timeout, dispatch interpretation has a 45-second deadline, recovery has a 30-second deadline, and claims expire after 60 seconds.
Recovery reads also have a persisted per-operation count bound.

## Configuration and database setup

Use the pinned pnpm version and preserve the existing root .env.
Package commands load root .env explicitly; existing process environment values take precedence.
DATABASE_URL selects the authorized runner database and PAYPAL_ENV must be sandbox for execution.
PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET remain private and are used only by the transport, never copied into operation payloads or reports.
The transport uses the fixed sandbox API origin, manual redirects, no automatic retries and in-memory OAuth tokens.

Generated migrations are in packages/db/drizzle and must be reviewed before application.
The following migration command was verified against the isolated test database by explicitly setting DATABASE_URL in the command's process.
Apply it to the intended database only after checking that selection privately.

```powershell
pnpm --filter @tranche/db db:migrate
```

The migration command does not automatically load root .env.
For a new schema change, generate through pnpm --filter @tranche/db db:generate rather than editing generated SQL or metadata.

## Operator commands

Run these commands from the repository root.
Replace placeholders with the identifiers printed by start or inspect; do not paste private PayPal identifiers into command arguments.

```powershell
pnpm --filter @tranche/agents-service run f0:runner --help
pnpm --filter @tranche/agents-service run f0:runner start .sandbox-private/operation.json
pnpm --filter @tranche/agents-service run f0:runner inspect <run-id>
pnpm --filter @tranche/agents-service run f0:runner approve <operation-id> <payload-hash> <attempt>
pnpm --filter @tranche/agents-service run f0:runner resume <operation-id>
pnpm --filter @tranche/agents-service run f0:runner report <run-id>
```

Help and default invocation need neither database access nor PayPal requests.
Start validates a private operation specification, creates a run, reserves money and prints a sanitized approval summary; it sends no PayPal request.
Inspect restores pending approval summaries and opaque browser-artifact references from storage without contacting PayPal.
Approve records a trusted operator decision; for assistant-operated tests, run it only after presenting the concrete test and receiving explicit contributor approval in conversation.
Resume uses the registered adapter for the operation kind; the current CLI has an empty registry and stops before any OAuth or business request for an otherwise executable operation.
Report exports persisted sanitized state and always retains capability not_tested in this foundation.
The command paths were exercised through the exported CLI dispatcher with a disposable PostgreSQL database and fake transport; packaged help and default invocation were also checked.

## Private operation inputs and browser artifacts

The operation JSON must match SandboxOperationSpec in packages/contracts/src/sandbox-capabilities.ts.
It contains version, kind, USD currency, sender and recipient aliases with integer cents, feeBoundCents, commitmentId, resourceKey, recoveryCalls, and the exact request method, path and optional JSON body.
Use start only with a reviewed operation specification; do not guess a payment payload or assume a numeric fee bound proves applicable PayPal fees.
The supported kind vocabulary includes onboarding, order creation, order authorization, capture, release, payout and status reads; these names do not imply that real endpoint adapters exist.
Business-write adapters must validate endpoint semantics, account permissions, resource relationships, fee bounds, recovery contracts and provider duplicate keys before they can be registered.
Place private specifications and token-bearing browser artifacts under the ignored .sandbox-private directory.
The PrivateSandboxArtifacts helper validates sandbox browser destinations and writes links under random keys with restrictive POSIX modes where supported.
On Windows, use a directory restricted to the operator's Windows account; POSIX file modes do not establish Windows ACL protection.
Reveal a browser link only by explicitly opening its private artifact locally; it never belongs in ordinary logs or reports.
After browser actions, adapters must confirm approval or consent through authoritative counted API reads, not browser returns or operator statements alone.

## Verification

The database suite requires TEST_DATABASE_URL pointing only to localhost or 127.0.0.1, port 55432, database tranche_p2_test.
Its setup truncates sandbox tables in that disposable database before each case; it rejects other destinations and never falls back to DATABASE_URL.
Apply the generated migrations to that test database first and set TEST_DATABASE_URL privately in the test process.
Without TEST_DATABASE_URL, the database scenarios are explicitly skipped rather than evidence of a passing persistence check.

```powershell
pnpm --filter @tranche/contracts --filter @tranche/core --filter @tranche/paypal test
pnpm --filter @tranche/agents-service exec vitest run scripts/f0/preflight.test.ts scripts/f0/runner.test.ts
pnpm --filter @tranche/contracts --filter @tranche/core --filter @tranche/db --filter @tranche/paypal --filter @tranche/agents-service typecheck
```

Routine tests inject fake credentials and a fake HTTP transport; they do not contact PayPal.
The property suite checks 1,000 generated budget combinations in addition to boundary and approval cases.
See the [P2 implementation record](p2-implementation-record.md) for actual results and limitations.

## Next action

Implement and review the P3 seller-onboarding adapter against the official endpoint contract, privately confirm its app prerequisites and arrange the contributor's browser availability.
Onboarding readiness and later payment capability evidence remain separate from passing P2 tests.
The first payment experiment remains unprepared because applicable fee bounds and endpoint-specific readiness have not been established.
Before any money-moving test, explain purpose, sender, recipient, amount and fees, and wait for explicit approval.
Do not increase the $1 total or 50-attempt limit to make an experiment pass.

## Transport references

Reviewed on 2026-10-12: [PayPal authentication](https://developer.paypal.com/api/rest/authentication/) and [PayPal idempotency](https://developer.paypal.com/api/rest/reference/idempotency/).
The installed PayPal Server SDK 2.5.0 documentation was inspected; the runner uses direct fetch so counting, timeout, redirect and retry behavior are explicit.
Endpoint-specific idempotency support and retention still require review when each P3-P6 adapter is implemented.
