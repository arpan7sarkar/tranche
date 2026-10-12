# P1 sandbox access assessment

Current implementation handoff: [P2 closeout](../p2-closeout.md), [P3 seller-onboarding plan](../p3-seller-onboarding-implementation-plan.md) and [P4 payment-protection plan](../p4-payment-protection-implementation-plan.md).
P3 update, 2026-10-12: the [onboarding adapter](../p3-implementation-record.md) passed offline/database verification; actual partner access and seller grants remain untested, with execution steps in the [P3 runbook](../p3-runbook.md).
The [P3 closeout](../p3-closeout.md) records the contributor's decision to implement P4 offline before actual onboarding; browser availability and actual grants remain execution prerequisites afterward.
P4 update, 2026-10-12: [authorization/capture](../p4-implementation-record.md) is verified offline with 349 passing tests; actual payments remain untested and delayed release remains blocked on its endpoint contract.
Use the [P4 runbook](../p4-runbook.md) only after approved P3 consent, current seller checks, applicable fee/minimum review and separate payment-stage approvals.

## Current testing authorization: 2026-10-11

The contributor's latest instruction sets USD $1 as the maximum total testing spend across all tests and resumes, replacing the earlier $5 cap and the original image's $10-per-test and $500-total proposal.
Any individual test must fit within the remaining $1 allowance; known sender fees must also fit within that total.
Before every money-moving test, explain the purpose, sender, recipient, amount, and expected fees, then wait for explicit contributor approval.
If the amount is insufficient or a test fails, report the reason and proposed next step; do not increase the amount or send another payment without approval.
The contributor agreed that the 50-call cap counts all runner-issued PayPal requests, including OAuth, reads, writes, retries, polling, recovery, and cleanup.
P2 implements persistent runner accounting as of 2026-10-12; do not use the standalone preflight for uncounted calls during an active experiment.
No current preflight command enforces money budgets or executes payments.
Earlier requested amounts retained below are historical inputs and do not authorize spending.

Date: 2026-10-09.
Contributor: current implementation session with the project owner.
Historical implementation baseline: b35c022; the P1 implementation and subsequent redirect cleanup are now committed.
Scope: authentication tooling and sandbox account/access assessment only.
Status: P1 partially complete; tooling and real sandbox authentication verified; remaining setup is planned under the [2026-10-11 readiness plan](../sandbox-readiness-implementation-plan.md).
Last planning update: 2026-10-11; no new dashboard observations or payment experiments.
Closeout review: 2026-10-12; tooling revalidated, agreed accounting and payout-role mapping reconciled, future browser-operator availability still pending.
Latest evidence update: 2026-10-11; contributor confirmed REST credential association, successful login to all four assigned accounts, and USD 5,000 displayed in each; screenshot review and earlier OAuth evidence retained below.

## Evidence provenance

The project owner reports creating a Developer Dashboard account and a sandbox app of type Platform associated with a Sandbox Business Account.
The owner reports adding the app's sandbox credentials to the ignored root .env.
These are user-reported facts, not a dashboard inspection performed by the implementing contributor.
The .env ignore rule was verified without printing credential values.
No payment capability is inferred from app type or account setup.
The 2026-10-11 image supplies requested account roles, USD limits, and an operator role; it is not observed account or capability evidence.
Four later screenshots supplied under the ignored local sources/sandbox_account directory show details for one Business sandbox account and a REST app listed under it.
This is screenshot-derived evidence, not a direct authenticated dashboard inspection by the assistant.
The later priority 1 execution record assigns this account to platform; observed-business-1 is a historical alias for the same account, not an additional participant.

## Account inventory

