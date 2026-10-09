# P1 implementation plan: sandbox accounts and access

Status: Tooling and sandbox authentication verified; the owner deferred remaining participant and assessment work documented in the [access assessment](evidence/p1-access-assessment.md).
Use the [runbook](p1-runbook.md) for reproducible operator steps.
Parent plan: [F0 phases](f0-plan.md).
Current state: [Contributor handoff](f0-status.md).
Evidence format: [Experiment template](f0-evidence-template.md).

## Outcome

A contributor can identify the sandbox participants, verify platform-app authentication, understand observed permissions, and continue into P2 without relying on this conversation.
Deliver a small authentication preflight tool, a reproducible operator runbook, and a sanitized access assessment.
Keep dashboard access findings separate from payment capabilities, which remain not_tested throughout P1.

## Scope

P1 includes repository preparation, local credential configuration, account inventory, dashboard inspection, one sandbox OAuth check, tests, and handoff updates.
The only PayPal API operation permitted by the P1 tool is OAuth client-credentials token exchange.
It is an authentication operation and does not create a seller referral or payment resource.
Business API writes require P2's outbox before they can run.
Do not implement payment adapters, database tables, an outbox, agents, web routes, or UI in P1.
Use existing accounts and dashboard settings for the assessment.
Record missing accounts or enablement as follow-up work rather than silently creating accounts, changing app permissions, or requesting partner access.

## Roles and prerequisites

| Role | Responsibility |
|---|---|
| Implementing contributor | Build and test preflight tooling, maintain documents, record results |
| Project or account owner | Provide private sandbox access and identify the intended platform app |
| Dashboard operator | Inspect account settings and confirm who can perform later seller consent and buyer approval |

One person may fill all roles.
No credential is needed to implement the tool or run its isolated tests.
Private dashboard access and sandbox credentials are required to finish the real assessment.
Record who can supply any missing access and continue independent implementation work while it is unavailable.
Never ask someone to paste passwords, client secrets, private keys, or access tokens into a public issue, committed document, or chat transcript.

## Planned file changes

| File | Change and purpose |
|---|---|
| apps/agents/scripts/f0/preflight.ts | New CLI and testable authentication check, with no agent registration |
| apps/agents/scripts/f0/preflight.test.ts | New isolated tests with fake credentials and injected transport |
| apps/agents/package.json | Add a package-local f0:preflight script |
| apps/agents/tsconfig.json | Include scripts so the new TypeScript is checked |
| docs/paypal/p1-runbook.md | New operator instructions and recovery steps |
| docs/paypal/evidence/p1-access-assessment.md | New sanitized record of actual dashboard and authentication findings |
| docs/paypal/f0-status.md | Update ownership, P1 progress, results, blockers, and next action |
| docs/paypal/f0-plan.md | Update any statements about preflight availability after the tool exists |

Use existing PAYPAL_ENV, PAYPAL_CLIENT_ID, and PAYPAL_CLIENT_SECRET names from .env.example.
No new dependency, root script, workspace, or Turborepo task is expected.
If inspection establishes a necessary dependency change, explain it and let pnpm regenerate the lockfile.
Preflight-specific types remain local because no other package consumes them.
P2 can extract reusable authentication into packages/paypal when implementing the full transport, replacing the preflight's internal adapter without changing its operator contract.

## Step 1: Establish the implementation baseline

1. Read AGENTS.md, design section 9, the parent F0 plan, and the current handoff.
2. Inspect git status --short and preserve existing changes.
3. Record the contributor and P1 start date in the handoff only when implementation begins.
4. Check Node and pnpm against package.json and the installed tooling requirements.
5. Install dependencies using pnpm if needed and inspect any generated diff.
6. Read the existing agents-service TypeScript configuration and package scripts before editing them.

The existing P0 documents and README changes may still be uncommitted.
Do not discard them or treat them as files created by the next contributor.
No database, Render service, Next.js server, or payment endpoint is needed for P1.

