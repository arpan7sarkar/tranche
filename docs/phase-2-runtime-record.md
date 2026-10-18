# Phase 2 agent runtime record

Date: 2026-10-18.
Baseline: bad27a1, containing merged PR #22.
Branch: feat/agent-runtime.
Scope: E1-01 and E1-02, plus fake-model and replay foundations from E5-01 and E5-03.

## Implementation

The public runtime in packages/agents exports model selection, structured generation, untrusted content wrapping, decideAction, proposal and evidence writers, and event consumption.
AgentDecision is a shared Zod contract containing reasoning, evidence references, and an ActionPayload.
Agent identity, side, deal identity, and idempotency keys are assigned by trusted workflow code rather than model output.
Gemini remains the configured default; AI_FALLBACK=openai explicitly selects the fallback provider.
Model names are configurable and their live availability was not verified.
Generation is limited to two schema attempts by default, a total 30-second timeout, and 4096 output tokens per attempt.
Usage logs contain token counts and attempt numbers, not prompts or outputs.
TRANCHE_LLM=off prevents model calls and leaves model-dependent events pending without failing the money tasks.

proposeAction inserts only pending rows, rejects human and system identities, validates deal ownership for referenced resources, and rejects changed input under an existing idempotency key.
recordEvidence requires the expected deal ID, validates milestone ownership, and deduplicates under a transactional advisory lock, including null check indexes.
Conflicting evidence under an existing content identity is rejected.
These checks supplement the existing policy engine's independent validation.
The agents never execute a proposal or write money tables.
Read-only PayPal tools are available through @tranche/agents/tools, reusing the existing allowlist and sandbox-only factory.
The separate tools entry avoids loading the toolkit into consumers that do not use it.

## Event delivery and workflow behavior

Generated migration 0012_adorable_mandrill adds agent_event_receipt with a composite consumer/event primary key.
The dispatcher selects events without receipts rather than assuming event IDs commit in order.
The existing event_cursor row serializes each consumer with SKIP LOCKED; lastEventId remains an informational high-water mark.
Each successful event records a receipt, and a handler failure stops that consumer's batch before recording the failed event.
Earlier successful receipts commit and the failed event remains eligible on the next run.
If the worker or transaction dies, handlers may run again, so their effects must be idempotent.
The decision consumer reuses a committed proposal after a crash before its receipt, without another model call.
A disabled model pauses its consumer at that event; it does not silently acknowledge or discard the event.
Other consumer tasks and deterministic money tasks remain independent.

Render consume and consumeAll tasks, AGENT_HANDLERS, AGENT_TICK_TASKS, and launch are wired alongside the existing money tasks.
Partial remote configuration fails explicitly; inline execution is for local development and is refused in production.
The local loop runs with pnpm --filter @tranche/agents-service consume:local.
The production consumer registry is intentionally empty until the planner, verifier, negotiator, and monitor phases register their business handlers.
The workflow integration tests use a real decision consumer with fake model output to prove the path into proposed_action.

## Offline evaluation foundations

The testing entry exports scriptedModel, guarded database fixtures, cachedModel, defineSuite, and summarize.
Replay mode fails on a missing recording and cannot call the provider.
Cache identity includes provider/model, generation parameters, schema, and content, while normalizing only generated untrusted-fence nonces and excluding abort signals.
Recording is explicit and stores output fixtures without provider headers or request bodies.
Only scripted responses were recorded during these tests.
Critical eval failures fail the result even if a suite's aggregate threshold passes; missing or empty required suites also fail.
These foundations do not complete the four domain eval suites or the full end-to-end seed required by E5-01 and E5-03.

## Phase boundary and public decisions

The stable database-free decision entry for this phase is decideAction(input, model), returning AgentDecision.
It performs structured generation only; callers supply trusted instructions and untrusted deal context.
The domain APIs draftPlan, judgeDelivery, negotiateTurn, and assessDeal will use this runtime in their respective implementation phases.
Phase 3 still owns planner pricing and criteria validation, plan repair, draft-plan APIs, authenticated brief entry, and Gantt review UI.
Phase 4 owns verifier tools and GitHub integration; Phase 5 owns negotiation; Phase 6 owns monitor behavior and notifications.
Deployment cron wiring and real provider validation remain in their existing later phases.

