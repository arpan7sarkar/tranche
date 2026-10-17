# F0 contributor handoff

## Current testing authorization: 2026-10-11

The contributor's latest instruction sets USD $1 as the maximum total testing spend across all tests and resumes, replacing the earlier $5 cap and the original image's $10-per-test and $500-total proposal.
Any individual test must fit within the remaining $1 allowance; known sender fees must also fit within that total.
Before every money-moving test, explain the purpose, sender, recipient, amount, and expected fees, then wait for explicit contributor approval.
If the amount is insufficient or a test fails, report the reason and proposed next step; do not increase the amount or send another payment without approval.
The contributor agreed that the 50-call cap counts all runner-issued PayPal requests, including OAuth, reads, writes, retries, polling, recovery, and cleanup.
P2 implements persistent runner accounting as of 2026-10-12; do not use the standalone preflight for uncounted calls during an active experiment.
No current preflight command enforces money budgets or executes payments.
Earlier requested amounts retained below are historical inputs and do not authorize spending.

Last updated: 2026-10-12.
Plan: [f0-plan.md](f0-plan.md).
Experiment template: [f0-evidence-template.md](f0-evidence-template.md).
Pending setup and implementation: [sandbox readiness plan](sandbox-readiness-implementation-plan.md).
Ordered runtime implementation: [P2 runner plan](p2-sandbox-runner-implementation-plan.md).
P1 verification and remaining closeout item: [P1 closeout review](p1-closeout.md).
Implemented runner commands and evidence: [P2 runbook](p2-runbook.md), [P2 implementation record](p2-implementation-record.md).
Foundation completion: [P2 closeout](p2-closeout.md).
Implementation plans: [P3 seller onboarding](p3-seller-onboarding-implementation-plan.md) and [P4 payment protection](p4-payment-protection-implementation-plan.md).
P3 implementation and execution handoff: [P3 record](p3-implementation-record.md) and [runbook](p3-runbook.md).
P3 onboarding recovery review fixes: [recovery fix](p3-onboarding-recovery-fix.md).
P3 implementation closure and agreed next phase: [P3 closeout](p3-closeout.md).
P4 authorization/capture commands and verification: [P4 runbook](p4-runbook.md) and [implementation record](p4-implementation-record.md).
Actual US-to-US transaction evidence: [P4 authorization and capture](evidence/p4-us-authorization-capture-2026-10-12.md).

## Current position

