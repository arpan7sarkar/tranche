# Tranche - Design Spec

Date: 2026-10-08
Status: Draft, awaiting review
Hosting update, 2026-10-30: the user selected Vercel for the complete Next.js application and a VPS for PostgreSQL, workers, and scheduling.
The Render architecture below is historical; the implemented replacement and operational constraints are documented in `docs/deployment.md` from the repository root.
Event: PayPal AI Hackathon (paypalaihackathon.devpost.com), submissions close 2026-11-12 12:00 PT.

## 1. Summary

Tranche gives freelancers and small agencies Upwork-style payment protection for any client relationship.
An AI agent on the agency side scopes the work, prices milestones, holds the client's funds through PayPal, watches for delivery, verifies it, and releases payment.
When the client also runs an agent, the two agents negotiate and settle the deal themselves.

One-line pitch: Upwork-style payment protection for any client relationship, run by an AI agent, settled on PayPal.

## 2. Goals and success criteria

- Win 1st place or "Best Use of Agentic Commerce", and qualify for the AG Grid, Bryntum, Render and APIMatic sponsor prizes.
- Agents take real actions with money, gated by deterministic policy, never by the LLM alone.
- A judge can open the hosted demo, run the full happy path in the PayPal sandbox, and understand it within the 3 minute video.
- Every PayPal money call is idempotent, every webhook is processed exactly once, and our ledger reconciles with PayPal.

## 3. Non-goals

- Real (live) money. PayPal sandbox only.
- Verifying subjective deliverables (logos, copywriting). V1 verifies code and websites only.
- Acting as an escrow or money transmitter. PayPal holds funds; Tranche is a platform that takes a fee.
- Mobile apps, multi-language UI, microservices, message brokers.

## 4. Users

- **Agency / freelancer** (primary): cross-border web and app freelancers and small agencies who find clients directly.
- **Client**: a human who reviews the plan, pays with PayPal and releases milestones, or sets an auto-release rule.
- **Client agent** (vision, built in week 4): negotiates on the client's behalf within the client's mandate.

## 5. Core flows

1. **Brief to plan**: the agency pastes a brief; the Planner agent produces tasks, dependencies, durations, priced milestones and acceptance criteria; the agency edits it on the Gantt and sends it.
2. **Agree and fund**: the client reviews the plan in a magic-link portal and pays with PayPal, which also vaults the payment method.
3. **Just-in-time holds**: each milestone is funded from the vaulted method a few days before its first Gantt task starts.
4. **Deliver and verify**: a merged PR, a finished CI run or a submitted URL triggers the Verifier, which runs machine checks first and AI judgment second, and records evidence.
5. **Release**: the client releases, or the auto-release timer fires after a passing verification and a quiet period; funds go to the agency and subcontractors.
6. **Slip and re-plan**: moving a task on the Gantt shifts dependent milestones and reschedules their funding, renewal and auto-release timers.
7. **Negotiate** (week 4): client agent and agency agent exchange structured offers until agreement or escalation.
8. **Dispute** (stretch): the Dispute defender assembles evidence and submits it after human approval.

## 6. Architecture

```
                        ┌──────────────────────── Render ───────────────────────────┐
 Agency ───────────────►│ apps/web  (Next.js App Router)                             │
 Client (magic link) ──►│  • Agency app: Bryntum Gantt, AG Grid Studio, approvals    │
                        │  • Client portal: plan review, PayPal checkout, release    │
 PayPal webhooks ──────►│  • API routes: webhooks → inbox, SSE live updates          │
 GitHub App webhooks ──►│                                                            │
                        │ apps/agents  (Render Workflows, TypeScript SDK)            │
                        │  • planner · verifier · monitor · negotiator · dispute     │
                        │  • Gemini via Vercel AI SDK (OpenAI as fallback)           │
                        │                                                            │
                        │ cron (every minute) → due ScheduledActions                 │
                        │ cron (hourly)       → reconciliation with PayPal           │
                        │                                                            │
                        │ Postgres  ◄── single source of truth                       │
                        └────────────────────────────────────────────────────────────┘
```

