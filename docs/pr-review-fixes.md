# PR review corrections

Date: 2026-10-17.
PR #20 review: shared database guard, reliable fixture identity, bash setup, and documentation consolidation.

## Reproduction

The original migration command accepted a URL whose pathname was tranche_p2_test but whose query set database to a separate canary database.
This was reproduced only inside the project's owned disposable test container, using a newly created empty tranche_guard_canary_20261017 database.
That canary went from zero to 37 public tables after the old migration command ran, confirming the reviewer's report without touching application or experiment data.

## Corrections

Both migration and F0 test setup use the same sandbox-test-db helper.
It rejects every query string, including an empty question mark, plus fragments, foreign hosts, wrong protocols, ports, and database paths before opening a connection.
It supplies explicit parsed connection options instead of passing a raw URL to postgres.js.
After connection, it checks current_database and an owned-fixture marker before returning a database handle for any migration or truncation.
The marker is initialized inside the owned Compose or CI service, rather than being installed through an untrusted host connection.
The marker prevents accidentally accepting an unrelated server with the same database name; it is an accident-prevention measure, not authentication against a hostile database administrator.

README's setup block now uses bash, matching the repository and CI.
The handoff, implementation plan, status tracker, and checklist are consolidated into [remaining_work.md](remaining_work.md), preserving all 33 task IDs, acceptance criteria, and the handoff's PayPal and integration requirements.
Historical audit and test records remain separate evidence, and audit table formatting was corrected to avoid multiple sentences on one line.

## PR #20 validation

The shared guard has 16 passing regression cases, including the query bypass, malformed URLs, and wrong database/fixture identities.
DB and agents-service typechecks pass.
The patched migration rejects the query override before connecting and rejects the old unmarked disposable fixture before migrating.
The recreated marked Compose fixture initialized successfully and accepted the guarded migration command.
The complete agents-service suite passed 186 tests with two real-sandbox cases intentionally skipped.
Contracts passed 104 tests and core passed 124 tests, for 430 passing cases across these checks including the 16 guard cases.
Biome, typechecks, and git diff whitespace checks passed.
No real PayPal operations, application database migrations, or remote CI runs were performed.

## PR #21 reproduction and corrections

Before the corrections, five selected CLI/runner regression cases failed against the guarded disposable database with fake provider responses.
Two cleanup cases exposed the raw semantic_key unique-constraint error when concurrent or repeated prepare-void calls generated different operation IDs.
Two retry cases exposed incorrect eligibility when the application clock was ahead of an active lease or behind an expired lease.
The referral recovery case exposed a stale_claim failure with the application clock ahead of the database.

Cleanup preparation now finds the existing semantic identity under the allocation lock and returns the same operation when the run and payload match.
Concurrent calls, timeout retries, and retries after completion retain the same operation ID, request ID, reservation, and approval history.
A changed payload returns the named cleanup_identity_conflict error.
Eight application-clock lease checks now use PostgreSQL now(), matching dispatch, request reservation, and recovery claims.
Business execution and onboarding deadlines retain their existing behavior; worker fencing still requires the current claim token.

## PR #21 validation

The complete agents-service suite passed 206 tests with two real-sandbox cases skipped, including all 122 runner cases.
The shared database guard passed all 16 cases.
Contracts passed 104 tests, core passed 125 tests, and PayPal passed 99 tests with four real-sandbox cases skipped.
The total is 550 passing tests and six intentionally skipped real-sandbox cases.
Contracts, core, DB, PayPal, and agents-service typechecks passed.
Biome and git diff whitespace checks passed.
No real PayPal requests or remote CI runs were performed.

## Branch and publication status

The database guard and consolidated documentation are committed locally on fix/f0-test-setup-and-budget-rules as 1e7bc90.
The recovery branch was rebased onto that corrected local branch, and its review corrections are recorded separately from the database fix.
The pre-push upstream read on 2026-10-17 showed main at 81b5098, PR #20 at b994685, and PR #21 at 20c068c.
After checking the fixes against the supplied review comments, all 16 guard tests and five selected recovery regressions passed again before publication.
The PR #20 corrections were pushed to fix/f0-test-setup-and-budget-rules at 1e7bc90.
The PR #21 corrections were then pushed to fix/f0-recovery-and-authorization-cleanup at b2dc730 using an explicit force-with-lease against the verified old head 20c068c.
After PR #20 merges, rebase PR #21 onto the updated main while dropping its inherited PR #20 commits, leaving only recovery changes.
The required PR #21 title is `fix(f0): Recover interrupted operations and add approved void cleanup`.
The title has not been changed because authenticated GitHub PR reads returned 404 in this session.
No merges or successful PR metadata updates were performed, and remote CI remains unverified.
