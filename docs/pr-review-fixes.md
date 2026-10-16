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