| Role | Alias | Country / currency | Setup and provenance | Private custodian / operator |
|---|---|---|---|---|
| Platform app and business account | platform | IN / USD 5,000 displayed | Assigned app-linked Business account; REST credential association, login, and balance contributor-confirmed; local sandbox configuration checked; payment features unverified | Contributor with account owner; private mapping retained locally |
| Buyer | buyer | IN / USD 5,000 displayed | Assigned default Personal account; login and balance contributor-confirmed; actual USD payment support untested | Contributor with account owner |
| Seller A | seller-a | IN / USD 5,000 displayed | Assigned default Business account, distinct from platform; login and balance contributor-confirmed; seller consent and payment readiness unverified | Contributor with account owner |
| Seller B | seller-b | IN / USD 5,000 displayed | Assigned remaining distinct Business account; login and balance contributor-confirmed; seller consent and payment readiness unverified | Contributor with account owner |
| Intended Payouts sender | payout-sender = platform | IN / USD 5,000 displayed | Intended sender reuses platform; login and balance contributor-confirmed; usable payout funding and permissions unverified | Contributor with account owner |
| Existing Payouts recipient | payout-recipient = seller-b | IN / USD 5,000 displayed | Intended recipient reuses seller-b; login and balance contributor-confirmed; payout receipt untested | Contributor with account owner |
| Observed Business account; final role unconfirmed | observed-business-1 | IN / USD balance displayed | Supplied screenshots show Business, Verified, USD 5,000, and an associated REST app | Requesting contributor supplies screenshots; private login access unverified |

Do not publish credentials, account emails, merchant IDs, or secret-bearing lookup references.

## Dashboard observations

No direct authenticated dashboard inspection was performed by the assistant.
Observation date for the owner's app/account report: 2026-10-09.
Supplied screenshot review date: 2026-10-11.

| Area | Observation | Resolution owner and next action |
|---|---|---|
| Sandbox app type / business account | Owner reports Platform / Sandbox Business Account | Project owner to confirm mapping privately |
| Partner approval and attribution | Sandbox BN code and multiparty settings visible in screenshot 180518; partner approval and API permissions unproven | Contributor retains BN code privately; later onboarding probe verifies access |
| Seller features / readiness | unknown | Project owner to inspect both intended sellers |
| Delayed disbursement enablement | observed_enabled in screenshot 180526; seller-level grant unverified | Later seller onboarding and protection-path probes |
| Platform fees | observed_enabled in screenshot 180526; collection untested | Conditional later fee probe |
| Payouts sender / enablement / funding | Payouts observed_enabled in screenshot 180505; platform has contributor-reported USD 5,000; usable sender funding and recipient mapping unverified | Confirm intended sender and recipient before later payout probe |
| Vault / save payment methods | observed_enabled in screenshot 180505; token creation and unattended charging untested | Follow-up outside required F0 probes |

The observations above originated before screenshot review; the dated findings below add partial account evidence without establishing payment capability.

### Supplied screenshot findings: 2026-10-11

The four local files are Screenshot 2026-10-11 162545.png, 162558.png, 162616.png, and 162629.png, with the same Screenshot 2026-10-11 prefix for each timestamp.
The screenshots show Sandbox selected, a Business account with country IN and dashboard status Verified, and a displayed PayPal balance of USD 5,000.
A REST app is listed under the account; its displayed name alone does not prove partner approval, app type, or enabled payment products.
Payment Review and Negative Testing appear off; these testing settings do not establish delayed disbursement, Payouts, or Vault access.
The screenshots do not show a Personal buyer, a second distinct seller, completed sandbox-account login, seller consent, or app feature settings.
The supplied sequence is consistent with details for one account; it is not a complete sandbox account inventory.
Keep platform/seller sharing, payout-sender mapping, and USD payment feasibility unconfirmed until the corresponding roles and API outcomes are established.
A fifth supplied image, Screenshot 2026-10-11 163125.png, shows the credentials page for an app with the display-name prefix Platform Partner App and a banner explicitly identifying sandbox API credentials.
Its client ID is visible and its secret is masked; no values are transcribed here and no exact comparison with .env was performed during screenshot review.
The display name is editable and does not establish app type, partner approval, or payment-product enablement.
This image shows no Features section, buyer, second seller, or completed consent flow.
One screenshot contains visible legacy NVP/SOAP credentials; no credential values, account emails, merchant IDs, or screenshots are copied into committed evidence.
The source directory is ignored; keep these originals private and redact credentials before sharing copies outside the private workspace.

### Sandbox account list: 2026-10-11