## Step 2: Implement a narrowly scoped preflight CLI

### Interface

Provide --help, --check-config, and --authenticate modes.
Default invocation displays help and makes no network request.
Reject unknown flags and never accept credentials or endpoint overrides as CLI arguments.
Make importing the file for tests side-effect free.

The proposed package script is:

```json
"f0:preflight": "node --env-file-if-exists=../../.env --import=tsx scripts/f0/preflight.ts"
```

P1 implementation adds this script; its verified execution results are recorded in the access assessment.
Verify the invocation with the selected Node and installed tsx versions before documenting it as working.
The package runs from apps/agents, so ../../.env resolves to the repository-root environment file.
An absent .env must not prevent help from working; configuration and authentication modes still require the relevant values in the process environment or file.
Document that existing process environment values take precedence over values loaded from the file and can cause an unexpected credential selection.
Do not print either set of values while diagnosing configuration.

### Configuration mode

- Require PAYPAL_ENV to equal sandbox explicitly, including for authentication.
- Require nonempty PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.
- Reject missing, blank, or newline-containing credentials before network access.
- Keep the endpoint fixed to https://api-m.sandbox.paypal.com/v1/oauth2/token.
- Report configuration validity and missing variable names without exposing values.
- Make --check-config perform zero network calls.

### Authentication mode

- Use HTTP Basic authentication with the configured sandbox client ID and secret.
- Send a form-encoded grant_type=client_credentials body.
- Use a 15-second timeout and reject redirects.
- Make one request per invocation with no automatic retries.
- Validate a successful response has a nonempty access_token, Bearer token_type, and a positive expires_in value.
- Keep the token in memory only and discard it after checking the response.
- Omit OAuth scopes from CLI output; any separately reviewed scopes are metadata only, never proof of an enabled payment capability.
- Exclude raw response objects, authorization headers, tokens, nonce values, and credential values from output.
- Construct output from an allowlist of fields rather than redacting and printing the raw provider response.
- Never print raw exception messages or arbitrary provider error_description text.

The only network target is the fixed token endpoint.
Rejecting live configuration prevents accidental live calls, but successful sandbox authentication does not establish the provenance of every manually inventoried account.
The dashboard operator must separately verify those account mappings.

### Safe output and exit codes

| Exit code | Meaning | Operator action |
|---|---|---|
| 0 | Help, valid configuration, or successful authentication in the requested mode | Record which mode was executed |
| 1 | Invalid flags or local configuration | Correct configuration and rerun |
| 2 | Authentication rejected | Confirm the sandbox app and credential pair privately |
| 3 | Timeout, connection failure, rate limit, or provider failure | Record an inconclusive check and retry manually when appropriate |
| 4 | Unexpected response shape, unrecognized error response, redirect, or caught local runtime failure | Investigate without dumping provider payloads or secrets |

Classify known OAuth authentication errors using documented codes and HTTP status.
Do not classify every 4xx response as bad credentials or unsupported payments.
Output uses locally defined modes and outcomes, variable names for configuration errors, and applicable environment, UTC timestamp, HTTP status, and token-lifetime fields.
OAuth scopes, provider error text and codes, debug identifiers, app identifiers, credentials, and tokens are omitted from CLI output.
Known provider error codes are used only internally to classify authentication rejection.
Do not generate a raw token-response artifact.

## Step 3: Test the preflight before using credentials

Use a fake transport and recognizable fake secrets for isolated tests.
Test externally visible behavior and security boundaries rather than duplicating implementation details.

