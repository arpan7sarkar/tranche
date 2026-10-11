# Priority 1: Confirm sandbox account roles

Date: 2026-10-11.
Status: Complete for role and configuration confirmation, combining screenshot evidence, local checks, and contributor confirmation; payment readiness remains unproven.
Parent: [sandbox readiness implementation plan](sandbox-readiness-implementation-plan.md).
Evidence destination: [P1 access assessment](evidence/p1-access-assessment.md).

## Goal and scope

Confirm which existing sandbox account represents the platform, buyer, seller-a, and seller-b, and confirm that the platform app matches the local configuration.
This is an account inspection and documentation task; it requires no application code or database changes.
Role names are assignments for Tranche's experiments, not roles automatically granted by PayPal.
Login access and displayed USD balances are recorded in the follow-up below; app permissions, seller onboarding, and actual USD transaction support remain unverified.

## Known facts and proposed assignments

The supplied account-list screenshot shows three Business accounts and one Personal account, all with country IN.
The rows below refer to Screenshot 2026-10-11 163449.png; row positions are clues from that image, not permanent account identifiers.

| Alias | Candidate in supplied screenshot | Reason for proposal | Current status |
|---|---|---|---|
| platform | First Business row, Partner badge, one app | Account details show the platform app | Assigned; REST credential association, login, and USD 5,000 balance contributor-confirmed |
| buyer | Default Personal row | Requested default Personal buyer | Assigned; login and USD 5,000 balance contributor-confirmed |
| seller-a | Default Business row, one app | Requested default Business seller | Assigned; login and USD 5,000 balance contributor-confirmed |
| seller-b | Other Business row, Partner badge, no apps | Existing separate Business account | Assigned; login and USD 5,000 balance contributor-confirmed |

The platform candidate and default Business seller candidate are visibly separate accounts.
No new account is needed merely to meet the requested account count.
An app count, editable app name, Default badge, or Partner badge does not establish payment permissions or successful onboarding.
Previous OAuth success proves that a credential pair authenticated against sandbox, not which account owns that pair.

## Responsibilities

The contributor or account owner performs the private dashboard inspection and confirms the assignments.
The documentation contributor records only aliases, account types, countries, dates, provenance, and confirmation outcomes.
The assistant can review sanitized observations and update documentation; it has no authenticated dashboard session established by this plan.
Keep the exact alias-to-account mapping in an owner-controlled private record outside tracked documentation.

## Execution order

### 1. Identify the four exact accounts

Open the sandbox account list and inspect each candidate's details.
Privately associate each alias with a stable account identifier so that sorting, similar names, or changing app counts cannot cause confusion.
Record the observed account type and country without copying emails or merchant identifiers into project documentation.
Compare the private identifiers to confirm that both sellers are distinct from each other and from the platform account, and that the buyer is a separate account.
If details differ from the screenshot, record the discrepancy and leave the affected assignment pending rather than choosing a replacement silently.

### 2. Trace the platform app to its Business account

Inspect the intended app with Sandbox selected and establish its associated sandbox Business account from the dashboard's account/app association.
Use that association to identify platform; do not rely solely on the app display name or Partner badge.
The default Business account also has an app, so the presence of one app alone cannot identify the platform.
If the app belongs to a different account than proposed, record the mismatch and have the owner resolve which app/account is intended before finalizing roles.

### 3. Match the app to local configuration privately

Inspect the root .env privately and verify PAYPAL_ENV is sandbox.
Compare PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET with the intended app's sandbox credential pair without printing, copying into reports, or taking screenshots of their values.
Check whether process-level PAYPAL_ENV, PAYPAL_CLIENT_ID, or PAYPAL_CLIENT_SECRET overrides would change the values used by the preflight command.
The [runbook](p1-runbook.md) documents that process environment values override the loaded .env values.
Record only environment confirmation, credential-pair match or mismatch, and whether an effective-configuration override remains unresolved.
Do not change credentials, clear overrides, rotate secrets, or substitute another app as part of this inspection plan.
A mismatch leaves configuration confirmation pending with an owner and next action.
Do not repeat OAuth merely to confirm identity; another successful token exchange would not establish the missing dashboard association.

### 4. Confirm the assignments with the account owner

Present the four aliases and their privately identified accounts to the owner.
Record the owner's acceptance or requested correction for each assignment with the date.
Mark accepted assignments as confirmed for the planned experiments, while retaining payment readiness as unverified.
Leave payout-sender and payout-recipient as separate pending readiness checks; this task does not prove their suitability.

### 5. Update the assessment and handoff

Update the account inventory and add a dated confirmation record in the [assessment](evidence/p1-access-assessment.md).
Update [f0-status.md](f0-status.md) with completed checks, any mismatches, and priority 2 as the next action when this task is complete.
Preserve earlier screenshot observations as dated historical evidence.
Do not mark P1 complete or change any payment capability from not_tested after completing this task alone.

## Confirmation record

Execution date: 2026-10-11.
The contributor instructed execution of the presented role mapping; assignments below are adopted for the planned experiments.
The existing ignored account-list screenshot retains the exact private account identities; row references in this plan refer to that fixed image, not a newly sorted dashboard.

| Check | Result to record |
|---|---|
| Four role assignments | Adopted following contributor instruction; platform, seller-a, and seller-b are Business, buyer is Personal; all IN |
| Separate participants | Confirmed from the four different account identifiers in the supplied account-list screenshot |
| Platform app association | Screenshot 162545 shows the app under platform; screenshot 163125 shows its sandbox credentials page |
| Root .env credential pair | Contributor confirms the correct REST client ID and secret for the intended platform app are in .env; exact association is user-reported, not established by OCR |
| Effective configuration | Root .env specifies sandbox and contains both credentials; no process overrides for the three PayPal variables were present during inspection |
| Provenance | Screenshot review and read-only local checks by assistant; both REST credential associations confirmed by contributor |
| Remaining gaps | None for this role-confirmation task; app features and actual transaction support remain separate pending checks |

No credential values or raw OCR text were printed or written into documentation.
The root .env and screenshot directory are ignored by Git.
No application code, credentials, account settings, or PayPal resources were changed, and no API calls were made during this task.
Earlier successful authentication remains historical evidence, not a new authentication test.

### Contributor follow-up: 2026-10-11

After the REST versus SOAP distinction was explained, the contributor confirmed that .env contains the correct REST client ID and secret for the intended app.
This resolves the earlier pending client-ID association as contributor-confirmed; the automated OCR result itself remains inconclusive.
The contributor subsequently reported successful browser login to all four assigned accounts and a displayed USD 5,000 balance in each.
These login and balance results are user-reported observations, not independent browser checks or completed payment tests by the assistant.

## Completion criteria

- The owner has confirmed all four assignments and retains the exact mapping privately.
- The account types and countries are recorded from inspection.
- The buyer, platform, and both sellers are confirmed as separate accounts.
- The intended sandbox app is associated with the confirmed platform Business account.
- The root .env credential pair matches that app, with no unresolved effective-configuration override.
- The assessment and handoff contain dated, sanitized evidence and the next pending task.

If any criterion cannot be established, report this task as partially complete with the specific gap.
After documentation updates, validate local links, Markdown formatting, the no-em-dash convention, and git diff --check.
Application tests and PayPal API calls are unnecessary for this inspection and documentation task.
The next task is to inspect app features and intended payout readiness, then finalize browser-operator availability and test-limit accounting.
Displayed USD balances do not establish seller consent, USD transaction compatibility, or permission to use a payment product.
