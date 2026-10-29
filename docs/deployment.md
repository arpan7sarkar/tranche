# Render deployment preparation

The repository is prepared for a later sandbox deployment; no Render resources or public URL have been created by this work.
Use `render.yaml` from the repository root and the pinned pnpm version with Node 24 from `.node-version`.
The Blueprint provisions paid web, workflow, cron, and PostgreSQL services; review Render's cost estimate before applying it.
Its fields follow the [Render Blueprint reference](https://render.com/docs/blueprint-spec).
Remote provisioning, browser installation, and service capacity still require validation on Render.

## Initial setup

1. Create a Blueprint from the reviewed branch and inspect the service names and selected region.
2. Set `APP_URL` on web and workflow to the eventual public HTTPS origin, without a trailing slash, and set web `BETTER_AUTH_URL` to that exact origin.
3. Supply sandbox `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` on web and workflow, and the matching public client ID on web.
4. Supply `RENDER_API_KEY` on web and both cron services; the Blueprint references the workflow service's slug automatically.
5. Retain the generated web `BETTER_AUTH_SECRET` across redeployments.
6. Deploy web, which runs database migrations before starting, then deploy the workflow and cron services.
7. Rebuild web after changing any `NEXT_PUBLIC_*` variable, because these values enter the browser bundle at build time.

If the public URL is not known at Blueprint creation, allow initial validation to fail, copy the assigned web URL, set the origins, and redeploy.
Do not use placeholder credentials to claim a successful deployment.
The database reference uses Render's internal connection string and has no external IP allowlist entries.
Only web owns migrations; do not run parallel migration releases.
Keep all services on the same reviewed commit and check migration compatibility before changing the workflow version.
The workflow build installs Chromium and its OS dependencies for screenshot verification.

The defaults are `PAYPAL_ENV=sandbox`, `HOLD_MECHANISM=authorization`, `SUBCONTRACTOR_SPLIT=agency_pays`, and `TRANCHE_LLM=off`.
Never copy local test URLs or fake-provider flags into deployed services.
Web startup and workflow startup reject invalid deployment settings when `TRANCHE_DEPLOYMENT=1`.
The standalone validation command reads the current process environment and does not contact providers:

```bash
pnpm --filter @tranche/agents-service deploy:check web
pnpm --filter @tranche/agents-service deploy:check workflow
```

## Optional capabilities

Configure these manually after initial provisioning, on the services that use them.

| Capability | Configuration |
| --- | --- |
| Verified PayPal webhooks | Set the registered `PAYPAL_WEBHOOK_ID` on web and workflow |
| Partner features | Set the assigned `PAYPAL_PARTNER_MERCHANT_ID` and `PAYPAL_PARTNER_ATTRIBUTION_ID` on web and workflow when applicable |
| Agent generation | Set `GOOGLE_GENERATIVE_AI_API_KEY` on workflow and web, then enable `TRANCHE_LLM`; alternatively select `AI_FALLBACK=openai` with `OPENAI_API_KEY` |
| GitHub delivery | Configure `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, and `GITHUB_WORKSPACE_REPOSITORIES` on web and workflow; set `NEXT_PUBLIC_GITHUB_APP_INSTALL_URL` on web |
| PageSpeed checks | Set `PAGESPEED_API_KEY` on workflow |
| Email | Set both `RESEND_API_KEY` and verified `EMAIL_FROM` on workflow |
| Dashboard licensing | Set `NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY` on web according to your license |

Missing model credentials with models enabled fail startup validation.
With models off, model-dependent proposals remain pending while deterministic payment tasks can continue.
Without email configuration, notifications stay queued.
Trial UI packages and provider entitlements require operator review before public release.

## Infrastructure smoke test

Both cron services initially use `TRANCHE_CRON_MODE=health`.
They launch only the read-only `deploymentHealth` workflow, with minute/hour idempotency keys.
Wait for one scheduled hourly reconciliation run and a recent minute tick before checking cron history.
Manual workflow execution alone does not demonstrate scheduled cron delivery.

```bash
export SMOKE_URL='https://YOUR-APP.onrender.com'
export RENDER_WORKFLOW_SLUG='YOUR-WORKFLOW-SLUG'
# Load RENDER_API_KEY securely into this shell; do not commit it.
export SMOKE_STAGE=bootstrap
pnpm --filter @tranche/e2e smoke
```

This checks web-to-DB access, workflow schema visibility, recent cron health observations, and the presence of the PayPal route.
It starts a diagnostic workflow but does not make PayPal requests.
The webhook route check uses GET and expects 405; it does not prove signature verification or provider delivery.
After approved webhook registration and setting its ID on web and workflow, repeat with `SMOKE_STAGE=ready`.
The ready stage checks configuration presence, not whether the provider ID is correct.
Keep the redacted JSON output with the release commit and timestamp.

## Activating and stopping processing

After the [sandbox run sheet](paypal/phase-9-run-sheet.md) has concrete identities and operator approval, change both cron services to `TRANCHE_CRON_MODE=active` and redeploy them.
The minute job dispatches the existing money and agent schedules independently; the hourly job dispatches reconciliation.
A model task launch failure does not prevent the money task launch attempt.
Cron success proves submission, not successful workflow completion; inspect task outcomes and outbox state as well.
Health mode does not disable web requests, webhook-triggered processing, or workflows already queued.
Changing cron mode to `disabled` stops only future cron submissions.
For an incident, suspend cron, stop new user writes, and inspect outstanding workflows and outbox operations before resuming.
Never reset dispatched operations or regenerate request IDs to recover an ambiguous payment.
Use read-back and the existing recovery commands in the sandbox run sheet.

## Release verification and rollback

Run local typechecks, tests, Biome, production builds, and the fake-provider Playwright suite before deploying.
Run `pnpm audit --prod` and triage its findings; local test success does not establish dependency security.
This preparation upgrades Next.js to 16.4.1, but the dependency audit has additional findings that remain a release review item.
Take a database backup before migration and verify restoration procedures for the selected Render plan.
Code rollback is safe only if the previous code supports the migrated schema; otherwise use a forward fix.
Do not automatically reverse migrations or restore a snapshot over newer payment records.
Remote smoke tests, actual provider evidence, accessibility review, and final submission assets remain separate release gates in `remaining_work.md`.