## Verification

Phase 2 implementation and local validation are complete.

| Command | Result |
| --- | --- |
| `pnpm --filter @tranche/agents test` | 16 passed; all database cases executed |
| `pnpm --filter @tranche/agents-service test` | 229 passed, 2 real-sandbox cases skipped |
| `pnpm --filter @tranche/agents-service exec vitest run src/agents` | Final focused rerun: 4 passed |
| `pnpm --filter @tranche/web test` | 374 passed |
| `pnpm --filter @tranche/contracts test` | 104 passed |
| `pnpm --filter @tranche/core test` | 125 passed |
| `pnpm --filter @tranche/db test` | 32 passed with the fixture configured |
| `pnpm --filter @tranche/paypal test` | 101 passed, 4 real-sandbox cases skipped |
| `pnpm --filter @tranche/agents exec vitest run src/testing/replay.test.ts` | Final focused rerun: 2 passed |
| Package typechecks for contracts, db, agents, agents-service, and web | All passed |
| `pnpm --filter @tranche/agents-service build` | Passed |
| Pinned Biome across 36 changed/new source and configuration files | Passed; generated migration metadata excluded |
| `git diff --check` | Passed |
| Root `pnpm test` | Passed: 981 tests passed and six real-sandbox tests skipped |
| Root `pnpm typecheck` | Passed across all eight workspaces |
| Root `pnpm build` | Passed for agents service and Next.js production build |
| `pnpm biome ci .` | Passed across 324 files after checkout normalization |

The latest results across the seven package suites total 981 passing tests and six intentionally skipped real-sandbox tests.
Focused reruns are not added to that total.
The first database package run omitted the fixture environment and skipped 16 integration tests; the rerun configured the disposable fixture and passed all 32 tests.
No skipped integration case is counted as completed validation.
Agent runtime fixtures use tranche_test_agent_runtime; agents service fixtures use the existing tranche_test_agents database and its per-file advisory lock.
The agent fixture helper validates TEST_DATABASE_URL with the shared disposable fixture guard and passes that URL explicitly to createTestDb.
DATABASE_URL remains independent, matching CI and normal application setup.
The database tests use the owned disposable PostgreSQL fixture on port 55432 and dedicated package databases under that verified server.
No real model, PayPal, or Render request was performed.
The generated migration was exercised on disposable test databases only; the application database was not migrated.
Remote CI, deployed Workflows, live model access, and Playwright journeys are not established by these local checks.

## PR readiness corrections

The first readiness review reproduced a setup failure with CI's separate database URLs: the agent helper incorrectly required DATABASE_URL to point to the disposable fixture as well.
The helper now uses only the guarded TEST_DATABASE_URL, and createTestDb accepts an explicit base URL while retaining the existing default for other callers.
Revalidation used DATABASE_URL=postgres://tranche:tranche@localhost:5432/tranche and TEST_DATABASE_URL=postgres://tranche:tranche@localhost:55432/tranche_p2_test.
All 16 agent runtime tests and four workflow tests passed with that configuration, and db, agents, and agents-service typechecks passed.
All 32 database package tests also passed on the disposable fixture after the shared helper change.
Repository-wide Biome initially reported 277 formatting errors from Windows CRLF checkout content.
The source files were normalized with the pinned formatter, and .gitattributes now selects LF for text files on future checkouts.
Git's content diff showed no substantive changes to those pre-existing formatted source files.
The full biome ci check now passes across 324 files, and git diff --check passes.
These are local reproductions of the reported blockers; remote CI has not been run or verified.
The final root test, typecheck, and build sequence passed on Node 22.19.0.
For the root test run, both database environment variables pointed to the owned disposable fixture on port 55432.
The separate-URL compatibility check above remains the evidence for the CI environment arrangement.
