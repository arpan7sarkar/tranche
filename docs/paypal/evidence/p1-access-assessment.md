# P1 sandbox access assessment

Date: 2026-10-09.
Contributor: current implementation session with the project owner.
Baseline revision: b35c022; P1 work is uncommitted.
Scope: authentication tooling and sandbox account/access assessment only.
Status: P1 partially complete; tooling and real sandbox authentication verified, with remaining participant and assessment work explicitly deferred by the owner.

## Evidence provenance

The project owner reports creating a Developer Dashboard account and a sandbox app of type Platform associated with a Sandbox Business Account.
The owner reports adding the app's sandbox credentials to the ignored root .env.
These are user-reported facts, not a dashboard inspection performed by the implementing contributor.
The .env ignore rule was verified without printing credential values.
No payment capability is inferred from app type or account setup.

## Account inventory

| Role | Alias | Country / currency | Setup and provenance | Private custodian / operator |
|---|---|---|---|---|
| Platform app and business account | platform | Unknown / unknown | Sandbox Platform app and Business Account reported by owner | Project owner; private mapping retained locally |
| Buyer | buyer | Unknown / unknown | Unknown; not inspected | Project owner to identify |
| Seller A | seller-a | Unknown / unknown | Unknown; not inspected | Project owner to identify |
| Seller B | seller-b | Unknown / unknown | Unknown; must be distinct from seller-a | Project owner to identify |
| Intended Payouts sender | payout-sender | Unknown / unknown | Unknown; account sharing not established | Project owner to identify |
| Existing Payouts recipient | payout-recipient | Unknown / unknown | Unknown; not inspected | Project owner to identify |

Do not publish credentials, account emails, merchant IDs, or secret-bearing lookup references.

## Dashboard observations

No direct dashboard inspection was performed in this session.
Observation date for the owner's app/account report: 2026-10-09.

| Area | Observation | Resolution owner and next action |
|---|---|---|
| Sandbox app type / business account | Owner reports Platform / Sandbox Business Account | Project owner to confirm mapping privately |
| Partner approval and attribution | unknown | Project owner to inspect visible enablement and private attribution details |
| Seller features / readiness | unknown | Project owner to inspect both intended sellers |
| Delayed disbursement enablement | unknown | Project owner to record visible evidence or not_visible |
| Platform fees | unknown | Project owner to record visible evidence or not_visible |
| Payouts sender / enablement / funding | unknown | Project owner to identify sender and inspect configuration |

## Authentication and validation

The platform app's sandbox authentication succeeded on 2026-10-09 at 15:51:44.003 UTC.
Command: pnpm --filter @tranche/agents-service run f0:preflight --authenticate.
Tool and shell exit status: 0.
Only the following allowlisted summary was emitted; no token or raw response was persisted.

```json
{"mode":"authenticate","outcome":"authenticated","timestamp":"2026-10-09T15:51:44.003Z","environment":"sandbox","httpStatus":200,"expiresInSeconds":32400}
```

Configuration validation also succeeded at 2026-10-09T15:51:15.652Z.
This establishes the credential pair works against the sandbox token endpoint, not payment feature enablement or the provenance of other accounts.

### Commands actually executed

| Command or check | Outcome |
|---|---|
| node --version | v22.19.0 |
| pnpm install --frozen-lockfile | Passed with pnpm 12.10.1; lockfile unchanged |
| git check-ignore .env | Passed; credential file ignored |
| pnpm --filter @tranche/agents-service exec vitest run scripts/f0/preflight.test.ts | Passed: 54 tests in one file |
| pnpm --filter @tranche/agents-service typecheck | Passed |
| pnpm biome check --write on the four P1 TS/JSON files | Applied formatting; test file needed a second formatting pass |
| pnpm --filter @tranche/agents-service run f0:preflight | Passed; default help |
| pnpm --filter @tranche/agents-service run f0:preflight --help | Passed; help |
| pnpm --filter @tranche/agents-service run f0:preflight --check-config | Passed; valid sandbox configuration |
| pnpm --filter @tranche/agents-service run f0:preflight --authenticate | Passed; real sandbox HTTP 200 |
| Final read-only pnpm biome check on the four P1 TS/JSON files | Passed; no fixes applied |
| Post-format isolated test rerun | Passed: 54 tests |
| Markdown links, whitespace, fences, and no-em-dash checks | Passed across seven Markdown files |
| Local credential-presence scan | Passed across 12 changed or added project files; values not displayed |
| git diff --check | Passed; only local line-ending warnings |

