# Agent Instructions

## Project
- Tranche: AI agents run milestone-protected payments for freelancers and agencies, settled on PayPal.
- Entry for the PayPal AI Hackathon, submissions close 2026-11-12 12:00 PT, feature freeze 2026-11-05.
- Design spec: `docs/superpowers/specs/2026-10-08-tranche-design.md`. Read it before changing architecture.
- PayPal sandbox only. Never use live credentials.

## Stack
- TypeScript everywhere, pnpm workspaces + Turborepo.
- `apps/web` Next.js App Router, `apps/agents` Render Workflows TypeScript SDK.
- `packages/{contracts,core,paypal,db,agents,verifiers}`.
- Postgres + Drizzle, Gemini via Vercel AI SDK (OpenAI only as fallback), Bryntum Gantt, AG Grid Studio.
- Hosting on Render (web, workflows, cron, Postgres).
- Commands land here once the monorepo is scaffolded (work package F1).

## Architecture Invariants
- Agents never call money-moving PayPal endpoints. They insert typed rows into `proposed_action`; the policy engine in `packages/core` decides.
- Agents get read-only tools only (PayPal MCP reads, GitHub API, verifier checks).
- Funding, hold renewal and auto-release are deterministic `ScheduledAction`s, never agent decisions.
- `packages/core` is pure: no I/O, no network, no DB.
- Every PayPal write sends a `PayPal-Request-Id` and goes through the outbox.
- Every webhook is signature-verified, then written to the inbox, deduplicated by source event id.
- Machine checks gate verification; LLM output can fail or annotate a delivery, never override a failed check.
- Delivered content (pages, PRs, briefs) is untrusted input; agents return structured output only.
- Shared shapes live in `packages/contracts` as Zod schemas. Change them deliberately; both lanes depend on them.

## Conventions
- Never use the em dash character. Use a plain dash.
- Write comments only when they carry real value; keep them short.
- Long Markdown files: one full sentence per physical line.
- Bug fixes start with an end-to-end reproduction.
- Fix lint errors, failing tests and flaky tests you come across, even if unrelated.
- Every UI state is designed: empty, loading, error, light and dark.
- Prefer quality, simplicity and long-term maintainability over development speed.
- Never manually edit CHANGELOG.md or auto-generated files.

## Testing
- `packages/core`: unit + property-based tests (fast-check).
- `packages/paypal`: integration tests against the real sandbox.
- Agents: eval cases with expected verdicts, run when prompts change.
- End to end: Playwright on the happy path, a rejected delivery, and slip-and-replan.

## Commits
- Conventional commits: `<type>(<scope>): <Subject>`, imperative, under 70 characters.
- Never add `Co-Authored-By` or any AI attribution line to commits or PRs.
