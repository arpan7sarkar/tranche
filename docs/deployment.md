# Vercel application and VPS workers

The complete Next.js application runs on Vercel: UI, server rendering, authentication, API routes, and webhook intake.
PostgreSQL, durable background workers, scheduling, and the authenticated worker endpoint run on the VPS.
Render is no longer required.
The historical design spec describes the original hosting choice; this document records the user's replacement architecture.
The existing inbox, outbox, payment request IDs, approval policies, and stale-worker fencing remain authoritative.

## Architecture and limits

Vercel connects to VPS PostgreSQL over certificate-verified TLS.
Vercel submits best-effort wakeups to `https://WORKER_HOST/jobs` using a private bearer token.
The endpoint accepts only typed money-tick and negotiation wakeups and acknowledges after durable enqueue.
Missed wakeups recover through the stored domain events and scheduled workers.
The VPS uses [pg-boss](https://pgboss.io/introduction) in its own `tranche_jobs` PostgreSQL schema for durable jobs, retries, heartbeats, and cron schedules.
Delivery is at least once; task replay relies on existing domain idempotency and does not imply exactly-once provider calls.
The job queue does not replace the money outbox.
Run one worker service for this deployment; do not mix workers with different operating modes or code versions.
The scheduler requires a running worker; startup queues a current sweep to process overdue domain timers and pending events after downtime.
Failed jobs remain inspectable in the queue and must be monitored; retries are bounded to five.

Next.js event streams reconnect after 45 seconds with the last event ID.
Vercel uses periodic database catch-up instead of holding a permanent PostgreSQL LISTEN connection.
This respects [Vercel's finite function duration](https://vercel.com/docs/functions/runtimes); actual plan limits and connection capacity must be verified on the deployed project.
The default web pool is two connections per serverless instance, not a global two-connection limit.
Keep Vercel and the VPS geographically close and monitor aggregate connection use.

## Prepare the VPS

Use a Linux VPS with Docker Engine and Docker Compose, a DNS name for the worker, and a DNS name for PostgreSQL.
Install from the reviewed repository commit with Node 24 and the pinned pnpm version used in the image.
Start with sufficient memory for PostgreSQL and Chromium, then measure workload capacity; no VPS size has been load-tested by this change.
The checked-in files are under `deploy/vps/`.

1. Copy `deploy/vps/.env.example` to `deploy/vps/.env` and restrict access to the owner.
2. Generate separate random values for `POSTGRES_PASSWORD` and `WORKER_TOKEN`, for example with `openssl rand -hex 32`.
3. Use the hexadecimal password directly in the supplied connection URL; arbitrary passwords require URL encoding.
4. Set `WORKER_HOST` to the worker DNS hostname and `APP_URL` to the final Vercel HTTPS origin without a trailing slash.
5. Supply sandbox PayPal credentials and leave `WORKER_MODE=health`, `TRANCHE_LLM=off` initially.
6. Set optional model, GitHub, PageSpeed and email configuration only for the enabled capabilities.

Create a database TLS certificate whose subject alternative names include the external database hostname and the internal Compose name `postgres`.
For a private self-signed certificate trusted explicitly by Vercel and the worker, run on the VPS after replacing `db.example.com`:

```bash
mkdir -p deploy/vps/tls
chmod 700 deploy/vps/tls
openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 365 \
  -keyout deploy/vps/tls/server.key -out deploy/vps/tls/server.crt \
  -subj '/CN=db.example.com' \
  -addext 'subjectAltName=DNS:db.example.com,DNS:postgres'
chmod 600 deploy/vps/tls/server.key
chmod 644 deploy/vps/tls/server.crt
```

The PostgreSQL entrypoint copies the key with the correct owner and permissions.
Track certificate expiry and rotate the certificate and Vercel trust setting together.
Never upload `server.key` to Vercel or commit it.

The database binds only to VPS loopback by default.
Before setting `DB_BIND_ADDRESS=0.0.0.0`, configure provider-level ingress restrictions for the Vercel project's supported fixed-egress solution, or another reviewed private connectivity arrangement.
Do not assume Vercel's outbound IPs are fixed or that a basic host firewall covers Docker-published ports.
Confirm the actual Vercel networking option and plan before exposing the database.
PostgreSQL rejects non-TLS TCP connections and requires SCRAM authentication.
Caddy exposes the worker on HTTPS; only ports 80 and 443 should be publicly accessible without a source restriction.
The worker's port 8080 is not published to the host.

## Build, migrate, and start

Run from the repository root:

```bash
docker compose -f deploy/vps/compose.yaml build
docker compose -f deploy/vps/compose.yaml up -d --wait postgres
docker compose -f deploy/vps/compose.yaml --profile maintenance run --rm migrate
docker compose -f deploy/vps/compose.yaml up -d worker proxy
docker compose -f deploy/vps/compose.yaml ps
```

Compose automatically reads the `.env` beside its file.
Back up an existing database before migration.
The maintenance service runs application migrations once using verified TLS; web builds do not run migrations.
Worker startup initializes or migrates the separate pg-boss schema before accepting work.
Never run mixed queue-library versions against the same database during an upgrade.
Chromium and its OS dependencies are installed in the worker image.
The image runs the application as the non-root `node` user.
Do not add real credentials to Docker build arguments or the build context.

## Configure Vercel

Import the monorepo, select Next.js, and set the project root to `apps/web`.
Allow source files outside the root directory so workspace packages are included.
Use Node 24 and the committed `apps/web/vercel.json` installation/build commands.
Configure these as server environment variables unless their names begin with `NEXT_PUBLIC_`:

| Variable | Value |
| --- | --- |
| `TRANCHE_DEPLOYMENT` | `1` |
| `APP_URL`, `BETTER_AUTH_URL` | Same final Vercel HTTPS origin |
| `BETTER_AUTH_SECRET` | Stable random secret, at least 32 characters |
| `DATABASE_URL` | `postgres://tranche:PASSWORD@db.example.com:5432/tranche` |
| `DATABASE_SSL` | `verify-full` |
| `DATABASE_CA_CERT` | Contents of the public `server.crt`, including PEM boundaries |
| `DATABASE_POOL_MAX` | Start at `2`; size against total serverless concurrency |
| `WORKER_URL` | `https://worker.example.com` |
| `WORKER_TOKEN` | Same private token configured on the VPS |
| `PAYPAL_ENV` | `sandbox` |
| `PAYPAL_API_BASE` | `https://api-m.sandbox.paypal.com` |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Sandbox application credentials |
| `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | Matching sandbox client ID |
| `PAYPAL_WEBHOOK_ID` | Set after approved registration |
| `HOLD_MECHANISM` | `authorization` |
| `SUBCONTRACTOR_SPLIT` | `agency_pays` |
| `TRANCHE_LLM` | `off` until model credentials and usage are configured |

Verified TLS requires a DNS hostname; IP-literal connection URLs and SSL query parameters are rejected to prevent driver-specific verification bypasses.
Worker queue connections use the supplied certificate trust; changing production database TLS settings requires a new verification run.
Do not connect preview deployments to the shared payment database; disable previews or give each one isolated credentials, database, and worker.
Preserve the authentication secret and rebuild after any `NEXT_PUBLIC_*` change.
Configure partner IDs, GitHub application/webhook settings, and model keys on both services where their request handlers need them.
Email sender credentials belong on the worker.
The dashboard's public license and GitHub installation URL belong on Vercel.

## Smoke tests and activation

Load `SMOKE_URL`, `WORKER_URL`, and `WORKER_TOKEN` securely in an operator shell, then run:

```bash
export SMOKE_STAGE=bootstrap
pnpm --filter @tranche/e2e smoke
```

The smoke command reads web health and authenticated worker status, including durable completion timestamps of minute and hourly health jobs.
Wait for the first hourly health job before expecting the full check to pass.
Bootstrap does not require webhook registration; ready mode requires the worker webhook ID to be configured.
Neither stage validates a real provider delivery or payment.
After approved registration, set the returned webhook ID on Vercel and the VPS, redeploy, and run with `SMOKE_STAGE=ready`.
Inspect a real signed webhook separately during approved sandbox validation.

`WORKER_MODE=health` runs only diagnostics, rejects remote wakeups, and leaves pending domain jobs unprocessed by this worker.
After the sandbox run sheet is approved, set `WORKER_MODE=active` and recreate the worker service.
It then runs money ticks, event consumers, monitoring, notifications, and hourly reconciliation.
Schedules are persisted in PostgreSQL and repeated submissions are deduplicated while their matching job is queued or active.
Completed jobs do not permanently suppress later work with the same key; domain request IDs and receipts provide lasting idempotency.

Health mode does not stop synchronous web routes or already-running operations.
For an incident, stop the worker, stop new web writes, inspect outbox/provider state, and reconcile before resuming.
Do not reset dispatched rows, rotate payment request IDs, or replay arbitrary failed jobs blindly.

## Backups, monitoring, and release gates

Keep encrypted off-VPS backups of PostgreSQL and test restoration into an isolated server.
Backups must include the application and `tranche_jobs` schemas.
Never restore over newer payment records without reconciliation.
Monitor Compose health, failed/retrying jobs, stale schedules, outbox age, database connections, disk capacity, TLS expiry, and email review jobs.
Logs intentionally omit authentication tokens and raw queue failure payloads.
Do not expose the queue database or `/status` without authentication.
The status endpoint demonstrates scheduler health, not successful completion of every business task.

Vercel/VPS networking, remote builds, backup restoration, load capacity, dependency audit findings, actual PayPal behavior, and final accessibility review remain deployment/release gates until verified in the target environment.
See `remaining_work.md` and `paypal/phase-9-run-sheet.md` for the evidence still required.