Screenshot 2026-10-11 163449.png shows four sandbox accounts: three distinct Business accounts and one Personal account, all with country IN.
The first Business row matches the previously shown account and has one associated app and a Partner badge; use it as the platform candidate.
The second Business row has no associated app and a Partner badge; it is a candidate for seller-b, subject to owner confirmation and seller readiness.
The third Business row has one associated app and a Default badge; use it as the requested default seller-a candidate.
The Personal row has no associated app and a Default badge; use it as the requested buyer candidate.
The platform candidate and default seller-a are visibly distinct accounts, resolving the earlier uncertainty about whether those two requested roles must share an account.
A second distinct Business candidate already exists; no additional account creation is needed merely to obtain three Business accounts and one Personal account.
Partner badges are dashboard labels, not proof of API permissions, completed third-party onboarding, or payment-product enablement.
The list does not establish each candidate's USD suitability, ability to log in, seller consent, or Payouts readiness.
Record final role assignment and exact app-to-.env mapping privately before claiming operational readiness.

## Priority 1 account confirmation

### App feature screenshots: 2026-10-11

Reviewed Screenshot 2026-10-11 180505.png, 180518.png, and 180526.png from the ignored sources/sandbox_account directory.
The contributor supplied these while inspecting the platform app; the cropped images do not independently show its name or credential identity.
Screenshot 180505 shows Save payment methods using Vault, Subscriptions, Invoicing, Payment links and buttons, Payouts, Customer disputes, Transaction search, JavaScript SDK v6, and Mobile SDKs checked.
Log in with PayPal is unchecked, recorded as observed_disabled; this app feature is separate from the contributor's successful sandbox account logins.
Screenshot 180518 shows a sandbox BN code, Onboard before payment checked, Onboard after payment unchecked, and Business selected as the onboarding intent.
The before-payment option appears visually muted; the image establishes its displayed selection, not whether the control is editable.
The BN code value is retained only in the private screenshot and is not transcribed into documentation.
Screenshot 180526 shows Platform fee and Delay disbursement checked, recorded as observed_enabled.
Screenshot 180259 separately shows Payment Review and Negative Testing off; these are account testing controls rather than payment-product enablement evidence.
No feature settings were changed by the assistant.
These observations do not establish partner approval, completed seller onboarding, granted seller permissions, successful delayed release, fee collection, Vault operation, or payout receipt.
All business capabilities remain not_tested.
Next: confirm the intended platform payout sender and existing recipient, inspect any remaining seller-readiness evidence, and agree browser-operator availability and precise test-limit accounting.

### Priority 1 execution: 2026-10-11

The contributor instructed execution after the four-account mapping was presented.
Assigned platform to the first Business row, buyer to the default Personal row, seller-a to the default Business row, and seller-b to the remaining Business row in Screenshot 2026-10-11 163449.png.
Compared the account identities visually in that supplied image; all four are distinct and all have country IN.
Screenshot 162545 shows the platform app under the assigned platform account, and 163125 shows its sandbox credentials page.
These are screenshot-derived facts, not a new authenticated dashboard inspection.
Read-only local inspection confirmed PAYPAL_ENV=sandbox, a nonempty client ID and secret, and no process-level overrides for PAYPAL_ENV, PAYPAL_CLIENT_ID, or PAYPAL_CLIENT_SECRET in the inspected process.
Git ignore checks confirmed the root .env and sources/sandbox_account directory are excluded.
The contributor privately confirmed that the configured secret belongs to the intended app; its value was not shared.
Local Windows OCR did not establish an exact client-ID match, so the comparison remains inconclusive rather than a confirmed mismatch.
The contributor has been asked to confirm the client-ID match privately without sending its value.
Priority 1 remains partially complete until that match is confirmed.
No code or credentials were changed and no PayPal requests were made during these checks.
Login access, USD suitability, payment permissions, and every business capability remain unverified or not_tested.
See the [priority 1 plan](../p1-account-role-confirmation-plan.md) for the execution record and completion criteria.

## Authentication and validation

### Contributor confirmation and browser checks: 2026-10-11

