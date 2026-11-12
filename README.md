# Tranche

**Clear milestones. Confident payments.**

Tranche helps freelancers and small agencies turn client briefs into AI-generated plans, verify milestone deliveries, and manage payments through PayPal.
Human approval gates and an audit trail keep consequential decisions visible.
Built for the PayPal AI Hackathon using **PayPal Sandbox only**.

[Pitch deck in Canva](https://www.canva.com/d/kJ63oInu7Hc-506) · [Project write-up](tranche.md) · [Design specification](docs/superpowers/specs/2026-10-08-tranche-design.md)

## Why Tranche

Freelancers need to agree on scope, show that work meets the brief, and understand what is waiting before payment.
Tranche connects those steps through the same milestone instead of leaving the plan, delivery evidence, client decisions, and payment state in separate tools.

| Freelancer question | Tranche's response |
|---|---|
| What exactly did we agree? | Reviewable milestones, prices, tasks, dependencies, and acceptance criteria |
| Does this delivery meet the requirements? | Machine checks and structured AI assessment, with evidence available for review |
| What needs to happen before payment? | Explicit approval gates, a client release flow, and visible payment status |
| What happened while the agents were running? | Negotiation transcripts, agent activity, and an audit trail |

## How it works

```mermaid
flowchart TD
    A[Freelancer submits a client brief] --> B[AI drafts milestones, tasks, criteria, and prices]
    B --> C[Freelancer reviews the plan]
    C --> D[Client review and agreement]
    D --> E[Schedule tasks and eligible milestone funding]
    E --> F[Client approves PayPal Sandbox authorization]
    F --> G[Freelancer submits delivery evidence]
    G --> H{Required machine checks pass?}
    H -- No --> I[Inspect evidence and correct delivery]
    I --> G
    H -- Yes --> J[Structured AI assessment and required human review]
    J --> K[Client releases eligible payment]
    K --> L[Policy engine and outbox execute PayPal capture]
    L --> M[Reconcile payment status and record activity]
```

Negotiation can escalate to human review when a decision needs attention.
Funding follows milestone scheduling and payment eligibility rules; the diagram summarizes the project path rather than every internal state.

## Product features

- **AI project planning:** Convert a brief into structured milestones, tasks, budgets, and delivery requirements.
- **Interactive scheduling:** Inspect task dates and dependencies in Bryntum Gantt.
- **Negotiation room:** Follow the transcript, project timeline, agent status, and requests for human review.
- **Client portal:** Review the plan, inspect delivery evidence, and approve eligible releases.
- **Delivery verification:** Check submitted work using supported machine checks and structured AI assessment.
- **Milestone payments:** Authorize and capture PayPal Sandbox payments through policy-controlled workflows.
- **Cash-flow dashboard:** Inspect held funds, released payments, forecasts, deal tables, and agent activity.
- **Dashboard assistant:** Ask about available project and payment data; the assistant cannot approve actions or move money.
- **Client notifications:** Send queued client communications through connected Gmail or a configured Resend sender, with provider acceptance and portal-open tracking.

Email provider acceptance does not prove inbox delivery.
See [client notifications](docs/client-notifications.md) for setup, sender permissions, and status definitions.

## Demonstrated sandbox result

The Northstar launch readiness demonstration completed a **USD 1.00 PayPal Sandbox authorization and capture** after delivery verification and client release.
The approved platform fee was USD 0.02 deducted from the same capture.
A missing delivery URL failed verification before a corrected URL passed the endpoint availability check.
The separate USD 4,799 website implementation milestone remained agreed and unfunded.
This demonstration proves the endpoint readiness milestone, not completion of a website or production payment readiness.

## Technology and integrations

| Tool | Role in Tranche |
|---|---|
| PayPal Orders v2 and Payments v2 APIs | Checkout orders, authorizations, captures, and payment status reads |
| PayPal JavaScript SDK v6 | Client-facing checkout |
| PayPal Partner Referrals and Merchant Integrations APIs | Seller connection and onboarding readiness |
| PayPal Webhooks | Signature-verified payment events and reconciliation |
| PayPal Agent Toolkit through MCP | Allowlisted, read-only PayPal tools for agents |
| Google Gemini via Vercel AI SDK | Planning, agent reasoning, delivery assessment, and dashboard answers |
| AG Grid / AG Studio | Cash-flow tables, payment charts, agent activity, and dashboard assistant |
| Bryntum Gantt | Interactive task scheduling and dependencies |
| Render Workflows | Background agent and workflow execution |
| Postman | Manual PayPal Sandbox API testing; no collection is included in the repository |
| Next.js, React, TypeScript | Web workspace, client portal, and API routes |
| PostgreSQL and Drizzle | Project state, events, financial workflow records, and migrations |
| Zod | Validation of shared contracts and structured AI output |
| pnpm and Turborepo | Workspace dependencies, builds, and task orchestration |

The current default Gemini model is `gemini-3.5-flash-lite`, configurable through `GEMINI_JUDGE_MODEL` and `GEMINI_FAST_MODEL`.
Gemini 3.6 Flash was also used during development and delivery verification.
An OpenAI fallback is available through `AI_FALLBACK=openai`; it is not the default provider.

## Payment and agent boundaries

- Agents insert typed proposals into `proposed_action`; they never call money-moving PayPal endpoints directly.
- The pure policy engine evaluates proposals; eligible writes execute through the outbox with `PayPal-Request-Id` idempotency keys.
- Funding, hold renewal, and auto-release scheduling are deterministic rules rather than agent decisions.
- Machine checks gate verification; AI output cannot override a failed check.
- Webhooks are signature-verified and deduplicated by source event ID through the inbox.
- Delivered pages, pull requests, and briefs are treated as untrusted input.

## Repository layout

| Path | Purpose |
|---|---|
| `apps/web` | Next.js freelancer and agency workspace, client portal, API routes, and webhooks |
| `apps/agents` | Render Workflows tasks, background consumers, notifications, and executor |
| `packages/contracts` | Shared Zod schemas |
| `packages/core` | Pure state machine, scheduling, and policy engine |
| `packages/db` | Drizzle schema, migrations, database client, and test helpers |
| `packages/paypal` | Sandbox PayPal client and read-only Agent Toolkit integration |
| `packages/agents` | Prompts, planning, tools, model routing, and offline evaluations |
| `packages/verifiers` | Delivery checks, GitHub evidence, PageSpeed, and screenshots |
| `e2e` | Playwright journeys, local provider fakes, and test infrastructure |

## Local setup

Requires Node.js 22.12 or newer, the pnpm version pinned in `package.json`, and Docker with Compose.
If pnpm is not on your PATH, use Corepack to enable the pinned package manager.

```bash
corepack enable
pnpm install --frozen-lockfile
if [ ! -e .env ]; then cp .env.example .env; fi
pnpm db:up
```

Preserve an existing `.env` and add only missing settings from `.env.example` privately.
For the default Compose service, the application database is `localhost:5433`; container-internal connections use port 5432.
Set `BETTER_AUTH_SECRET`, keep `PAYPAL_ENV=sandbox`, and use matching local values for `APP_URL` and `BETTER_AUTH_URL`.
The web application runs at `http://localhost:3000`.

Export your trusted, shell-compatible root `.env` before running migrations or the web application directly.
Using the package command directly passes the exported runtime settings to Next.js without relying on Turbo's environment filtering.

```bash
set -a
. ./.env
set +a
pnpm --filter @tranche/db db:migrate
pnpm --filter @tranche/web dev
```

AI generation is paused by default with `TRANCHE_LLM=off`.
To enable Gemini, configure `GOOGLE_GENERATIVE_AI_API_KEY` and set `TRANCHE_LLM=on` before starting the services.
PayPal checkout needs sandbox credentials and the seller configuration documented in the operator runbooks below.
Gmail and Resend require their own configuration; neither connects automatically from API credentials alone.

### Background execution

The local consumer processes agent events and queued notifications:

```bash
pnpm --filter @tranche/agents-service consume:local
```

Run it in a separate terminal only when you intend to process queued work.
Starting a configured notification worker can send previously queued emails.
The Render Workflows development server is available through `pnpm dev:agents` and requires the Render CLI.

## Testing and validation

```bash
pnpm biome ci .
pnpm typecheck
pnpm test
pnpm --filter @tranche/agents eval:offline
pnpm build
```

Database-dependent suites are skipped when their required database variables are missing.
A passing run without those variables does not validate the database integration paths.
Real PayPal Sandbox cases and screenshot checks have additional opt-in requirements; consult the runbooks before running payment tests.

### Disposable database integration tests

Use the optional test container, keeping both integration databases separate from application data.
Create `tranche_tests` once per new disposable container for the general suites; the guarded F0 runner uses the separate `tranche_p2_test` database.

```bash
docker compose --profile test up -d --wait postgres-test
docker compose exec postgres-test psql -U tranche -d postgres -c 'CREATE DATABASE tranche_tests;'
export DATABASE_URL='postgres://tranche:tranche@localhost:55432/tranche_tests'
export TEST_DATABASE_URL='postgres://tranche:tranche@localhost:55432/tranche_p2_test'
pnpm --filter @tranche/db db:migrate
pnpm --filter @tranche/db db:migrate:test
pnpm test
```

The container uses temporary storage that is lost when it stops.
The guarded runner migration rejects application database URLs, query strings, fragments, and databases without the expected fixture marker.
For an old disposable container without the marker, recreate only `postgres-test` with `docker compose --profile test up -d --wait --force-recreate postgres-test`.
Turbo forwards both database variables and executes tests without cached results.
Restore your application `DATABASE_URL` before restarting application services in that terminal.

CI also runs the fake approval route against its own disposable Docker container:

```bash
RUN_FAKE_APPROVAL_ROUTE_TEST=1 pnpm --filter @tranche/web exec vitest run src/server/fake-approval-route.test.ts
```

## Documentation and operator runbooks

The [design specification](docs/superpowers/specs/2026-10-08-tranche-design.md) explains the architecture.
The [remaining work](docs/remaining_work.md) document records implementation phases and outstanding gates; consult its dated checkpoints alongside current code and CI results.

F0 contributors: start with the [sandbox capability plan](docs/paypal/f0-plan.md), then read the [current handoff](docs/paypal/f0-status.md).
For implemented sandbox configuration and authentication commands, use the [P1 operator runbook](docs/paypal/p1-runbook.md).
For completed P1 work, verification results, remaining closeout items, and the next phase, read the [P1 closeout review](docs/paypal/p1-closeout.md).
For the requested accounts, browser approvals, USD test limits, and feature checks, use the [sandbox readiness implementation plan](docs/paypal/sandbox-readiness-implementation-plan.md).
For the durable runner, approval gates, and agreed test limits, use the [P2 runner implementation plan](docs/paypal/p2-sandbox-runner-implementation-plan.md).
For implemented runner commands and verification results, read the [P2 runbook](docs/paypal/p2-runbook.md) and [implementation record](docs/paypal/p2-implementation-record.md).
For P2 completion and its boundaries, read the [P2 closeout](docs/paypal/p2-closeout.md).
Implementation plans: [P3 seller onboarding](docs/paypal/p3-seller-onboarding-implementation-plan.md) and [P4 payment protection](docs/paypal/p4-payment-protection-implementation-plan.md).
For the implemented onboarding adapter, private consent flow and remaining real-test prerequisites, read the [P3 runbook](docs/paypal/p3-runbook.md) and [implementation record](docs/paypal/p3-implementation-record.md).
For P3 completion and the agreed P4-first offline implementation order, read the [P3 closeout](docs/paypal/p3-closeout.md).
For implemented authorization/capture commands, offline verification and the delayed-release blocker, read the [P4 runbook](docs/paypal/p4-runbook.md) and [implementation record](docs/paypal/p4-implementation-record.md).


## License

MIT
