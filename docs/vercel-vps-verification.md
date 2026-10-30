# Vercel/VPS local verification

Date: 2026-10-30.
Scope: replace Render with the complete Next.js application on Vercel and PostgreSQL, durable jobs, scheduling, and workers on a VPS.
No Vercel project or remote VPS was accessed, and no real PayPal calls were made.

## Recorded checks

| Check | Result |
| --- | --- |
| `pnpm test` with disposable `DATABASE_URL` and `TEST_DATABASE_URL` | 1,154 passed; eight opt-in tests skipped |
| `pnpm --filter @tranche/db exec vitest run src/connection.test.ts` after TLS fix | Three additional tests passed |
| `pnpm typecheck` after TLS fix | Nine successful workspace tasks; four cached |
| `pnpm --filter @tranche/e2e test:e2e` | Ten passed against local fakes, with a production web build |
| `pnpm check` | Passed before the final verification record was added |
| `git diff --check` | Passed |
| `docker compose -f deploy/vps/compose.yaml config --no-env-resolution --no-interpolate --quiet` | Passed |
| `docker build -f deploy/vps/Dockerfile -t tranche-vps:local .` | Passed, including browser dependencies and worker build |
| Linux container Chromium with `--network none` | Non-root launch and screenshot passed |
| Production Compose configuration with isolated local overrides | TLS PostgreSQL initialized; application migrations and worker health passed |
| Authenticated worker endpoint | Healthy status, 401 without a token, 503 for submissions in health mode |
| Persisted scheduler observation | A minute health job completed and appeared in authenticated status |
| Application client over TLS | Trusted certificate accepted; mismatched hostname rejected |

The eight skipped tests are six real PayPal sandbox cases and two separately opt-in screenshot cases.
The container screenshot check above is a separate offline runtime check and does not turn those skipped tests into passes.
Queue tests cover concurrent duplicate submissions, queued-job persistence across restart, retry attempt fencing, and durable schedule removal when paused.
The TLS test initially reproduced a driver behavior that omitted hostname verification for IP addresses.
The application now requires a DNS hostname for verified TLS, pins the server name, and rejects SSL query parameters that could replace the configured trust settings.

The production migration service was adjusted after the container test revealed an unnecessary package-manager install attempt as the non-root user.
It now invokes the installed Node/tsx runner directly and successfully applies or rechecks migrations without installing packages at startup.
Image dependency installation and Chromium installation occur during the image build.

## Maintainer handoff

Follow [deployment.md](deployment.md) for environment variables, TLS certificates, firewall requirements, migration ordering, Vercel project settings, and worker activation.
The maintainer still supplies the VPS, Vercel project, public DNS, credentials, and the chosen Vercel-to-database connectivity arrangement.
Remote networking, Caddy's public certificate issuance, actual Vercel execution limits, hourly scheduling in the target environment, backup restoration, and load capacity remain unverified.
The local test used an isolated self-signed certificate trusted explicitly by the clients; it does not establish the eventual public deployment's identity.
Dependency audit review and the real PayPal run-sheet prerequisites remain open.
Do not mark Phase 9 complete from these local checks.
