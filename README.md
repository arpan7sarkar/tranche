# Tranche

Milestone-protected payments for freelancers and agencies, run by an AI agent, settled on PayPal.
Built for the PayPal AI Hackathon.

Design: [`docs/superpowers/specs/2026-10-08-tranche-design.md`](docs/superpowers/specs/2026-10-08-tranche-design.md)

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

## Layout

| Path | Purpose |
|---|---|
| `apps/web` | Next.js app: agency UI, client portal, API routes, webhooks |
| `apps/agents` | Render Workflows tasks: agents and executor |
| `packages/contracts` | Shared Zod schemas |
| `packages/core` | State machine and policy engine (pure) |
| `packages/db` | Drizzle schema and client |
| `packages/paypal` | PayPal client |
| `packages/agents` | Prompts, tools, model routing |
| `packages/verifiers` | GitHub, PageSpeed and screenshot checks |

## Setup

Requires Node 22.12+, pnpm (the version in `package.json` is fetched automatically) and Docker.
The environment-file copy below runs only when .env does not already exist.
If you already have .env, preserve its credentials and add only missing entries from .env.example privately.

```bash
pnpm install
if [ ! -e .env ]; then cp .env.example .env; fi
pnpm db:up
pnpm dev
```

Running the agents service locally needs the [Render CLI](https://render.com/docs/cli): `pnpm dev:agents`.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Start the web app |
| `pnpm dev:agents` | Start the local Render Workflows task server |
| `pnpm typecheck` | Typecheck every package |
| `pnpm test` | Run every test suite |
| `pnpm build` | Build web and agents |
| `pnpm check` / `pnpm fix` | Lint and format with Biome |

## License

MIT