After clarification that REST credentials differ from NVP/SOAP signatures, the contributor confirmed the correct platform REST client ID and secret are configured in .env.
Record that association as contributor-confirmed, not as an exact automated OCR match.
The contributor reported completing browser login checks for platform, buyer, seller-a, and seller-b, with USD 5,000 displayed in each account.
The assistant did not independently operate those browser sessions or execute payment calls.
Priority 1 role and configuration confirmation is complete on this evidence basis.
The login and displayed-balance checks are complete as user-reported findings; actual USD payment compatibility, seller consent, and payment-product permissions remain untested.
Next: inspect platform app features, intended payout sender and recipient readiness, browser-operator availability for future experiments, and the proposed accounting rules.

The platform app's sandbox authentication succeeded on 2026-10-09 at 15:51:44.003 UTC.
Command: pnpm --filter @tranche/agents-service run f0:preflight --authenticate.
Tool and shell exit status: 0.
Only the following allowlisted summary was emitted; no token or raw response was persisted.

```json
{"mode":"authenticate","outcome":"authenticated","timestamp":"2026-10-09T15:51:44.003Z","environment":"sandbox","httpStatus":200,"expiresInSeconds":32400}
```

Configuration validation also succeeded at 2026-10-09T15:51:15.652Z.
This establishes the credential pair works against the sandbox token endpoint, not payment feature enablement or the provenance of other accounts.

### Fresh authentication: 2026-10-11

At the contributor's explicit request, pnpm --filter @tranche/agents-service run f0:preflight --authenticate succeeded at 2026-10-11T10:52:20.384Z.
Observed result: authenticated, sandbox, HTTP 200, expiresInSeconds 32400, shell exit status 0.
The first sandboxed invocation stopped during pnpm registry verification; the authorized network-enabled retry reached PayPal and succeeded.
No token or raw response was printed or persisted, and no business payment operation was performed.
This fresh check does not establish which dashboard account owns the configured credentials or whether payment features are enabled.

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

