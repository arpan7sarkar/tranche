# P1 operator runbook

Scope: local configuration, one sandbox OAuth check, account inventory, and access assessment.
No seller referrals, payments, payouts, vaulting, or account-setting changes belong to P1.
See the [implementation plan](p1-implementation-plan.md), [assessment](evidence/p1-access-assessment.md), and [handoff](f0-status.md).

## Local setup

Use the Node requirement and pinned pnpm version in the root package.json.
Implementation validation uses Node 22.19.0 and pnpm 12.10.1.
Run commands from the repository root.

```powershell
pnpm install --frozen-lockfile
git check-ignore .env
```

The second command must print .env before credentials are added.
Create or update your repository-root .env privately, preserving existing entries.
Use the intended platform app's sandbox values, not a live app or sandbox login password.
Quotes around values are optional.

```dotenv
PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=your_sandbox_client_id
PAYPAL_CLIENT_SECRET=your_sandbox_client_secret
```

Do not commit, paste, screenshot, or print the completed file.
The package script loads ../../.env relative to apps/agents using Node's environment-file loader.
Existing process environment values override file values; resolve stale process configuration privately without printing either set of credentials.
A missing .env does not prevent help from working, though Node may print a missing-file notice.

## Offline validation

```powershell
pnpm --filter @tranche/agents-service exec vitest run scripts/f0/preflight.test.ts
pnpm --filter @tranche/agents-service typecheck
pnpm biome check apps/agents/scripts/f0/preflight.ts apps/agents/scripts/f0/preflight.test.ts apps/agents/package.json apps/agents/tsconfig.json
pnpm --filter @tranche/agents-service run f0:preflight
pnpm --filter @tranche/agents-service run f0:preflight --help
pnpm --filter @tranche/agents-service run f0:preflight --check-config
```

Default invocation and --help show usage without network activity.
Configuration mode checks variable names and validity, not whether credentials work.
Tests inject fake transport and fake credentials; they do not contact PayPal.
The preflight module can be imported without invoking the CLI.

## Authentication

After the offline checks pass, run the following once.

```powershell
pnpm --filter @tranche/agents-service run f0:preflight --authenticate
```

The tool sends one POST to https://api-m.sandbox.paypal.com/v1/oauth2/token with client-credentials authentication, rejects redirects, and uses a 15-second request deadline.
There are no automatic retries or configurable endpoint overrides.
The token is checked in memory only and never printed or persisted.
Output is a safe JSON summary, not the raw provider response.
Scopes, provider text, debug identifiers, app identifiers, and tokens are deliberately omitted.
Success proves sandbox authentication only, not any payment permission.

| Tool exit code | Meaning | Next action |
|---|---|---|
| 0 | Success for the selected mode | Record mode, sanitized result, timestamp, and app alias |
| 1 | Invalid flags or local configuration | Correct configuration privately |
| 2 | Known authentication rejection | Verify the intended sandbox app and credential pair privately |
| 3 | Network, timeout, rate limit, or provider failure | Record inconclusive; retry manually only after investigation |
| 4 | Unexpected response, redirect, or local runtime failure | Investigate without dumping provider payloads or secrets |

The pnpm wrapper can report its own failure status in addition to the tool's status.
Record the JSON outcome as well as the shell result.
Do not infer invalid credentials from an inconclusive network failure.

## Dashboard and participant assessment

Have the account owner inspect Apps & Credentials with Sandbox selected and Testing Tools > Sandbox Accounts.
Navigation labels may change; the [official REST setup guide](https://developer.paypal.com/api/get-started/) describes the current flow.
Do not change app permissions, create additional accounts, or request partner approval as part of this assessment.

Record aliases for the platform, buyer, two distinct sellers, intended payout sender, and recipient in the [assessment](evidence/p1-access-assessment.md).
Confirm each account's country, currency, role, private custodian, and browser operator without publishing emails, passwords, merchant IDs, or account mappings.
Record whether the payout sender shares the platform account rather than assuming it does.
Keep user-reported facts distinct from operator dashboard observations and API-proven facts.
Use observed_enabled, observed_disabled, not_visible, or unknown for feature observations.
App type Platform alone does not establish partner approval, seller readiness, delayed disbursement, multiple-payee support, or Payouts access.

Record the proposed later test currency, per-operation amount, total budget, maximum writes, and who can approve buyer checkout and seller consent.
Unknown entries must retain a named resolution owner and next action.
All payment capabilities remain not_tested during P1.

## Closeout and continuation

Update the assessment and handoff with commands actually run and their outcomes.
Do not mark P1 complete until its account, operator, assessment, tooling, and real authentication criteria are met.
If something is unavailable, preserve partial progress and identify the missing criterion.
If the owner explicitly defers remaining work, keep P1 in progress and record the deferred tasks, resolution owners, and resumption steps in the handoff.
Use blocked for missing prerequisites that prevent requested work, not merely for work the owner has chosen to defer.
P2 begins with shared probe contracts and durable outbox execution, not with an unprotected payment script.