P0, planning and handoff, is complete.
F0 as a whole is not complete.
P1 tooling and real sandbox authentication are verified.
P2's offline runner foundation is implemented and verified with 109 passing tests, including 18 disposable PostgreSQL scenarios; real capability adapters are deferred to P3-P6.
P3's seller-onboarding adapter and durable consent verification are now implemented; the combined workspace passes 295 tests, with only the separately opted-in real sandbox test skipped.
P4 subsequently implements authorization/capture offline; the latest workspace verification passes 349 tests with the P3 and P4 real integration tests intentionally skipped.
Delayed-disbursement implementation remains blocked on its referenced-release contract; Seller A onboarding and one US-to-US authorization/capture transaction are verified.
The first approved, zero-dollar Seller A referral attempt on 2026-10-12 ended inconclusively with malformed_response; no referral ID or usable consent artifact was saved.
That initial attempt consumed two API attempts and held eight calls, with zero reserved or committed cents.
An offline reproduction subsequently confirmed that the referral validator rejected documented Base64 IDs containing padding or reserved characters; validation and encoded referral reads were corrected.
The contributor recovered the original response from sandbox API call logs; screenshots show HTTP 201 and a padded referral ID that the original validator rejected.
The contributor opened the original consent link and reported approval as Seller A.
Resuming the same operation used only authentication and a merchant-integration read; the operation succeeded with consent_verified and ready.
Authoritative evidence confirms the expected merchant, platform connection, required permissions, payments_receivable, primary_email_confirmed, active product, and no missing scopes.
The persisted allocation now reports four consumed API attempts, zero held calls, and zero reserved or committed cents; the referral POST was not repeated.
Buyer identification, payment amount and sender-fee bounds, and explicit approval of each subsequent write remain prerequisites for actual P4 testing.
The approved P4 test subsequently created one USD 1.00 AUTHORIZE order for Seller A; checkout failed with UNSUPPORTED_PAYEE_CURRENCY as shown in screenshot 190259.
Two counted order-status checks kept the operation waiting for browser approval; after the approved buyer change, the latest observed allocation is 13 consumed attempts, 27 held calls, 100 reserved cents and zero committed cents.
No authorization or capture has been issued.
The contributor supplied a replacement US Personal buyer and confirmed USD 5,000 displayed; an offline buyer-change flow now supports a separately approved amendment of the existing unapproved order without replacing its payment commitment.
The amendment requires four additional call reservations within the unchanged 50-call cap, preserves all used counters, and does not establish that the seller currency error is resolved.
The tested audit-table migration has been applied to the existing local database, and the contributor-approved US buyer change is applied after a counted OAuth and order GET verified that the existing order remained unapproved.
The existing order and browser artifact are preserved; checkout with the US Personal buyer and Indian seller remains pending, and no authorization or capture was sent.
The contributor subsequently reported the same generic checkout failure with the US buyer and supplied a US Business replacement seller.
The approved replacement-seller referral was created successfully and is waiting for browser consent; shared accounting is now 15 consumed attempts, 31 held calls, 100 reserved cents and zero committed cents.
The existing Indian-seller order remains unchanged; no replacement payment order, authorization or capture was sent.
After the contributor completed US seller consent, a counted merchant-integration check confirmed matching identity, platform connection, required permissions, payments receivable and primary email confirmation.
The verifier could not confirm the requested EXPRESS_CHECKOUT product as active and recorded readiness_incomplete with reason product_inactive; this does not establish whether the cause is provider activation or product-response mapping.
US seller payment testing remains blocked pending product-readiness investigation; shared accounting is 17 consumed attempts, 29 held calls, 100 reserved cents and zero committed cents.
The final reserved onboarding read returned PPCP_CUSTOM and PPCP_STANDARD with vetting_status SUBSCRIBED, plus MOBILE_PAYMENT_ACCEPTANCE with status ACTIVE, but no EXPRESS_CHECKOUT product.
The requested EXPRESS_CHECKOUT product therefore does not match the returned products; this explains the verifier rejection without establishing that the seller cannot accept PayPal payments.
Do not bypass the product gate or reinterpret the approved product silently; align the requested onboarding product with documented provider semantics before another payment attempt.
Shared accounting after this diagnostic is 19 consumed attempts, 27 held calls, 100 reserved cents and zero committed cents; this onboarding operation has exhausted its two reserved recovery reads.
Offline CLI-to-runner-to-database regressions reproduced the same returned-products mismatch for EXPRESS_CHECKOUT and verified readiness for an explicitly approved PPCP request using mocked PayPal responses.
These checks do not amend the actual US seller operation or establish actual US payment readiness; seller deduplication, immutable approvals and exhausted recovery reads still prevent an unreviewed product replacement.
See the [P3 runbook product prerequisites](p3-runbook.md#requested-product-and-returned-products) for the required audited product change, old commitment retirement and checkout return-route work before the US-to-US payment test.
Offline follow-up validation passed 75 runner tests against the isolated PostgreSQL database and 28 onboarding unit tests, plus the agents workspace typecheck and formatting checks.
A scheduling-dependent concurrency assertion was made deterministic by holding the first referral dispatch while the competing runner attempts its claim; production readiness rules were not weakened.
No additional real PayPal requests or application-database amendments were performed during this offline follow-up.
Implemented [read-only product readiness maintenance and local order retirement](sandbox-maintenance-runbook.md) with immutable source snapshots, separate hash-bound approvals, two-call reservations, exclusive claims and retained history.
Offline validation passed 91 runner integration tests and 37 sandbox policy tests, plus typechecks for contracts, core, db and agents-service.
These amendments have not been approved or executed against PayPal; the actual allocation remains 19 consumed attempts, 27 held calls, 100 reserved cents and zero committed cents.
The tested maintenance audit-table migration has been applied to the existing local application database, and both actual amendments are prepared with awaiting_approval status; the US product proposal advances its private mapping version by exactly one.
The contributor subsequently approved both amendments, and their four counted sandbox requests completed successfully.
The existing Indian-seller order was confirmed unapproved with no authorization or capture, permanently blocked in this runner, and its unused money and call reservations released without cancelling it at PayPal.
The replacement US seller's PPCP subscription, identity, platform connection, required permissions, payments receivable and email confirmation all passed the authoritative read; its onboarding operation is succeeded with consent_verified evidence and the separately approved effective product context.
Latest shared accounting is 23 consumed attempts, zero held calls, zero reserved cents and zero committed cents; no authorization or capture has been sent.
The intended next payment pair remains the US Personal buyer and US Business seller; checkout return/cancel routing and a newly approved payment commitment are still required before the replacement browser test.
The checkout return and cancel routes were subsequently implemented and verified locally, with validated destinations included in new order payloads and approval summaries.
The fresh US-to-US USD 1 payment commitment is prepared and awaiting create-order approval; the full lifecycle reserves 26 calls within the existing allocation.
Latest accounting is 23 consumed attempts, 26 held calls, 100 reserved cents and zero committed cents; no replacement PayPal order, authorization or capture has been sent.
The contributor requested the next step, and the approved replacement US-to-US create-order operation completed its OAuth, seller-readiness read and order POST successfully.
The USD 1 AUTHORIZE order is now waiting for buyer browser approval, with the new return and cancel destinations included.
Latest shared accounting is 26 consumed attempts, 23 held calls, 100 reserved cents and zero committed cents; no authorization or capture has been approved or sent.
The contributor subsequently returned from checkout, and the counted order read verified buyer_approved for the expected US buyer, US seller and USD 1 order.
Shared accounting is now 28 consumed attempts, 21 held calls, zero reserved cents and 100 committed cents; committed cents represent internal budget accounting, not an actual authorization or capture.
The authorization step is prepared locally with awaiting_approval status and a zero sender-fee bound; placing the USD 1 hold requires separate explicit contributor approval.
No authorization or capture has been approved or sent.
The contributor then explicitly approved the USD 1 sandbox authorization, and the runner's authoritative result is authorized for the matching US buyer, US seller and payment commitment.
The saved allocation now shows 32 of 50 API attempts consumed, 17 calls held for the existing lifecycle, zero reserved cents and 100 committed cents.
The capture operation is prepared locally and remains awaiting_approval; it would collect the already authorized USD 1 for the seller and requires separate explicit contributor approval.
No capture has been approved or sent, and the generic capability field remains not_tested until capture evidence is recorded.
The contributor then separately approved capture of the same USD 1 authorization.
The capture write was sent once and initially recorded as inconclusive pending provider confirmation; a read-only resume confirmed the matching capture as succeeded with captured_immediate evidence.
Final shared accounting is 40 of 50 API attempts consumed, zero calls held, zero reserved cents and 100 committed cents; no principal remains for another test under the agreed USD 1 cap.
The US-to-US authorization/capture transaction is evidenced in the [P4 experiment record](evidence/p4-us-authorization-capture-2026-10-12.md), while milestone release, multiple payees and Payouts remain untested.
Affected follow-up suites pass 369 tests, with real PayPal integration disabled; applying the proposal will use counted GETs only after explicit contributor approval.
P1 is partially complete; the owner deferred remaining work on 2026-10-09, and the contributor requested a plan for that work on 2026-10-11.
The original requested targets were a default Personal buyer, two distinct Business sellers, the platform Business balance as the payout source, contributor-operated browser approvals, USD, $10 per test, $500 total, and 50 API calls.
The readiness plan retains that historical request; the current agreed limit is $1 total including sender fees and 50 runner-issued API attempts.
Login access and USD 5,000 displayed in all four assigned accounts are contributor-confirmed; dashboard feature observations and $1/50-call accounting are recorded, while transaction suitability and future operator availability remain pending.
The earlier planning session did not implement budget enforcement or perform participant setup or PayPal experiments; P2 now implements persistent runner limits without real PayPal execution.
See the [implementation plan](p1-implementation-plan.md), [operator runbook](p1-runbook.md), and [access assessment](evidence/p1-access-assessment.md).
Authentication succeeded against the fixed sandbox token endpoint with HTTP 200 on 2026-10-09 at 15:51:44.003 UTC.
Fresh sandbox OAuth also succeeded at 2026-10-11T10:52:20.384Z with HTTP 200 and a 32,400-second token lifetime; no token was printed or persisted.
Supplied screenshots show one Business sandbox account, country IN, dashboard status Verified, a USD 5,000 balance, and an associated REST app.
The later account-list screenshot shows three distinct Business accounts and one default Personal account, all IN; the app-linked platform candidate and default Business seller-a candidate are distinct.
Priority 1 execution adopted the presented platform, buyer, seller-a, and seller-b assignments using the existing screenshots.
Local checks confirmed sandbox configuration, both credentials present, and no process-level PayPal overrides; the contributor privately confirmed the secret belongs to the intended app.
The contributor subsequently confirmed the correct platform REST client ID and secret are in .env, resolving the association question as user-reported evidence; local OCR itself remained inconclusive.
Priority 1 role and configuration confirmation is complete on the combined screenshot, local-check, and contributor-confirmation evidence.
The contributor reports successful browser login to all four assigned accounts and USD 5,000 displayed in each; actual USD payment support, seller consent, and app permissions remain unverified.
Supplied feature screenshots show Payouts, Vault/save payment methods, Platform fee, and Delay disbursement checked; multiparty settings show a sandbox BN code and before-payment onboarding for Business sellers.
These are dashboard observations, not successful API tests or proof of partner approval or seller-level permissions.
One approved onboarding write has been attempted; no payment or other money-moving sandbox transaction has occurred.
Credentials remain in the owner's ignored local .env; values and access tokens were not printed or recorded.

## Historical repository baseline before P2

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
| P1 | In progress | Requesting contributor with account owner | Tooling revalidated on Oct 12; accounts, features, limits and access recorded; future browser-operator availability remains the closeout item |
| P2 | Offline foundation complete | Current implementing contributor | Contracts, pure checks, seven tables, generated migrations, transport, CLI and recovery verified; real capability adapters deferred to P3-P6 |
| P3 | Seller A actual sandbox onboarding verified | Current implementing contributor | Original referral response recovered by operator; consent approved and same operation verified ready through a counted API read |
| P4 | US-to-US USD 1 authorization and capture verified | Current implementing contributor | Matching capture confirmed by counted reads; delayed disbursement and milestone release remain untested |
| P5 | Deferred for current product scope | Unassigned | No capability result claimed; see the P7 decision |
| P6 | Deferred for current product scope | Unassigned | No capability or source-funding result claimed; see the P7 decision |
| P7 | Implementation decision recorded | Current implementing contributor | Authorization plus agency_pays selected with evidence limits in the [decision](payment-path-decision.md) |

## Capability tracking

| Capability | Status | Evidence |
|---|---|---|
| Partner Referrals onboarding | verified for tested sellers | Counted merchant-integration reads verified Seller A and the replacement US Business seller; see [P3 runbook](p3-runbook.md) |
| Delayed capture and referenced release | not_tested | None |
| Multiple payees | not_tested | None |
| Payouts from intended sender | not_tested | None |
| Authorization and capture alternative | verified for one US-to-US sandbox transaction | [Dated P4 evidence](evidence/p4-us-authorization-capture-2026-10-12.md); generic runner capability field remains not_tested |
| Platform fees | not_tested | Conditional follow-up |
| Vaulting and unattended funding | not_tested | Outside the required F0 probes |

## P1 account inventory to complete

Use aliases here and retain credentials and sensitive account mappings privately.

| Role | Alias | Country and currency | Setup status | Private access owner |
|---|---|---|---|---|
| Platform REST app and business account | platform | IN; USD 5,000 displayed | Assigned app-linked Business account; local sandbox checks passed; REST credential association, login, and balance contributor-confirmed; features unverified | Contributor with account owner |
| Buyer | buyer | IN; USD 5,000 displayed | Assigned default Personal account; login and balance contributor-confirmed; payment support untested | Contributor with account owner |
| Seller A | seller-a | IN; USD 5,000 displayed | Assigned default Business account, distinct from platform; login and balance contributor-confirmed; consent and payment readiness unverified | Contributor with account owner |
| Seller B | seller-b | IN; USD 5,000 displayed | Assigned remaining distinct Business account; login and balance contributor-confirmed; consent and payment readiness unverified | Contributor with account owner |
| Intended Payouts sender | payout-sender = platform | IN; USD 5,000 displayed | Intended sender reuses assigned platform; login and balance contributor-confirmed; usable payout funding and permissions unproven | Contributor with account owner |
| Existing Payouts recipient | payout-recipient = seller-b | IN; USD 5,000 displayed | Intended recipient reuses assigned seller-b; login and balance contributor-confirmed; payout receipt untested | Contributor with account owner |
| Historical app-linked Business observation | observed-business-1 = platform | IN; USD 5,000 displayed | Earlier observation of the subsequently assigned platform account; not an additional participant | Contributor with account owner |

Partner approval, seller features, attribution identifiers, and Payouts access remain unknown.
The $1 total and 50-call accounting rules are agreed and enforced by the P2 foundation; actual transaction compatibility remains unproven.
Evidence includes supplied dashboard screenshots, not a direct authenticated dashboard inspection by the assistant; OAuth does not establish missing account or feature facts.
The earlier deferral is historical; the current request plans the remaining tasks without executing account or feature changes.
The contributor must coordinate private access with the account owner and follow the readiness plan for any later account creation or setting changes.

## Next contributor: exact starting point

1. Read AGENTS.md, the design, the P2 closeout and the P3 implementation plan.
2. Inspect git status --short and preserve existing work; do not infer commit or merge status from this documentation.
3. Reuse confirmed account roles, credential association, login access, balances and feature observations from the access assessment.
4. Read the P3 closeout and P4 plan; P3 offline contracts, persistence, adapter and tests are complete.
5. Read the P4 implementation record and runbook; authorization/capture is verified offline, while delayed release remains blocked on its endpoint contract.
6. After P4 offline verification, privately confirm known merchant IDs, app context, required product/scopes, the intended migrated database's existing allocation and future browser availability.
7. Prepare the actual P3 operation near the browser session, obtain explicit referral approval, complete Seller A's consent and record authoritative seller grants.
8. Before actual P4 payment testing, verify P3 readiness and path-specific gates, present the purpose, accounts, principal and sender fees, and wait for separate approval before money-moving execution.

P2 supplies the durable outbox and persistent limits; P3 registers onboarding, and P4 adds authorization/capture with whole-lifecycle money and call reservations.
P3/P4 planning authorizes no PayPal execution, and all business capabilities remain not_tested.

## P4 offline implementation: 2026-10-12

Implemented strict payment context, controlled seller assertions, private checkout links, separate order/authorization/capture approvals, persistent resource lineage and bounded read-only recovery.
Successful stored P3 consent and fresh authoritative seller checks gate each write; the buyer, order, seller, amount and authorization must match before advancing.
Preparation reserves principal once, all stage fee bounds and the whole lifecycle call allowance without resetting the existing $1/50-call allocation.
The [P4 record](p4-implementation-record.md) records 349 passing tests, including 20 new payment database cases; both real sandbox opt-in tests were disabled.
All eight package typechecks, 62-file Biome CI, migration application to the isolated database, schema-drift and offline CLI help checks passed.
No actual PayPal OAuth, onboarding or payment request was made, and .env and the configured application database were unchanged.
Next action: arrange separately approved actual P3 onboarding, then establish payment prerequisites and obtain fresh approval for each actual P4 write.
Delayed capture/release remains unregistered until its confirmation, idempotency and recovery contract is established.

## P3 offline implementation: 2026-10-12

Implemented onboarding preparation, the approved referral adapter, private consent-file and read-only refresh commands, durable resource/evidence persistence and authoritative merchant/grant checks.
The [P3 record](p3-implementation-record.md) documents the delivered files and 295 passing workspace tests, including 19 new P3 database scenarios; only the real sandbox opt-in test was skipped.
All package typechecks, Biome, migration consistency, documentation and configured-credential privacy checks passed.
The generated migration was applied only to the isolated local test database; .env, the application database and PayPal accounts were unchanged.
No real OAuth or business PayPal request was made.
At P3 closeout, the next action was P4 offline implementation; the subsequent P4 section above records delivered authorization/capture and remaining actual execution gates.
Seller onboarding capability remains not_tested until that execution produces dated authoritative evidence; actual P4 payment testing has not started.

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

## Planning session: 2026-10-11

Reviewed the design spec, F0/P1 documentation, preflight code and tests, package wiring, minimal contracts, empty PayPal implementation and database schema, and current Git history.
Transcribed all six image requirements into the sandbox readiness implementation plan with phase mapping, owners, proposed file boundaries, accounting rules, tests, and exit criteria.
Updated the current status, assessment, runbook, P1/F0 plans, and README entry point to expose the pending work.
The readiness plan distinguishes account inspection from account creation, feature visibility from proven capability, and prefunded Payouts from product funding feasibility.
The proposed 50-call cap counts OAuth, reads, writes, retries, polling, recovery, and cleanup across a persistent campaign; implementation and accounting agreement remain pending.
No runtime source, credentials, migrations, accounts, app settings, or PayPal resources were changed in this session.
The pre-existing .gitignore modification was preserved.
Application tests and real OAuth were not rerun for this documentation-only work.
Validation passed across all eight updated or new Markdown files: local links, balanced fences, trailing whitespace, and the no-em-dash convention.
git diff --check passed; Git reported local line-ending warnings only.
Exact next action: perform the readiness plan's participant and feature assessment with the account owner; P2 code begins with shared contracts and durable campaign/outbox storage when implementation is requested.

## Evidence follow-up: 2026-10-11

Reviewed four supplied screenshots and recorded only sanitized observations in the P1 access assessment.
Reviewed a fifth screenshot of the sandbox app credentials page; it establishes the visible app display name and sandbox credential context, but not app type, partner approval, features, or an exact .env mapping.
Recorded the fresh OAuth result from the explicitly requested authentication check earlier in this conversation.
Confirmed the screenshot source directory is ignored; no private identifiers or credential values were copied into documentation.
P1 remains incomplete and every payment capability remains not_tested.
Reviewed Screenshot 2026-10-11 163449.png and identified one Personal and three Business accounts, all IN, with distinct candidates for platform, seller-a, and seller-b.
No account creation is needed merely to satisfy the requested account count; operational suitability is still pending.
Exact next action: confirm the proposed role assignments and private login access, inspect buyer/seller USD suitability, verify the platform app mapping, and inspect app Features.

## Priority 1 execution: 2026-10-11

Executed the [account-role confirmation plan](p1-account-role-confirmation-plan.md) using existing supplied screenshots and read-only local configuration checks.
Adopted the presented four-account mapping following the contributor's proceed instruction and verified distinct identities in the account-list screenshot.
Confirmed screenshot evidence of the platform app under the assigned platform Business account.
Confirmed root .env sandbox mode, credential presence, no process-level PayPal overrides, and Git exclusion of .env and screenshot sources.
The contributor privately confirmed the secret's association with the intended app.
Exact client-ID matching remains pending; local OCR was inconclusive and no credential values or raw OCR text were emitted.
Priority 1 is partially complete; P1 remains in progress and all business capabilities remain not_tested.
No API calls, code changes, credential edits, or account-setting changes occurred.
Exact next action: record the contributor's private client-ID confirmation, then continue with browser login access and USD readiness for the assigned accounts.

## Contributor confirmation and browser checks: 2026-10-11

The contributor confirmed the correct REST client ID and secret are configured for the intended platform app, after the SOAP versus REST distinction was clarified.
The contributor then reported successful browser login to all four assigned sandbox accounts and USD 5,000 displayed in each account.
Updated the role-confirmation plan and access assessment with this user-reported evidence; the assistant did not independently repeat browser checks or make PayPal calls.
Priority 1 is complete on the documented evidence basis; P1 remains in progress and every business capability remains not_tested.
Exact next action: inspect the platform app's features and intended payout readiness, then finalize operator availability and test-limit accounting.

## App feature screenshot review: 2026-10-11

Recorded screenshots 180505, 180518, and 180526 in the access assessment as contributor-supplied platform-app feature evidence.
Payouts, Vault, platform fees, and delayed disbursement are observed_enabled; sandbox BN code availability and Business before-payment onboarding are visible.
The cropped images do not independently establish app identity; their platform attribution follows the contributor's inspection context.
BN code values, credential values, and private account identifiers were not copied into documentation.
Partner approval, seller readiness, and every business capability remain unproven or not_tested.
No settings, runtime code, or PayPal resources were changed.
Exact next action: confirm intended payout sender and recipient, record remaining seller-readiness gaps, and finalize future operator availability and test-limit accounting before closing P1.

## P2 runner planning: 2026-10-11

The contributor accepted the explanation that all runner-issued PayPal requests count toward the 50-call cap, then requested the next runner implementation plan.
Created the [P2 runner plan](p2-sandbox-runner-implementation-plan.md) after reviewing the design, current preflight, package wiring, empty database schema, and unimplemented PayPal adapter.
The plan specifies a shared 100-cent allocation including sender fees, persistent API accounting, explicit per-payment approval, stable outbox identity, browser waits, and endpoint-specific recovery.
Money-moving retries require fresh approval; neither a restart nor a new run creates another allowance.
Rechecked official idempotency and payout-fee guidance; no exact sender fee or completed endpoint capability is inferred.
Runtime implementation remains not started, and no application source, credentials, migrations, account settings, or PayPal resources were changed during this planning work.
P1 still retains seller-readiness and future operator-availability gaps; the independent offline P2 foundation can proceed without claiming those gaps resolved.
Exact next implementation action: define the shared contracts and pure eligibility checks, then add durable allocation, approval, outbox, attempt, and browser-wait storage with disposable-database tests.

## P1 closeout review: 2026-10-12

Created the [P1 closeout review](p1-closeout.md) with completed implementation, account and feature evidence, current limits, audit results, remaining scheduling confirmation, and P2 starting steps.
Reconciled current payout sender/recipient roles and the already agreed budget accounting; no account or payment capability was inferred from those documentation corrections.
The preceding read-only audit passed all 54 preflight tests, agents-service typechecking, four-file Biome validation, local configuration/help checks, and documentation checks.
No new OAuth or business API calls were made, and no application code or credentials were changed.
P1 tooling is complete; overall P1 remains in progress pending recorded browser-operator availability for future experiments.
Independent offline P2 work can start with shared contracts and durable allocation/outbox storage.

## P2 foundation implementation: 2026-10-12

Implemented the reviewed foundation and documented its actual behavior in the [P2 runbook](p2-runbook.md) and [implementation record](p2-implementation-record.md).
All 109 tests and five affected package typechecks passed; generated migrations were applied only to a disposable local PostgreSQL test database.
No real OAuth, business writes, account changes or payments were performed.
The real CLI adapter registry is empty and blocks execution before authentication; business capability status remains not_tested.
Next action: implement the P3 seller-onboarding adapter after checking its official endpoint contract, privately confirming prerequisites and arranging contributor browser availability.
Payment preparation remains gated on established fees and endpoint readiness, followed by explicit approval for the concrete test.

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