Initial sandboxed pnpm invocations failed registry verification because dependency fetching was unavailable.
Authorized execution outside the sandbox succeeded without disabling signature checks or changing pinned versions.
A follow-up read-only Biome check found one remaining formatting difference, which was corrected before final validation.
The first credential scan failed because PowerShell removed native-argument quotes; the corrected stdin invocation passed.
Final read-only lint, documentation, and diff checks passed and are also recorded in the handoff.

## Later experiment envelope

Currency, per-operation amount, total budget, maximum writes, and intended payout funding source are unresolved.
The project owner must propose or confirm these before payment experiments.
The project owner must identify who can perform later buyer approval and seller consent and how contributors arrange access.
No browser availability is assumed from possession of app credentials.

The owner explicitly deferred browser-operator assignment and payment-test limit selection to future contributors on 2026-10-09.
No currency, amount, budget, write count, or operator has been approved by this conversation.

| Deferred item | Current value | Future contributor's required action |
|---|---|---|
| Buyer checkout operator | Unassigned | Arrange a human operator with private access to the intended buyer and confirm availability |
| Seller consent operators | Unassigned | Arrange an operator for each distinct seller and confirm private account access |
| Test currency | Unset | Propose a currency compatible with the inspected participant accounts and intended probes |
| Per-operation amount | Unset | Propose the smallest suitable sandbox amount and define how it applies to split purchase units and payout batches |
| Total run budget | Unset | Propose a total sandbox amount and specify which operations consume it, without double-counting the same payment lifecycle |
| Maximum business writes | Unset | Define an explicit cap and whether retries, polling, and cleanup count; align enforcement with the P2 runner |
| Payout funding source | Unresolved | Identify the intended sender and funding source without assuming agency proceeds reach the platform |
| Limit approval | Not requested or granted | Record the owner's confirmation, date, and agreed limits before executing payment experiments |

Coordinate these choices with the project owner rather than assuming contributors inherit account access or spending authority.
Keep passwords and account mappings private; committed records should contain only operator roles or agreed non-sensitive names, aliases, availability arrangements, and approved limits.
P2 must validate and enforce the agreed amount and write-count limits before executing business operations.
Later payment probes must not proceed with unset limits or unavailable required browser operators.
Offline tooling work can proceed independently when requested, but it does not resolve these assessment gaps.

## Capabilities and provider resources

Partner Referrals, delayed capture/referenced release, multiple payees, Payouts, authorization/capture, platform fees, and vaulting remain not_tested.
No business API writes have been executed and no payment resources require cleanup.

## Remaining P1 criteria and P2 starting action

Tooling tests, TypeScript checking, configuration validation, and real sandbox authentication are complete.
The project owner must complete the participant inventory, dashboard observations, browser-operator assignment, and later budget proposal.
Do not mark P1 complete while these required facts are unresolved.
P2's first independent implementation action is to inspect the preflight and define shared probe contracts and the durable outbox boundary before business operations.

## Deferred-work checklist for the next contributor

On 2026-10-09, the owner requested no participant setup now and asked that unfinished work be documented for another developer.
This does not establish that participant accounts are absent; their existence and suitability are unknown.
Do not invent account facts or mark unresolved features unsupported.

1. Read AGENTS.md, design section 9, the P1 implementation plan, runbook, and this assessment.
2. Inspect the working tree and preserve existing P0/P1 work; the current implementation has not been committed.
3. Arrange private dashboard access with the owner and confirm the platform app/account mapping without printing credentials.
4. Inspect existing sandbox accounts and identify a Personal buyer, Business seller-a, and a distinct Business seller-b.
5. Record each participant's alias, country, currency, private custodian, and setup status in the inventory.
6. If a participant is missing, record the gap and obtain owner authorization before creating accounts or changing settings.
7. Identify the intended payout sender and existing recipient, explicitly recording any role-sharing and the proposed funding source.
8. Inspect partner approval, seller features, delayed disbursement, platform fees, attribution availability, and Payouts settings without changing them.
9. Record each dashboard observation with date and provenance, using unknown or not_visible when appropriate.
10. Identify the operators for buyer checkout and each seller's consent and document how a future contributor arranges their participation.
11. Propose the sandbox currency, per-operation amount, total budget, and maximum business writes; obtain owner confirmation before later payment tests.
12. Rerun offline tests and configuration checks if code or configuration changed; repeat real OAuth only if a fresh credential verification is necessary.
13. Review every P1 completion criterion, update this assessment and f0-status.md, and explicitly retain any unresolved work.

The implemented P1 CLI cannot create participant accounts, inspect dashboard features, or run payment experiments.
No additional code is required merely to fill the inventory; missing setup is coordinated through the dashboard owner.
Business probes begin only after P2 provides durable outbox execution and the owner requests the next phase.