Monorepo with pnpm and Turborepo, TypeScript end to end.

| Package | Responsibility |
|---|---|
| `apps/web` | Next.js UI and API routes (webhook intake, client portal, SSE). |
| `apps/agents` | Render Workflows tasks that run agents and the executor. |
| `packages/core` | Milestone state machine, action types, policy engine. Pure, no I/O. |
| `packages/paypal` | Typed PayPal REST client, webhook signature verification, idempotency keys. |
| `packages/db` | Drizzle schema and migrations, inbox, outbox, event log. |
| `packages/agents` | Prompts, Zod output schemas, read-only tools, model routing. |
| `packages/verifiers` | GitHub checks, PageSpeed Insights, Playwright screenshots, criteria comparison. |
| `packages/contracts` | Shared Zod schemas and API types used by every other package. |

Event loop for every change:

1. A webhook, timer or user action is written to the `inbox` (deduplicated by source event id).
2. The state machine applies it and emits domain events to the `event` log.
3. An agent task is started when the new state needs a decision.
4. The agent returns a typed `ProposedAction`.
5. The policy engine approves it, or creates an `Approval` for a human.
6. The executor writes the action to the `outbox` and performs the PayPal call with a `PayPal-Request-Id`.
7. The confirming PayPal webhook advances the state machine; SSE pushes the change to open screens.

## 7. Domain model

| Entity | Key fields |
|---|---|
| `Workspace` | name, PayPal merchant id, onboarding status, rate card, members |
| `Client` | name, email, magic-link token hash, PayPal vault id |
| `Deal` | workspace, client, currency, total, status, agency policy, client policy |
| `Milestone` | deal, title, price, acceptance criteria (machine checks + prose), payee splits, state, computed start/end |
| `Task`, `Dependency` | Gantt data; milestone dates derive from tasks |
| `Policy` | per-action max, per-milestone max, per-deal max, auto-release window, cooldown, approval channel |
| `ProposedAction` | agent, type, payload, reasoning, evidence refs, status |
| `Approval` | proposed action, approver, decision, decided at |
| `Hold` | milestone, mechanism (delayed disbursement or authorization), PayPal ids, amount, expires at, status |
| `Evidence` | milestone, kind (ci, tests, lighthouse, screenshot, diff, ai_verdict), payload, created at |
| `Event` | append-only audit log of every state change and action |
| `ScheduledAction` | kind (fund, renew, auto_release, remind), due at, milestone, status |
| `Inbox`, `Outbox` | exactly-once intake and crash-safe external calls |

## 8. Milestone state machine

```
draft → agreed → funding → held → in_progress → delivered → verifying
                                       ▲                         │
                                       └──── changes_requested ◄─┤ fail
                                                                 ▼ pass
                      released ◄── release_pending (client approves / auto-release timer)
                          │
                          └→ paid_out
   side exits from any held state: disputed · refunded · cancelled
```

Invariants enforced in `core` and covered by property-based tests:

- No transition to `released` unless the latest verification passed every machine check.
- No transition to `released` without either a client approval or an elapsed auto-release window.
- Released amount never exceeds held amount.
- A `held` milestone always has a live hold whose expiry is in the future, or a scheduled renewal before expiry.

## 9. Money flow

Tranche is a PayPal platform (multiparty).

1. **Connect**: the agency onboards through Partner Referrals; funds settle to the agency, and Tranche takes `platform_fees`.
2. **Agree**: the client approves the plan through PayPal JS SDK v6 checkout with vaulting, so later milestones can be funded without a new checkout.
3. **Just-in-time holds**: holds are created a configurable number of days before the milestone's first task, keeping every hold inside PayPal's limits.
4. **Release**: funds go to the agency; subcontractors are paid as additional payees if multiple purchase units are supported for our app, otherwise through the Payouts API.

Hold mechanism, chosen by the F0 sandbox check:

- **Preferred, delayed disbursement**: order created with `disbursement_mode: DELAYED`, captured on funding, released with `/v1/payments/referenced-payouts-items`; PayPal auto-disburses after 28 days, so release or renewal must happen earlier.
- **Fallback, authorize and capture**: order intent `AUTHORIZE`; authorization valid 29 days with a 3 day honor period; reauthorize between day 4 and day 29; after day 29 create a new authorization from the vault; release is a capture against the newest authorization id.

The state machine only depends on `Hold.status` and `Hold.expiresAt`, so the choice does not change any other component.

F0 must answer, against the real sandbox:

- Can our app onboard sandbox sellers through Partner Referrals?
- Is `DELAYED` disbursement enabled, or does it return `DELAYED_DISBURSEMENT_NOT_SUPPORTED`?
- Are multiple purchase units with different payees accepted?
- Are Payouts enabled for the sandbox business account?

## 10. Agents

All agents follow one contract: trigger → context (deal state plus read-only tools) → Zod-typed `ProposedAction` → policy engine.
No agent holds credentials that can move money.
Money-critical timers (just-in-time funding, hold renewal, auto-release) are deterministic `ScheduledAction`s executed by code, never by an agent, so they work even when every model is down.
Agents and the money layer meet only through the `proposed_action` table: agents insert typed rows, the policy engine consumes them.

| Agent | Trigger | Proposes | Model |
|---|---|---|---|
| Planner | brief submitted | `create_plan` | Gemini Pro |
| Verifier | PR merged, CI completed, URL submitted | `mark_verified`, `request_changes` | Gemini Pro |
| Monitor | timers, state changes | `send_reminder`, `reschedule` (suggestion), `flag_risk` | Gemini Flash |
| Negotiator | client enables agent mode | `counter_offer`, `accept_plan`, `escalate` | Gemini Pro |
| Dispute defender (stretch) | dispute webhook | `submit_dispute_evidence` (always needs approval) | Gemini Pro |

Read-only tools: PayPal MCP server for transactions, invoices and disputes; GitHub API; verifier checks.
AG Grid Studio Agent Framework powers natural-language questions on the dashboard, separate from Tranche agents.

### Guardrails

- **Checks before AI judgment**: machine checks gate verification; the LLM can only fail or annotate, never override a failed check.
- **Prompt injection**: delivered pages, PR text and briefs are untrusted data, wrapped and labelled as such; agents emit structured output only; policy limits apply regardless of the verdict.
- **Policy limits**: per-action, per-milestone and per-deal maximums plus cooldowns, enforced in `core`.
- **Negotiation bounds**: offers outside either mandate are rejected by code; a round limit forces escalation.
- **Explainability**: every proposal stores reasoning and evidence links, shown in the audit grid and the client portal.
- **Cost**: Flash for high-volume work, Pro for judgment, results cached per evidence hash.

## 11. Screens

1. **Agency dashboard** (AG Grid Studio): held, released, overdue and forecast widgets; deals grid; agent audit grid; "ask your cash flow".
2. **Deal workspace** (Bryntum Gantt): tasks, milestone diamonds with price and hold status, agent activity panel, approval cards.
3. **Brief to plan**: paste a brief, watch the Gantt fill live, edit, send.
4. **Client portal**: plan review, PayPal checkout, per-milestone evidence, release button, auto-release rule.
5. **Negotiation room**: live transcript of both agents with the Gantt updating as terms change.
6. **Onboarding**: Connect PayPal, Connect GitHub.

Every screen ships designed empty, loading and error states, in light and dark themes.

## 12. Reliability and security

- Webhook signatures verified (PayPal verify-webhook-signature, GitHub HMAC) before writing to the inbox.
- Inbox rows are unique by source event id; processing is idempotent and replayable.
- Outbox rows carry the `PayPal-Request-Id`; the executor retries until a terminal result.
- Hourly reconciliation compares holds, captures and payouts with PayPal and raises an alert on drift.
- Agent tasks retry through Render Workflows; when the model provider is down, proposals queue rather than drop.
- A failed hold renewal alerts both sides and offers a manual fallback.
- Magic links are single-purpose, hashed at rest and expire.
- Secrets live in Render environment groups, never in the repo.

