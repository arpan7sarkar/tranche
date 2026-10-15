# Tranche lane E handoff

Oct 15, 2026 · @Rex Jafor

## Where main stands

Lane H (money core plus frontend) is merged on main; lane E (agents, verifier, negotiator, notifications, deploy) has not started, so it is now the critical path to the Nov 5 feature freeze.

`packages/agents/src` and `packages/verifiers/src` hold only an empty `index.ts`, and `apps/agents/src/agents/` does not exist yet.

| Lane H piece | What you get | Where |
| --- | --- | --- |
| Policy engine and state machine (H1) | `verificationGate`, `schedulePlan`, `withinMandate`, `evaluatePolicy` | `@tranche/core` |
| PayPal money layer (H2) | One fetch client, holds, payouts, webhooks, `readOnlyPayPalTools()` for agents | `@tranche/paypal`, `@tranche/paypal/agent-tools` |
| Inbox, outbox, actions (H3) | Agents insert `proposed_action` rows; the policy engine decides; `agreeToPlan`, `decideApproval`, `submitHumanAction` | `@tranche/agents-service/money` |
| Timers and rescheduling (H4) | Just-in-time funding, hold renewal, `applyReschedule` | `@tranche/agents-service/money` |
| Frontend (H5) | Design system, auth, deal workspace with Gantt, approvals, client portal, funding button, manual delivery | `apps/web` |
| Tick wiring | `MONEY_TICK_TASKS`, `RECONCILE_TASK`, `MONEY_HANDLERS` for your `cron-tick.ts` | `apps/agents/src/money/` |

