# F0 contributor handoff

Last updated: 2026-10-09.
Plan: [f0-plan.md](f0-plan.md).
Experiment template: [f0-evidence-template.md](f0-evidence-template.md).

## Current position

P0, planning and handoff, is complete.
F0 as a whole is not complete.
P1 tooling and real sandbox authentication are verified.
P1 is partially complete; the owner explicitly deferred participant setup and remaining assessment work for a future contributor.
Participant inventory, dashboard observations, browser operators, and later experiment-envelope details remain unresolved.
The owner also explicitly deferred buyer-checkout and seller-consent operator assignment and all payment-test limit choices to future contributors.
No operator availability, currency, per-operation amount, total budget, or maximum write count is approved.
See the [implementation plan](p1-implementation-plan.md), [operator runbook](p1-runbook.md), and [access assessment](evidence/p1-access-assessment.md).
Authentication succeeded against the fixed sandbox token endpoint with HTTP 200 on 2026-10-09 at 15:51:44.003 UTC.
No business PayPal writes or sandbox transactions have occurred.
Credentials remain in the owner's ignored local .env; values and access tokens were not printed or recorded.

## Repository baseline

The repository began this phase with a clean Git working tree and 47 project files outside Git internals.
The web app contains a scaffold landing page.
Contracts define 14 milestone states.
The database package contains a client factory and an empty schema.
The PayPal package has an SDK dependency and an empty implementation.
The agents service registers only a ping workflow.
A P1 preflight CLI now exists under apps/agents/scripts/f0 with 54 passing isolated tests.
No migrations, outbox, or business payment probes exist yet.
Dependencies were installed during P1 using the unchanged frozen lockfile.

## Phase tracking

| Phase | Status | Owner | Evidence or remaining work |
|---|---|---|---|
| P0 | Complete | Current session | Plan, template, handoff, and README entry point |
| P1 | In progress (remaining work deferred by owner) | Future contributor with project owner | Tooling and OAuth passed; participant, dashboard, operator, and budget assessment remain |
| P2 | Not started | Unassigned | Implement durable probe tooling before business API writes |
| P3 | Not started | Unassigned | Prove third-party seller onboarding |
| P4 | Not started | Unassigned | Prove one single-seller protection path |
| P5 | Not started | Unassigned | Test multiple-payee capture |
| P6 | Not started | Unassigned | Test Payouts and assess source funding |
| P7 | Not started | Unassigned | Review evidence and write the payment-path decision |

## Capability tracking

| Capability | Status | Evidence |
|---|---|---|
| Partner Referrals onboarding | not_tested | None |
| Delayed capture and referenced release | not_tested | None |
| Multiple payees | not_tested | None |
| Payouts from intended sender | not_tested | None |
| Authorization and capture alternative | not_tested | None |
| Platform fees | not_tested | Conditional follow-up |
| Vaulting and unattended funding | not_tested | Outside the required F0 probes |

## P1 account inventory to complete

Use aliases here and retain credentials and sensitive account mappings privately.

| Role | Alias | Country and currency | Setup status | Private access owner |
|---|---|---|---|---|
| Platform REST app and business account | platform | Unknown | Owner reports sandbox Platform app and Business Account; sandbox OAuth proven | Project owner |
| Buyer | buyer | Unknown | Unknown | Project owner to identify |
| Seller A | seller-a | Unknown | Unknown | Project owner to identify |
| Seller B | seller-b | Unknown | Unknown; must differ from seller-a | Project owner to identify |
| Intended Payouts sender | payout-sender | Unknown | Unknown; account sharing unresolved | Project owner to identify |
| Existing Payouts recipient | payout-recipient | Unknown | Unknown | Project owner to identify |

Partner approval, seller features, attribution identifiers, Payouts access, and the experiment budget are all unknown.
The implementing contributor has no direct dashboard inspection evidence and cannot infer missing account or feature facts from successful OAuth.
The project owner explicitly requested that this work remain unimplemented for now and be documented for a future contributor.
The future contributor must coordinate with the project owner for private access and any account-creation or setting-change authorization.