| Case | Required assertion |
|---|---|
| Help and default invocation | No network request |
| Missing or non-sandbox environment | Rejected before network access |
| Missing or invalid credentials | Only safe variable names reported |
| Configuration-only mode | No network request |
| Valid authentication | Fixed endpoint, expected method and form body, safe success summary |
| Invalid credentials | Safe rejected result with exit code 2 |
| Timeout, network failure, 429, or 5xx | One attempt and inconclusive result |
| Redirect | No following request and no credential forwarding |
| Malformed JSON or invalid token fields | No false success |
| Unknown flags | No network request |
| Provider response or exception containing a fake secret | Secret absent from both stdout and stderr |
| Module import during tests | No CLI execution or network access |

Do not execute real OAuth authentication in normal CI.
Live credentials are never a test fixture.

## Step 4: Prepare the operator runbook

Document the actual tested Node version, package command, environment-file location, modes, safe output, and exit codes.
Have the operator configure the root .env privately using the existing example, preserving any existing local file.
Confirm the local credential file is ignored before adding values.
Avoid verbose HTTP tools or commands containing literal credentials, which can expose secrets through logs and shell history.

Document the sandbox Dashboard path to Apps & Credentials and Testing Tools > Sandbox Accounts, with a reminder that labels can change.
Record access observations without changing settings.
Explain how an operator can populate the inventory and record a blocked assessment if dashboard access is unavailable.

## Step 5: Inventory the participants

Complete this table in the access assessment using aliases.

| Role | Proposed alias | Facts to confirm |
|---|---|---|
| Platform app and business account | platform | Sandbox app ownership, associated business account, credential custodian |
| Buyer | buyer | Personal sandbox account, country, currency, login operator |
| Seller A | seller-a | Business sandbox account, country, currency, consent operator |
| Seller B | seller-b | Distinct business sandbox account, country, currency, consent operator |
| Payouts sender | payout-sender | Intended owner, credentials required, sandbox funding source |
| Payouts recipient | payout-recipient | Existing sandbox recipient and operator |

Roles may share an account when appropriate, but record that explicitly.
The two sellers must be distinct for the later multiple-payee experiment.
Keep account emails, merchant IDs, credentials, and alias-to-account mappings in the team's private store.
Record the private custodian and lookup reference without publishing a secret-bearing link.
Mark every fact confirmed, missing, or unknown and attach an observation date.
Do not replace unresolved facts with assumed US or USD defaults.

## Step 6: Inspect access and record observations

| Area | Observation to record | What remains unproven |
|---|---|---|
| Platform app | Sandbox selection, associated account, credential access | Payment API capability |
| Partner access | Approval or enablement evidence visible to the operator | Successful referral and seller onboarding |
| Seller readiness | Account setup and currently visible feature status | Granted third-party permission and transaction success |
| Delayed disbursement | Relevant app or seller enablement evidence, if visible | Delayed capture and referenced release |
| Platform fees | Relevant feature evidence, if visible | Actual fee collection |
| Payouts | Intended sender configuration and available evidence | Successful payout receipt |
| Attribution | Whether the required partner attribution details are available privately | Correctness in a completed payment flow |

Use labels observed_enabled, observed_disabled, not_visible, and unknown for dashboard observations.
Do not translate not_visible into unsupported.
Attach a sanitized written observation and timestamp; screenshots are optional and must exclude secrets and account details.
No referral, seller consent, checkout, authorization, capture, disbursement, payout, or vault operation occurs here.

## Step 7: Run and record authentication

First run the isolated tests and configuration check.
Only then have the operator run --authenticate with the intended platform app's sandbox credentials.
If a future Payouts sender requires a different app, record that requirement separately rather than silently substituting its credentials for the platform check.

Record the sanitized result, UTC timestamp, app alias, command, and code revision in the assessment.
An authentication success proves the credential pair works against the sandbox token endpoint.
It does not prove Partner Referrals, delayed disbursement, multiple payees, Payouts, or vaulting.

If credentials are unavailable, record authentication as not run and P1 as blocked.
If the request fails ambiguously, preserve an inconclusive result and the next diagnostic action.
No automated support requests or messages to external parties are part of P1.

## Step 8: Agree the later experiment envelope

