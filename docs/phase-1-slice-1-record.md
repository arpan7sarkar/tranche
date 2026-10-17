# Phase 1 slice 1 implementation record

Review correction, 2026-10-17: the original guard tests below missed URL query overrides and unrelated servers on the expected port.
The shared guard and fixture identity correction supersede that guard, with reproduction and validation in the [review record](pr-review-fixes.md).

Date: 2026-10-15.
Scope: F0-03 local database configuration, F0-04 guarded test execution, and F0-06 pure payment budget rules.
Baseline: `81b5098`, with planning documents already present as local untracked files.
This completes the first slice of Phase 1; recovery and product outbox corrections remain pending.

## Changes

- Local application configuration and lane-plan command examples use Compose host port 5433, while CI and container-internal port 5432 remain unchanged.
- The duplicate HOLD_MECHANISM entry was removed from `.env.example`; private `.env` credentials were not edited.
- Compose provides an optional postgres-test service on localhost:55432 with the guarded tranche_p2_test database, temporary storage, and a health check.
- Turbo forwards TEST_DATABASE_URL and DATABASE_URL and disables test caching, preventing stale skip results or changed DB state from supplying a cached pass.
- CI provisions a separate guarded database and migrates it before running tests.
- `pnpm --filter @tranche/db db:migrate:test` applies existing migrations only to the explicit guarded test target and never falls back to DATABASE_URL.
- paymentStageCalls, paymentTotalCalls, and paymentApproval moved into `packages/core/src/sandbox-payment-budget.ts`, with DB and CLI imports updated and behavior preserved.
- Schemas remain in contracts, with no contracts-to-core dependency added.

## Before and after evidence

The documented credentials failed against localhost:5432 and succeeded against the Compose application database on localhost:5433.
Another local server was accepting connections on 5432, so readiness alone would not have detected the wrong-server problem.
Before the Turbo change, explicitly setting TEST_DATABASE_URL still produced 60 passing and 128 skipped tests in the root agents task, including 97 skipped F0 database cases.
After the change, the same task with both database variables targeting the isolated test server produced 186 passing tests and only two intentionally skipped real-sandbox tests.
Application money tests created separate prefixed databases on that isolated server; the F0 runner used its guarded disposable database.

## Verification performed

| Command or check | Actual result |
| --- | --- |
| `pnpm --version` | 12.10.1, matching the pin. |
| Docker readiness | Server 29.5.3 accessible outside the sandbox. |
| `pnpm --filter @tranche/db db:migrate:test` | Passed against the temporary test fixture and again against the new Compose fixture. |
| `pnpm exec turbo run test --filter=@tranche/agents-service --only --force=true` | After fix: 186 passed and two real-sandbox cases skipped; all 97 F0 DB cases executed. |
| `pnpm --filter @tranche/contracts --filter @tranche/core test` | Contracts: 104 passed; core: 124 passed, including budget boundaries, property coverage, and approval projection. |
| Typechecks for contracts, core, db, and agents-service | Passed, including the migration script after adding scripts to DB tsconfig. |
| Biome for changed TypeScript and JSON files | Passed after formatting and import organization. |
| `docker compose --profile test config --quiet` | Passed. |
| `docker compose --profile test up -d --wait postgres-test` | New documented fixture reached healthy state. |
| Migration without TEST_DATABASE_URL | Rejected before connecting even with DATABASE_URL set. |
| Migration targeting the application database | Rejected before connecting. |
| `git diff --check` | Passed. |

Two initial single-file Turbo invocations stopped at argument parsing and executed no tests; the successful comparison used the whole filtered agents task above.
All PayPal responses in these tests were fake, and no PayPal network calls or monetary operations were executed.
The standalone temporary test container was stopped and removed, then replaced with the documented Compose fixture.
The Compose application and test services remain running for subsequent local work.
No generated migration, package lockfile, or private credential file was changed.

## Limits and next slice

GitHub Actions was configured but not executed remotely, and its reported billing issue was not rechecked.
A web build and full workspace test run were outside this focused slice.
F0-01, F0-02, F0-05, P7-01, and BASE-01 corrections remain open.
Next, reproduce pre-dispatch failures and expired referral-recovery claims through the runner or CLI using fake HTTP and the guarded database, then fix them with accounting and fencing tests.