## Next contributor: exact starting point

1. Read AGENTS.md, design section 9, and P1 in the plan.
2. Inspect git status --short and preserve all uncommitted P0 and P1 changes.
3. Read the P1 runbook and access assessment; do not repeat completed authentication merely to establish context.
4. Follow the deferred-work checklist in the access assessment with the project owner; identify existing participants before proposing new accounts.
5. Record dashboard feature observations with dates and identify buyer-approval and seller-consent operators.
6. Complete the deferred operator/limit table in the access assessment, obtain owner confirmation of payment-test limits, and arrange the required browser operators.
7. Close P1 only when its remaining criteria are met and update this handoff.
8. P2, when explicitly requested, starts with shared probe contracts and the durable outbox boundary.

Do not begin referral or payment business writes during P1.
Before those experiments, P2 must provide the outbox required by the repository instructions.

## Checks performed in P0

- Inspected git status --short and the project file inventory.
- Read root AGENTS.md, README, environment example, relevant package manifests, and the design spec.
- Added documentation and a root README entry point.

- Ran a read-only PowerShell validation across README.md and all three F0 documents.
- Local Markdown links, the no-em-dash rule, trailing whitespace, and balanced code fences all passed.
- Ran git diff --check successfully.
- Reviewed git diff --stat and git status --short, which showed the README change and new docs/paypal directory.
- Application tests were not run because this phase changes documentation only.

## Sandbox resources and unresolved operations

None created during P0.
P1 performed one successful OAuth exchange; the token was neither printed nor persisted.
No business resources were created and no operations require resume or cleanup.

## P1 session record: 2026-10-09

Contributor: current implementation session with the project owner.
Baseline revision: b35c022; changes remain uncommitted.
Completed: safe sandbox preflight, 54 isolated tests, agents-service script/typecheck coverage, operator runbook, assessment, and successful real sandbox OAuth.
Changed implementation files: apps/agents/scripts/f0/preflight.ts, apps/agents/scripts/f0/preflight.test.ts, apps/agents/package.json, and apps/agents/tsconfig.json.
Updated documentation: P1 runbook and assessment, P1 plan, F0 plan, and this handoff.
The root .gitignore now excludes .pnpm-store/, which the failed local dependency setup created.
The owner's .env was not edited.
Validation: 54 tests passed; package typecheck passed; default/help/configuration commands passed; OAuth returned HTTP 200.
Dependency setup required authorized network access for pnpm registry verification; version pins and lockfile were preserved.
Formatting required a second pass on the test file; the final read-only Biome check passed for all four code/configuration files.
The 54 isolated tests passed again after final formatting.
Markdown links, fences, trailing whitespace, and the no-em-dash rule passed across seven Markdown files.
git diff --check passed; Git reported only expected local line-ending warnings.
A local credential-presence scan passed across 12 changed or added project files without printing values.
The first credential-scan invocation failed due to PowerShell native-argument quoting; the corrected stdin invocation passed.
Remaining criteria: account inventory, dashboard feature assessment, browser operators, and later test-budget proposal.
Resolution owners: future contributor and project owner.
The owner explicitly deferred participant setup and remaining assessment work on 2026-10-09.
The owner separately confirmed that browser-operation arrangements and payment-test limits must also remain deferred and documented for future developers.
No further account creation, dashboard changes, or payment operations are authorized by this deferral.
Exact next action when resumed: follow the access assessment's deferred-work checklist, complete its outstanding tables using non-sensitive facts, then review P1 exit criteria.

## Session closeout format

Each future contributor should replace or append a dated session record containing the following fields.

```text
Date and contributor:
Phase and status:
Completed tasks:
Changed files:
Commands actually run and outcomes:
Evidence paths and experiment IDs:
Open provider resources and their state:
Blockers and who can resolve them:
Remaining exit criteria:
Exact next action:
```