As of 2026-10-11, the requested targets are USD, $10 per test, $500 total, and 50 API calls, with the platform Business sandbox balance as the intended Payouts experiment source.
The requesting contributor is the intended operator for buyer approval and both sellers' consent.
Login access and USD 5,000 displayed in each of the four assigned accounts are contributor-confirmed.
Actual transaction suitability, operator availability for scheduled experiments, usable payout funding, and precise accounting remain unverified.
Use the [readiness plan](../sandbox-readiness-implementation-plan.md#step-3-record-operators-and-finalize-the-execution-envelope) for the proposed campaign rules and future enforcement work.
No browser availability is assumed from possession of app credentials.

The owner deferred operator and limit selection on 2026-10-09; the 2026-10-11 image now provides planning targets.
The latest request plans and documents those tasks; it does not execute payment experiments or prove the limits are enforced.

| Pending item | Requested target | Contributor's required action |
|---|---|---|
| Buyer checkout operator | Requesting contributor | Access confirmed; arrange availability for the future experiment |
| Seller consent operators | Requesting contributor for both sellers | Access confirmed for both accounts; arrange availability for the future experiment |
| Test currency | USD | Confirm participant compatibility without assuming account country |
| Per-test amount | Must fit within remaining $1 total testing allowance | Sum units/items, allow for sender fees, and obtain explicit approval before each money-moving test |
| Campaign spending | At most $1 total under latest contributor instruction | Persist a 100-cent allowance across tests and resumes, including known sender fees; no automatic increase |
| API-call cap | 50 runner-issued PayPal attempts; accounting agreed | Enforce OAuth, reads, writes, retries, polling, recovery, and cleanup counting in P2 |
| Business writes | Separate audit count; no independent numeric cap supplied | Count every attempt and require outbox execution within the 50-call campaign cap |
| Payout funding source | Platform app's Business sandbox balance | Mapping and displayed balance recorded; verify usable funding and required permissions before a probe |
| Accounting agreement | Current $1 total and 50-request rules contributor-agreed | Implement conservative lifecycle reservations and explicit payment approvals in P2 |

Coordinate these choices with the project owner rather than assuming contributors inherit account access or spending authority.
Keep passwords and account mappings private; committed records should contain only operator roles or agreed non-sensitive names, aliases, availability arrangements, and approved limits.
P2 must validate and enforce the agreed amount and write-count limits before executing business operations.
Later payment probes must not proceed without agreed and enforced limits, verified required accounts, and available browser operators.
Offline tooling work can proceed independently when requested, but it does not resolve these assessment gaps.

## Capabilities and provider resources

Seller A Partner Referrals onboarding was verified on 2026-10-12 after an approved zero-dollar referral, operator browser consent, and a counted merchant-integration read.
The initial response was HTTP 201, but a referral ID validation defect prevented saving the consent artifact; the operator recovered the original link from API logs without repeating the POST.
The existing operation then succeeded with matching merchant identity, platform connection, required permissions, payments receivable, confirmed primary email, active product, and no missing scopes.
Shared runner accounting is four consumed API attempts, zero held calls, and zero reserved or committed cents.
Delayed capture/referenced release, multiple payees, Payouts, authorization/capture, platform fees, and vaulting remain not_tested.
One onboarding write has been attempted; no money-moving write has occurred and no payment resources require cleanup.

## Remaining P1 criteria and P2 starting action

P2 update, 2026-10-12: the [offline foundation](../p2-implementation-record.md) is implemented and verified; see the [P2 runbook](../p2-runbook.md) for current commands.
No real PayPal request was issued during P2 implementation, and existing account and capability gaps remain unchanged.

See the [2026-10-12 P1 closeout review](../p1-closeout.md) for the latest criterion-by-criterion assessment and validation results.
P1 tooling is complete; future browser-operator availability remains to be recorded before overall phase closure.
Existing account, feature, credential, login, and limit evidence should not be collected again merely because older historical entries remain below.

Tooling tests, TypeScript checking, configuration validation, and real sandbox authentication are complete.
Participant inventory, dashboard observations, operator access, and accounting agreement are recorded.
The contributor and account owner still need to record availability for future buyer approval and both sellers' consent before overall P1 closure.
The earlier P2 starting action, shared contracts and a durable outbox boundary, is now implemented; the next task is the P3 onboarding adapter with endpoint-specific prerequisites and tests.

## Historical deferred-work checklist: 2026-10-09

This checklist records the earlier handoff, not the current pending task list.
Use the closeout review above for completed items and current limits; do not repeat resolved checks or use the superseded amounts below.

On 2026-10-09, the owner requested no participant setup now and asked that unfinished work be documented for another developer.
This does not establish that participant accounts are absent; their existence and suitability are unknown.
Do not invent account facts or mark unresolved features unsupported.

1. Read AGENTS.md, design section 9, the P1 implementation plan, runbook, and this assessment.
2. Read the 2026-10-11 readiness plan, inspect the working tree, and preserve existing changes; P0/P1 implementation and redirect cleanup are committed.
3. Arrange private dashboard access with the owner and confirm the platform app/account mapping without printing credentials.
4. Inspect existing sandbox accounts and identify a Personal buyer, Business seller-a, and a distinct Business seller-b.
5. Record each participant's alias, country, currency, private custodian, and setup status in the inventory.
6. If a participant is missing, record the gap and obtain owner authorization before creating accounts or changing settings.
7. Identify the intended payout sender and existing recipient, explicitly recording any role-sharing and the proposed funding source.
8. Inspect partner approval, seller features, delayed disbursement, platform fees, attribution availability, and Payouts settings without changing them.
9. Record each dashboard observation with date and provenance, using unknown or not_visible when appropriate.
10. Identify the operators for buyer checkout and each seller's consent and document how a future contributor arranges their participation.
11. Record agreement on the requested USD, $10-per-test, $500-total, and 50-API-call envelope using the readiness plan's accounting rules; keep API attempts and business-write counts distinct.
12. Rerun offline tests and configuration checks if code or configuration changed; repeat real OAuth only if a fresh credential verification is necessary.
13. Review every P1 completion criterion, update this assessment and f0-status.md, and explicitly retain any unresolved work.

The implemented P1 CLI cannot create participant accounts, inspect dashboard features, or run payment experiments.
No additional code is required merely to fill the inventory; missing setup is coordinated through the dashboard owner.
Business probes begin only after P2 provides durable outbox execution and the owner requests the next phase.
