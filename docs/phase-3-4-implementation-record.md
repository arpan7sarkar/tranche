# Phase 3 and Phase 4 implementation record

Recorded on 2026-10-22 against merged Phase 2 baseline 217d857 (PR #23).
The implementation is on `feat/planner-and-delivery-verification` and has not been committed or pushed by the agent.
The canonical status and pending list remains [remaining_work.md](remaining_work.md).

## Delivered behavior

| Task | Implementation and local evidence |
| --- | --- |
| E1-03 | Database-free `draftPlan`, bounded schema/constraint repair, pure pricing and dependency checks, durable draft requests, and idempotent pending proposals; planner tests cover invalid output, duplicate generation, model pause, and a deal leaving draft during generation |
| E1-04 | Authenticated `/deals/new`, recoverable polling, milestone/criteria/duration review, scoped save API, and handoff to the existing Gantt; route, component, and database tests cover authentication, workspace isolation, editing, and save without sending |
| E2-01 | DNS-pinned HTTP transport, private/reserved address rejection, guarded redirects, PageSpeed checks, and browser requests routed through the same transport; local Chromium verifies desktop/mobile capture and private-subresource rejection |
| E2-02 | Read-only GitHub App reader, merge-SHA and CI checks, signed webhook intake, workspace repository bindings, semantic delivery deduplication, and retryable pending CI; fixture tests cover signatures, duplicates, merge identity, and repository scope |
| E2-03 | Structured database-free `judgeDelivery`, machine-first verification, criteria alignment, and untrusted source fencing; failed machine checks bypass the model, manual PR/CI claims fail, and notes alone cannot prove completion |
| E2-04 | Verification consumes the exact event/inbox delivery ID, persists evidence and proposals atomically, ignores superseded deliveries, and checks delivery identity again at action execution; database tests cover duplicates, retries, stale deliveries, and model-disabled machine-only work |

Planning writes proposals, never PayPal calls.
Saving a reviewed draft rejects its pending create-plan action and leaves sending as a separate existing action.
The planner rechecks draft status under a row lock after generation; the regression initially reproduced a stale proposal before the fix.
The money executor rejects a verification proposal for a superseded delivery; the regression initially reproduced acceptance of that stale proposal before the fix.
Independent planner/verifier consumers leave failed events unacknowledged while allowing later events to proceed, then revisit failures.
Pending or missing CI remains retryable rather than becoming a failed delivery criterion.

Screenshot metadata contains authenticated image routes, while JPEG bytes live separately in `evidence_image`.
Agency access is workspace-scoped; portal access is client- and deal-scoped.
The model receives observed page/PR content and images only after machine checks pass.
Delivered instructions and agency notes remain untrusted content.

## Local verification

The full repository tests, workspace typechecks, and both production builds passed during implementation.
The final verification commands are recorded below; no real PayPal, GitHub, PageSpeed, model, or Render request was used as completion evidence.
The verifier package also passed all 28 tests with real local Chromium enabled, including its two opt-in screenshot tests.
The agent package passed all 30 tests after the planner race fix.
Repository-wide Biome passed on 357 files after formatting cleanup.
Full application Playwright journeys, visual light/dark review, the complete E5 eval corpus, remote CI, and deployed provider behavior remain unverified.
Component tests and isolated browser capture tests do not establish full product end-to-end completion.

Run from the repository root in PowerShell using the disposable test database:

```powershell
docker compose --profile test up -d --wait postgres-test
$env:TEST_DATABASE_URL = 'postgres://tranche:tranche@localhost:55432/tranche_p2_test'
$env:DATABASE_URL = $env:TEST_DATABASE_URL
pnpm --filter @tranche/db db:migrate:test
pnpm test
pnpm typecheck
pnpm build
pnpm biome ci .
git diff --check

pnpm --filter @tranche/verifiers exec playwright install chromium
$env:PLAYWRIGHT = '1'
pnpm --filter @tranche/verifiers test
Remove-Item Env:PLAYWRIGHT
```

Use a separate terminal for application development so these disposable database variables do not replace the application's database configuration.
The root test command does not enable the two Chromium tests; run the explicit verifier command above.
Six real-sandbox tests remain intentionally disabled without their operator prerequisites.

## Application setup

Apply generated migrations through 0013 before using the new application features.
Migration 0012 supplies consumer receipts; 0013 supplies private screenshot storage.
Only disposable integration databases were migrated during this implementation.
For the application database, use the existing documented migration procedure after configuring its intended `DATABASE_URL`.

Install Chromium for the account running the agents service with `pnpm --filter @tranche/verifiers exec playwright install chromium`.
Linux deployment also needs Chromium's system libraries; deployment configuration and deployment smoke proof remain Phase 8 work.
Playwright is an explicit service runtime dependency and stays external to the service bundle so its browser assets retain their installed layout.

Configure the existing model variables in `.env.example` and explicitly enable `TRANCHE_LLM` for model-dependent work.
With `TRANCHE_LLM=off`, planner and prose judgment remain pending; machine-only verification and deterministic money handlers continue.
Run `pnpm --filter @tranche/agents-service consume:local` for the local durable consumers, alongside the existing application and money worker setup.
The Render task registry exposes the same planner/verifier handlers, but remote scheduling and execution have not been verified.

For GitHub, configure `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_WEBHOOK_SECRET`.
Install the app on the intended repositories with read access for pull requests, contents, checks, and commit statuses, and subscribe to pull request events.
Point its webhook at `/api/github/webhook`.
An operator must set `GITHUB_WORKSPACE_REPOSITORIES` to a JSON mapping from workspace IDs to approved `owner/repository` names.
An installation alone does not authorize cross-workspace access.

Configure `PAGESPEED_API_KEY` as needed for provider quota.
`PAGESPEED_API_BASE` defaults to Google and is subject to URL safety checks.
Local verifier/PageSpeed fixtures must use exactly `http://localhost:4020` with both `NODE_ENV=test` and `VERIFIER_ALLOW_TEST_LOCALHOST=1`.
The older E5 example using port 4010 must be adapted to this stricter verifier boundary when its fake server is implemented.
The exception is disabled in production, including when the flag is accidentally set.

## Remaining scope

Phase 5 negotiation is next, followed by monitoring/notifications/dashboard, offline end-to-end proof, deployment, bounded real sandbox validation, and submission work.
No claim is made that live credentials, installation permissions, quotas, remote CI, or deployed browser dependencies are already verified.
