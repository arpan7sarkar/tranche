# Tranche Implementation Plans

Spec: [`../specs/2026-10-08-tranche-design.md`](../specs/2026-10-08-tranche-design.md)

Two people build Tranche in two lanes.
Person H takes the hard money core plus most of the frontend and never waits on Person E.
Person E takes the agents, integrations and launch work, and waits on Person H only for the foundation (day 2) and the design system (about day 4).

## Plans

| Order | Plan | Owner | Work packages | Difficulty |
|---|---|---|---|---|
| 0 | [Foundation](2026-10-08-00-foundation.md) | H (E reviews contracts) | F0, F1 | M |
| - | [Integration contract](2026-10-08-01-integration-contract.md) | both | wins over any conflicting lane plan | - |
| H1 | [Core state machine and policy](2026-10-08-h1-core-state-machine-policy.md) | H | H1 | Hard |
| H2 | [PayPal money layer](2026-10-08-h2-paypal-money-layer.md) | H | H2 | Hard |
| H3 | [Inbox, outbox and actions](2026-10-08-h3-inbox-outbox-actions.md) | H | H3 | Hard |
| H4 | [Timers and rescheduling](2026-10-08-h4-timers-rescheduling.md) | H | H4 | Hard |
| H5 | [Frontend](2026-10-08-h5-frontend.md) | H | E1, E7, M2, M6, E2, E3 | M |
| E1 | [Agent runtime and planner](2026-10-08-e1-agent-runtime-planner.md) | E | M1, E5 | M |
| E2 | [Verifier and GitHub App](2026-10-08-e2-verifier-github.md) | E | H5, M4 | Hard |
| E3 | [Negotiator](2026-10-08-e3-negotiator.md) | E | H6, E6 | Hard |
| E4 | [Monitor, notifications, dashboard](2026-10-08-e4-monitor-notify-dashboard.md) | E | M5, E4, M3 | M |
| E5 | [Evals, deploy, end-to-end, launch](2026-10-08-e5-evals-deploy-e2e-launch.md) | E | M8, M7, E8, E9 | M |

## The lane boundary

```
Person E agents ──insert──► proposed_action ──read──► Person H policy engine ──► executor ──► PayPal
Person H state machine ──append──► event ──read via event_cursor──► Person E agents
Person E GitHub webhook ──insert──► inbox (delivery.detected) ──► Person H inbox processor
```

- Shapes that cross the boundary live in `packages/contracts` and change only through a PR reviewed by both people.
- Person E may import these pure functions from `@tranche/core`: `verificationGate`, `schedulePlan`, `withinMandate`.
- Person E builds screens with Person H's components in `apps/web/src/components/ui`.

### Path ownership

| Person H | Person E |
|---|---|
| `packages/core`, `packages/paypal` | `packages/agents`, `packages/verifiers` |
| `packages/db/src/schema/core.ts`, `schema/auth.ts` | `packages/db/src/schema/agents.ts` |
| `apps/agents/src/money/**` | `apps/agents/src/agents/**` |
| `apps/web/**` except Person E's routes | `apps/web/src/app/(agency)/deals/new/**` |
| | `apps/web/src/app/(agency)/deals/[dealId]/negotiation/**` |
| | `apps/web/src/app/(agency)/dashboard/**` |
| | `apps/web/src/app/api/{github,plans,negotiations,dashboard,health}/**` |
| | `e2e/**`, `docs/submission/**`, `render.yaml` |

`apps/agents/src/index.ts` imports both lanes' task modules; each person only adds their own import line.

## Schedule

| Week | Person H | Person E |
|---|---|---|
| 1 (Oct 9-15) | Foundation (F0 day 1, F1 by day 2), H1, start H5 design system (ready ~day 4) | Review contracts, E1 runtime and planner, start E2 GitHub App |
| 2 (Oct 16-22) | H2 PayPal money layer end to end in sandbox, H5 Gantt | E2 verifier, E4 notifications |
| 3 (Oct 23-29) | H3 inbox, outbox, actions, H4 timers | E3 negotiator, E4 monitor and dashboard |
| 4 (Oct 30-Nov 5) | H5 portal, checkout, live updates, polish | E5 evals and deploy, polish. **Feature freeze Nov 5** |
| 5 (Nov 6-12) | Hardening, bug fixes from end-to-end runs | E5 end-to-end suite, video, Devpost write-up. **Submit by Nov 11** |

## Not planned

- The dispute defender agent is a stretch goal; H2 and H3 already provide `submitDisputeEvidence` and the dispute webhook mapping, so it can be added after the feature freeze if time allows.

## Working rules

- One feature branch per task, small PRs, squash merge; CI must be green.
- Never generate Drizzle migrations on two branches at once: rebase on `main`, then generate.
- Contract changes need both people's review.
- Every plan task is test first: failing test, minimal code, passing test, commit.
- Execute plans with the subagent-driven-development or executing-plans skill, one task at a time.