Your plans, in build order: [E1 agent runtime and planner](https://github.com/arpan7sarkar/tranche/blob/main/docs/superpowers/plans/2026-10-08-e1-agent-runtime-planner.md), [E2 verifier and GitHub App](https://github.com/arpan7sarkar/tranche/blob/main/docs/superpowers/plans/2026-10-08-e2-verifier-github.md), [E3 negotiator](https://github.com/arpan7sarkar/tranche/blob/main/docs/superpowers/plans/2026-10-08-e3-negotiator.md), [E4 monitor, notifications, dashboard](https://github.com/arpan7sarkar/tranche/blob/main/docs/superpowers/plans/2026-10-08-e4-monitor-notify-dashboard.md), [E5 evals, deploy, end to end](https://github.com/arpan7sarkar/tranche/blob/main/docs/superpowers/plans/2026-10-08-e5-evals-deploy-e2e-launch.md).

Read the [integration contract](https://github.com/arpan7sarkar/tranche/blob/main/docs/superpowers/plans/2026-10-08-01-integration-contract.md) first: it wins over any lane plan, and sections 4, 8 and 9 changed this week.

## Must do before the demo works end to end

These six are small, but the end-to-end journeys fail without them; fold them into E2 and E5 as you build.

- [ ] **Verifier judges the right delivery (E2 Task 7).** `latestDelivery` must read `deliveryId` from the `milestone.verification_requested` event and load that exact `delivery.detected` inbox row, never the newest row for the milestone. A GitHub merge and a manual submit can both land for one milestone; only the one that applied is under review. Contract section 9.
- [ ] **Agency notes stay untrusted (E2).** Manual deliveries can carry `notes` (max 2000 characters). Read them from the same delivery row, pass them only through `untrusted("agency notes", notes, 2000)`, never into a system prompt, and never let them satisfy a criterion on their own. A delivery with `repo: null` fails `pr_merged` and `ci_green`; it never skips them.
- [ ] **Localhost allowlist for end to end (E2 + E5).** E2's SSRF guard rejects localhost, so E5's staging site at `http://localhost:4020` can never pass `url_live`. Add a test-only allowlist (env-gated, off in production) rather than loosening the guard.
- [ ] **Fix the slip journey seed (E5 Task 8 Step 7).** The seed leaves the `slip` deal in `draft` with null milestone dates, so there is no funding timer to move and `not.toHaveText(fundBefore)` can never pass. Section 9 gives the exact seed steps and the expected strings: before the move "D(7) - D(17)" and "Due D(4)", after it "D(14) - D(24)" and "Due D(11)".
- [ ] **Seed calls the new `agreeToPlan` signature.** It now takes the plan version: `agreeToPlan(db, dealId, planVersion(deal.currency, milestones))`, with `planVersion` from `@tranche/core`, and returns `"agreed"`, `"plan_changed"`, `"already_agreed"` or `"not_agreeable"`. Assert `"agreed"`.
- [ ] **Use the UI hooks that exist.** The manual delivery dialog adds `delivery-notes-input`, `delivery-pending-<key>`, `delivery-failed-<key>`, `resubmit-delivery-<key>` and `delivery-via-pr-<key>`; the rest of the E5 Task 8 hooks are implemented as listed.

## PayPal sandbox run

Nothing in H2 has run against the real sandbox yet; your credentials can confirm it in one session, and every item below is a guess until then.

1. Run `RUN_PAYPAL_SANDBOX_TEST=1 pnpm --filter @tranche/paypal test:sandbox` with the sandbox credentials in `.env` (amounts are $1.00).
2. Do one real agency onboarding through `/onboarding` and the Connect PayPal button.
3. Register the webhook with `packages/paypal/scripts/register-webhook.ts`, then fund one milestone with `scripts/fund-manually.ts` or the portal.

| Check | Why it matters | Where |
| --- | --- | --- |
| Granted-permission scope URLs match what PayPal returns | A wrong URL leaves every agency stuck at pending after onboarding | `FEATURE_SCOPES` in `packages/paypal` |
| Auth assertion header encoding | We kept your proven standard base64; confirm seller-side reauthorize, capture, void and refund calls accept it | `packages/paypal/src/http.ts`, `docs/paypal/auth-assertion-encoding.md` |
| Platform fee placement | Fee is on the order for delayed disbursement and on the capture for authorization; a double fee is the failure mode | `client.ts` `createFundingOrder`, `releaseHold` |
| Referral features by hold mechanism | With `HOLD_MECHANISM=authorization` we no longer request `DELAY_FUNDS_DISBURSEMENT`; confirm consent works for your seller | `createSellerReferral` |
| "Already done" error names | `AUTHORIZATION_ALREADY_VOIDED` and `CAPTURE_FULLY_REFUNDED` are guesses; a wrong name only means a retry instead of a read-back | `apps/agents/src/money/outbox-handlers.ts` |
| Refund webhook field | `seller_payable_breakdown.total_refunded_amount` drives cumulative refunds | `apps/agents/src/money/paypal-events.ts` |

Write what you see into `docs/paypal/` and tell Arpan which rows were wrong.

## Your F0 follow-ups and the P7 decision

The six follow-ups from [PR #7](https://github.com/arpan7sarkar/tranche/pull/7) are still open; take them in one PR, then write P7 so the money path is on record.

- [ ] A failure before the write is dispatched (OAuth, status read, readiness check) leaves the stage stuck with no retry or re-approval; at capture it leaves an open authorization with no void path. Same root cause as the `claim()`/`markDispatch()` follow-up from #6.
- [ ] A lost create-order response never stores the order id, so recovery cannot find it and the $1 plus its held calls stay locked.
- [ ] `docker-compose.yml` maps Postgres to 5433, but `.env.example` and the docs still say 5432.
- [ ] `turbo.json` does not pass `TEST_DATABASE_URL`, so `pnpm test` always skips the runner integration suite.
- [ ] A crash during `apply-referral-recovery` leaves the operation in `recovering` until its deadline.
- [ ] Nit: the call-budget rules (`paymentStageCalls`, `paymentTotalCalls`, `paymentApproval`) belong in `packages/core`, not `packages/contracts`.
- [ ] **P7, payment-path decision** (`docs/paypal/f0-plan.md`). Lane H already runs on `HOLD_MECHANISM=authorization` (delayed disbursement is disabled for the sandbox seller per your P4 runbook) and `SUBCONTRACTOR_SPLIT=agency_pays` (the only mode the agents service accepts; see `docs/paypal/subcontractor-split.md`). P5 multi-payee and P6 Payouts are not needed for that path, so record them as deferred and write P7 confirming it.

## Contract changes that touch your code

Lane H changed a few shared shapes while building; each one below differs from what your plans say, so build against the contract, not the plan text.

| Change | Affects | Contract |
| --- | --- | --- |
| `agreeToPlan(db, dealId, expectedPlanVersion)` returns `"agreed" \| "plan_changed" \| "already_agreed" \| "not_agreeable"` | E3 negotiator accept path, E5 seeds | Section 4 |
| `defaultClientPolicy()` takes no argument and always asks before a release | E3 client-side agent proposals | Section 8 |
| A release proposed by anyone but the client side waits for client approval | E3, any agent proposing `release` | H3, `apps/agents/src/money/actions.ts` |
| `accept_plan` must match the other side's latest `negotiation_turn` offer exactly | E3 must write `negotiation_turn` offers | H3, `actions.ts` |
| Every action's milestone, evidence, dispute or negotiation must belong to the action's deal | All agents inserting `proposed_action` | H3, `actions.ts` |
| `deliveryId` in `milestone.delivered` and `milestone.verification_requested`; `notes` on `delivery.detected` | E2 verifier | Section 9 |
| Manual deliveries: `source: "manual"`, `repo`, `sha`, `prNumber` null | E2 verifier | Section 9 |
| `milestone.funding_requested` carries `{ orderId, approveUrl, title }`, never a portal token | E4 notifier emails the client a fresh link from `createMagicLink` | Sections 2 and 3 |
| Only `SUBCONTRACTOR_SPLIT=agency_pays` is supported | E5 `render.yaml` env | `docs/paypal/subcontractor-split.md` |
| Money tick exports: `MONEY_TICK_TASKS`, `RECONCILE_TASK`, `MONEY_HANDLERS` | E5 `cron-tick.ts`, `cron-reconcile.ts` | Section 6 |

CI still fails on GitHub Actions billing, so run `pnpm biome check`, `pnpm -r typecheck` and the package tests locally before asking for review.
