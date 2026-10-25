# Phase 5 negotiation implementation

Recorded on 2026-10-25.
This work builds on the uncommitted Phase 3/4 implementation on `feat/planner-and-delivery-verification`.
No commit, push, remote deployment, or real provider call was performed for Phase 5.
The canonical plan and pending checklist remains [remaining_work.md](remaining_work.md).

## Scope and behavior

| Task | Delivered behavior | Local evidence |
| --- | --- | --- |
| E3-01 | Shared decision schemas, pure scope/mandate/concession rules, bounded retries, and database-free `negotiateTurn` | Protocol tests, property-based budget checks, seven scripted evaluation cases, and model-disabled behavior |
| E3-02 | Durable initiation, one open negotiation per deal, serialized turns, atomic final proposal/event writes, and exact opposite-offer acceptance | Database tests for duplicate starts/runners, transient recovery, round limits, foreign access, stale plans, and private responses |
| E3-03 | Authenticated routes, simulated client setup, live polling/SSE refresh, offers/transcript, read-only Gantt preview, and escalation state | Route authorization tests and component tests for setup, pending approval, waiting, failure, and escalation |

Only a sent or negotiating deal with draft milestones can start a negotiation.
The agency explicitly configures the simulated client for this demo; the form labels that distinction and does not imply an independent client authorized payment.
The existing client policy is not replaced or widened.
The default client policy still requires client approval for release, and the existing executor still prevents agency-side release from bypassing it.

Each negotiation stores the reviewed base plan, a fingerprint including task/milestone identity and dates, and its original start date.
The agency floor cannot be lower than the workspace minimum project price.
The agents alternate within the smaller mandate round limit.
An agent sees only its own mandate; project and transcript content remain untrusted data.
Offers can adjust existing milestone prices and task durations, never scope, dependencies, acceptance criteria, or payees.
Agency prices cannot increase after an offer, and client offers cannot decrease.
Acceptance must satisfy both mandates and exactly match the opposite side's latest offer.

Model-generated explanations are not copied into public messages, offer notes, proposals, or events.
Public messages are generated from the validated decision kind so a model cannot leak its private mandate through free text.
Published offer prices and dates remain visible because they are the negotiated terms.
The room API omits both mandate objects.

Each turn runs under the negotiation row lock; duplicate runners reload the committed result.
Model/provider failures roll back only the current turn, leaving earlier turns available for recovery.
Invalid model decisions receive one repair attempt and then escalate.
Model-disabled work remains open and retryable, rather than becoming a false escalation.
The plan is rechecked under the deal lock after generation and again before acceptance execution.

The `negotiation.started` consumer and `runNegotiation` Render task share the same runner.
The route schedules an immediate `launch` after committing the durable request; the consumer recovers a missed or failed launch.
Local consumers also process negotiation events.
Independent consumer retries allow other negotiations to proceed when a model-dependent request is paused.

## Agreement and approval

An agreed negotiation means both agents accepted terms, not that the deal has already been applied or funded.
The runner writes one pending `accept_plan` with the accepting agency/client side.
The existing policy and approval executor remains responsible for application.
The room displays the proposal's application status separately.
A pending agreement blocks a second negotiation until it has been applied, rejected, or failed.

Three executor regressions were reproduced before fixing them: stale plans could execute, changed mandates were not rechecked, and execution replaced the negotiated start date with the current day.
The executor now rechecks the saved plan fingerprint and both mandates and preserves the negotiated start date.
After writing the accepted plan inside the same locked transaction, it calculates the current `planVersion` and uses the existing agreement implementation.
Tests cover all four public `agreeToPlan` outcomes: `agreed`, `plan_changed`, `already_agreed`, and `not_agreeable`.
No negotiation function calls a PayPal endpoint.
Applying an agreement schedules the existing deterministic funding work rather than performing a payment in the runner.

Escalation stores one pending escalation proposal and a durable event for human review.
Email delivery for that event remains Phase 6 notification work.

## Migration and local operation

Generated migration `0014_melodic_leech.sql` adds the plan snapshot, fingerprint, start date, and partial unique index for one open negotiation per deal.
Apply migrations through 0014 before starting Phase 5 application workers.
Only disposable integration databases were migrated during verification.
Historical negotiation rows without snapshots are escalated by the new runner instead of continuing against an unrecorded base plan.

Start the existing web app and local consumer with the application database configured:

```powershell
pnpm dev
# In a separate terminal with the same application environment:
pnpm --filter @tranche/agents-service consume:local
```

Enable model generation explicitly through the existing `.env.example` configuration when using a real model.
Keep PayPal in sandbox mode.
Open a sent deal and follow **Open negotiation room**.
Enter the simulated client's budget, optional deadline, and round limit, confirm the simulation, then start.
The two offer columns, transcript, dates, and Gantt preview refresh as turns arrive.
Review the application status and use the existing workspace or client approval flow when required.

For offline tests, configure the disposable database in a separate terminal:

```powershell
docker compose --profile test up -d --wait postgres-test
$env:TEST_DATABASE_URL = 'postgres://tranche:tranche@localhost:55432/tranche_p2_test'
$env:DATABASE_URL = $env:TEST_DATABASE_URL
pnpm --filter @tranche/agents exec vitest run src/negotiator
pnpm --filter @tranche/core exec vitest run src/negotiation.test.ts
pnpm --filter @tranche/agents-service exec vitest run src/money/negotiation.test.ts
pnpm --filter @tranche/web exec vitest run src/app/api/negotiations/routes.test.ts src/components/negotiation-room.test.tsx
pnpm test
pnpm typecheck
pnpm build
pnpm biome ci .
git diff --check
```

## Verification boundaries

Targeted checks passed: 25 agent negotiation tests, three pure-rule tests, four executor tests, and nine route/component tests.
The final repository run passed 1,074 tests; all eight workspace typechecks and both production builds passed.
Repository-wide Biome passed on 380 files, and `git diff --check` passed.
Six real-sandbox tests and two opt-in verifier screenshot tests were skipped in this run.
The screenshot tests were previously verified during Phase 4 and were not rerun for Phase 5.
The agent checks include seven deterministic prompt evaluation cases using the production `negotiateTurn` function.
They do not establish live model quality or complete the larger E5 evaluation corpus.
No live model, PayPal, GitHub, or Render execution was used as evidence.
Remote CI, deployment, visual review in both themes, and full application browser journeys remain unverified.
Phase 6 monitoring, notifications, and dashboard work is next.