## 13. Testing

- `core`: unit and property-based tests (fast-check) for transitions and policy.
- `paypal`: integration tests against the real sandbox.
- Agent evals: 15 to 20 fixed cases (good deliveries, bad deliveries, prompt-injection attempts, negotiation edge cases) with expected verdicts, run in CI when prompts change.
- End to end (Playwright): happy path, rejected delivery, slip and re-plan.

## 14. Sponsor map

| Sponsor | Use |
|---|---|
| PayPal | Partner Referrals, Orders v2, Vault v3, holds, referenced payouts or captures, Payouts, Invoicing, Disputes, Webhooks, JS SDK v6, AI Toolkit MCP server |
| Bryntum | Gantt as the deal workspace; agent-driven rescheduling |
| AG Grid | Studio dashboard, audit grid, Studio Agent Framework |
| Render | Web service, Workflows for agents, cron jobs, Postgres |
| APIMatic | PayPal Context Plugin used during development, documented in the README |

## 15. Work packages

Difficulty: H hard, M medium, E easy.

| ID | Work | Difficulty | Depends on |
|---|---|---|---|
| F0 | Sandbox capability check | M (high uncertainty) | none |
| F1 | Monorepo, `contracts`, DB schema, seed data | M | none |
| H1 | `core` state machine and policy engine | H | F1 |
| H2 | PayPal money layer | H | F0, F1 |
| H3 | Inbox, outbox, exactly-once, reconciliation | H | F1, H1 |
| H4 | Gantt-driven timers and rescheduling | H | H1, H2 |
| H5 | Verifier agent | H | F1 |
| H6 | Negotiator agents | H | F1, M1 |
| M1 | Planner agent | M | F1 |
| M2 | Bryntum Gantt deal workspace | M | F1 |
| M3 | AG Grid Studio dashboard and agent | M | F1 |
| M4 | GitHub App | M | F1 |
| M5 | Monitor agent (reminders, re-plan suggestions, risk flags) | M | F1 |
| M6 | Live updates (SSE, LISTEN/NOTIFY) | M | F1 |
| M7 | Render deployment and seeded demo | M | late |
| M8 | Agent eval harness | M | M1, H5 |
| E1 | Design system, app shell, agency auth | E | none |
| E2 | Client portal UI | E | F1 |
| E3 | PayPal JS SDK v6 checkout | E | F1 |
| E4 | Notifications | E | F1 |
| E5 | Brief-to-plan screen | E | F1 |
| E6 | Negotiation room UI | E | F1 |
| E7 | Onboarding screens | E | E1 |
| E8 | Playwright end-to-end suite | E | late |
| E9 | README, Devpost write-up, video script, sponsor notes | E | anytime |

Owner assignment lives in the implementation plan.

## 16. Schedule

- Week 1 (Oct 9 to 15): F0, F1, start of every independent track.
- Week 2 (Oct 16 to 22): money layer end to end in sandbox.
- Week 3 (Oct 23 to 29): verifier, monitor, timers, dashboard.
- Week 4 (Oct 30 to Nov 5): negotiator, reconciliation, evals, polish. Feature freeze Nov 5.
- Week 5 (Nov 6 to 12): hardening, deploy, video, write-up. Submit by Nov 11.

## 17. Risks

| Risk | Mitigation |
|---|---|
| Delayed disbursement or Partner Referrals unavailable in sandbox | F0 on day 1; authorize-and-capture fallback needs no special access |
| "Freelancer payments" theme is crowded | Lead the video with Gantt-driven money and agent verification |
| AI verifier releases money wrongly | Machine checks gate release; client approval or auto-release window; evals in CI |
| Negotiation looks scripted | Run it live, grounded in real rate cards and budgets |
| Model cost | Gemini Flash for volume, caching, OpenAI only as fallback |
| Bryntum and AG Grid trial licenses expire (45 days) | Start trials no earlier than needed; both cover the hackathon window |
| Scope | Freeze Nov 5; Dispute defender is stretch only |
