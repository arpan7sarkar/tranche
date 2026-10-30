# Agent Instructions

## Project
- Tranche: AI agents run milestone-protected payments for freelancers and agencies, settled on PayPal.
- Entry for the PayPal AI Hackathon, submissions close 2026-11-12 12:00 PT, feature freeze 2026-11-05.
- Design spec: `docs/superpowers/specs/2026-10-08-tranche-design.md`. Read it before changing architecture.
- PayPal sandbox only. Never use live credentials.

## Stack
- TypeScript everywhere, pnpm workspaces + Turborepo.
- `apps/web` Next.js App Router on Vercel, `apps/agents` PostgreSQL-backed workers on a VPS.
- `packages/{contracts,core,paypal,db,agents,verifiers}`.
- Postgres + Drizzle, Gemini via Vercel AI SDK (OpenAI only as fallback), Bryntum Gantt, AG Grid Studio.
- Hosting on Vercel (Next.js UI/API) and a VPS (workers, scheduling, Postgres); no Render dependency.

## Package Manager
Use **pnpm** (version pinned in root `package.json`): `pnpm install`, `pnpm dev`, `pnpm dev:agents`, `pnpm db:up`.

## File-Scoped Commands
| Task | Command |
|------|---------|
| Typecheck one package | `pnpm --filter @tranche/<pkg> typecheck` |
| Test one file | `pnpm --filter @tranche/<pkg> exec vitest run path/to/file.test.ts` |
| Lint and format one file | `pnpm biome check --write path/to/file.ts` |
| DB migration | `pnpm --filter @tranche/db db:generate` then `db:migrate` |

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

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