Record a proposed currency, per-operation amount, total run budget, and maximum number of writes for P3-P6.
Record who can complete buyer approval and seller consent and how the next contributor arranges access.
Identify the intended payout funding source or mark it unresolved.
The project owner should supply or confirm the test budget before payment experiments begin.
P1 does not execute or enforce payment budgets; P2 will implement their enforcement.

## Step 9: Validate and close the phase

Run the following commands after the proposed files and script exist.
All commands are invoked from the repository root.

```powershell
pnpm --filter @tranche/agents-service exec vitest run scripts/f0/preflight.test.ts
pnpm --filter @tranche/agents-service typecheck
pnpm biome check apps/agents/scripts/f0/preflight.ts apps/agents/scripts/f0/preflight.test.ts apps/agents/package.json apps/agents/tsconfig.json
pnpm --filter @tranche/agents-service run f0:preflight --check-config
pnpm --filter @tranche/agents-service run f0:preflight --authenticate
git diff --check
git status --short
```

Authentication commands require private local configuration and are not substitutes for isolated tests.
Check --help and the default command as well to verify they make no network call.
Inspect the final diff for credentials and unintended changes without printing local .env contents.
Check local Markdown links, code fences, and the no-em-dash rule.
Record commands actually run and failures honestly in the handoff.
Do not claim a passed real authentication check from a mocked test.

## Completion criteria

- The preflight tool and isolated tests pass, and its scripts are covered by TypeScript checking.
- The runbook reproduces the tested local invocation and environment loading.
- The account inventory is completed with confirmed facts or explicit gaps and their owners.
- Dashboard observations are timestamped and clearly separated from API-proven capabilities.
- A real platform-app sandbox authentication success is recorded.
- Required participants exist and later browser actions have an identified operator.
- The later test-budget proposal and any outstanding confirmation are recorded.
- The handoff links the assessment, records checks and limitations, and names P2 as the next implementation phase.
- All payment capabilities remain not_tested and no business API writes have occurred.

If missing prerequisites prevent requested account assessment, dashboard inspection, or real authentication, keep P1 blocked and identify the remaining criteria and resolution owners.
If the owner explicitly defers unfinished work, keep P1 in progress with that deferral recorded, rather than treating the decision as an access failure.
Document the deferred tasks and exact resumption steps; do not mark P1 complete while required criteria remain unresolved.
Tooling can be marked complete independently in the session record while the overall phase remains incomplete.
An observed lack of partner enablement can be a completed access-assessment finding with a named follow-up owner; it does not imply a completed onboarding capability test.
P2's independent tooling work can proceed from known account requirements while partner enablement is unresolved.

## Handoff artifact

The P1 access assessment must contain the following sections.

```text
Contributor, dates, code revision, and scope
Account inventory and private access custodians
Dashboard observations and observation dates
Authentication command, sanitized outcome, and timestamp
Tests and commands actually executed
Proposed experiment budget and browser operators
Missing permissions or accounts, resolution owners, and next actions
Capabilities still untested
P1 completion, deferred work, or blocked criteria
Exact P2 starting action
```

The P2 starting action is to inspect the tested preflight, then define shared probe contracts and the durable execution boundary before adding business operations.
Update the parent plan's statement about environment loading to explain that P1 establishes it for preflight and P2 extends it to the probe runner.
Do not mark P1 complete merely because this implementation plan exists.

## Official references

Consulted on 2026-10-09; recheck relevant documentation when implementation starts.

- [PayPal REST setup and OAuth](https://developer.paypal.com/api/get-started/): app credentials, token endpoint, and sandbox account navigation.
- [Sandbox testing overview](https://developer.paypal.com/sandbox-testing/overview/): sandbox participants and environment boundaries.
- [Delayed-disbursement prerequisites](https://developer.paypal.com/platforms/checkout/delayed-disbursement/): approved-partner and seller-feature requirements.
