# F0: PayPal sandbox capability plan

Created: 2026-10-09.
Scope: phased execution of the sandbox capability check in [design sections 9 and 15](../superpowers/specs/2026-10-08-tranche-design.md).
Current progress and the next action live in [f0-status.md](f0-status.md).
Use [f0-evidence-template.md](f0-evidence-template.md) for each experiment.

## Objective and boundaries

Establish whether our sandbox app and accounts support seller onboarding, delayed disbursement, multiple payees, and Payouts.
Also exercise authorize-and-capture as the proposed alternative to delayed disbursement.
Produce reproducible evidence and a payment-path decision for H2.
Results apply only to the tested environment, account configuration, currency, and operation.
F0 does not prove live access, vaulting, unattended future charges, long-term renewal, or the complete milestone lifecycle.
All PayPal capabilities start as not tested.

## How to continue

1. Read the root AGENTS.md, the design spec, this plan, and the current handoff.
2. Inspect the working tree and preserve existing contributor changes.
3. Select the next incomplete phase whose prerequisites are satisfied and record its owner and start date in the handoff.
4. Perform that phase only, using its exit criteria to decide whether it is complete.
5. Record commands actually executed, test outcomes, evidence, blockers, and remaining sandbox resources.
6. Update the handoff with the exact next action and relevant file paths before ending the session.

Phase completion and capability support are separate facts.
A phase may finish with an evidence-backed unsupported result.
A blocked or inconclusive experiment must retain its unresolved work explicitly.
Do not start another phase merely to fill the current session.

## Phase map

| Phase | Deliverable | Prerequisites | Initial status |
|---|---|---|---|
| P0 | Plan, evidence template, and contributor handoff | Repository inspection | Complete |
| P1 | Account inventory and sandbox access assessment | P0 | Not started |
| P2 | Minimal durable probe execution foundation | P1 account requirements understood | Not started |
| P3 | Seller onboarding evidence | P2 and partner access | Not started |
| P4 | Single-seller protection-path evidence | P2 and relevant seller readiness | Not started |
| P5 | Multiple-payee capture evidence | P2 and two ready sellers | Not started |
| P6 | Payouts capability and funding assessment | P2 and intended sender identified | Not started |
| P7 | Reviewed payment-path decision | Required probe results or explicit blockers recorded | Not started |

P0 established the documentation baseline; current execution progress lives in the handoff.
P1 includes actual account and access checks, so completing P0 does not claim those checks were performed.
If a phase is too large for one session, hand off its completed tasks and remaining exit criteria without marking the entire phase complete.

## P0: Establish the handoff

### Tasks

- Inspect the repository and distinguish scaffold code from implemented payment behavior.
- Define phase order, prerequisites, evidence rules, and acceptance criteria.
- Create the current status record and reusable experiment template.
- Add a discoverable entry point in the root README.

### Exit criteria

- All three documents exist and link to one another where needed.
- Every future phase has tasks, expected outputs, and an explicit completion gate.
- The status record identifies P1 as the next phase and all capabilities as not tested.
- Documentation checks pass and no runtime implementation is introduced.

## P1: Inventory accounts and assess access

Follow the [P1 implementation plan](p1-implementation-plan.md) for file changes, preflight behavior, tests, operator steps, and completion criteria.

### Tasks

- Identify the sandbox REST app, platform business account, buyer, two distinct sellers, intended payout sender, and existing recipient.
- Record account aliases, country, currency, role, and whether setup is confirmed, missing, or unknown.
- Use the PayPal Developer Dashboard to inspect partner access, seller features, and Payouts configuration.
- Distinguish observed dashboard settings from features actually proven by API operations.
- Arrange private access to credentials and confirm which operator can complete buyer approval and seller consent.
- Validate sandbox OAuth authentication using a credential-safe method and record only its sanitized outcome.
- Record needed partner attribution and merchant identifiers privately, using aliases in committed documents.
- Define a small per-operation amount, total run budget, and maximum operation count before later payment experiments.

### Outputs and exit criteria

The handoff contains a completed account inventory, dashboard observations, authentication outcome, and missing-access list.
Authentication failure is recorded with its cause or investigation steps and is not labeled as an unsupported payment capability.
No seller referrals, orders, authorizations, captures, releases, or payouts are created in this phase.
If credentials or dashboard access are unavailable, finish the independent setup work and leave P1 blocked with the exact missing prerequisite.

### Existing setup commands

Run from the repository root only when needed and record the actual results.

```powershell
git status --short
node --version
pnpm --version
```

The root package.json pins pnpm and declares the Node requirement.
The current lockfile may impose stricter requirements for individual tools, so check installed package metadata before choosing a runtime.
Use pnpm install when dependencies are needed, and never hand-edit the lockfile.
P1 adds the f0:preflight package command and explicit root .env loading for that command only.
See the [operator runbook](p1-runbook.md) and [access assessment](evidence/p1-access-assessment.md) for validation results.
Do not assume creating a root .env makes other package commands load it.
P2 must extend environment loading explicitly to its durable probe runner.

## P2: Build the minimum execution foundation

### Tasks

- Inspect the installed PayPal SDK and official endpoint documentation before implementing adapters.
- Define shared Zod schemas for capability results and the specific probe operations in packages/contracts.
- Implement sandbox configuration, OAuth handling, transport, typed operations, and sanitized errors in packages/paypal.
- Validate the sandbox host and every provider-returned URL before use, including redirects.
- Add minimal durable run, outbox, and attempt persistence in packages/db, coordinating with any F1/H3 work already underway.
- Generate migrations with Drizzle and review their scope.
- Add a human-operated CLI under apps/agents/scripts/f0, separate from registered agent workflows.
- Provide start, inspect, resume, and report behavior with explicit environment loading.
- Persist each outgoing business operation before execution, including its payload hash and stable PayPal-Request-Id.
- Reuse endpoint-specific duplicate protection, including Payouts sender_batch_id and sender_item_id where applicable.
- Implement atomic claiming, bounded retries, terminal result persistence, and recovery from ambiguous responses.
- Pause durably for human browser actions and verify resulting state through API reads on resume.
- Reject amounts or operation counts beyond the configured run budget.

### Tests and exit criteria

- Verify sandbox restriction and credential redaction.
- Verify stable request identity and rejection of payload changes under an existing operation identity.
- Verify concurrent execution cannot send the same claimed operation twice.
- Verify interruption before a call, after provider success, and before local success persistence.
- Verify ambiguous responses remain unresolved until endpoint-specific recovery confirms the outcome.
- Verify bounded polling and classification of pending, malformed, denied, and timed-out responses.
- Verify waiting for browser approval survives restart.
- Run database integration tests for claiming and persistence using a disposable test database.
- Record exact commands and outcomes in the handoff.

All business writes must use the outbox and send PayPal-Request-Id, as required by AGENTS.md.
OAuth token exchange is authentication transport and is not a probe business operation.
Header presence alone does not establish endpoint idempotency.
If an endpoint lacks a proven safe retry or recovery mechanism, stop automatic retries and record an inconclusive outcome.
Do not build the full inbox, webhook processor, reconciliation service, policy engine, or product UI in this phase.
F0 uses authoritative API reads for confirmation and does not claim webhook processing has been tested.

### Proposed code locations

These locations are targets for P2, not files or commands that already exist.
Adjust small file boundaries to the actual implementation and update this plan if responsibilities change.

```text
packages/contracts/src/sandbox-capabilities.ts
packages/paypal/src/{config,client,operations,errors}.ts
packages/paypal/tests/{client.test,sandbox.integration.test}.ts
packages/db/src/{sandbox-schema,sandbox-store}.ts
packages/db/tests/sandbox-store.test.ts
packages/db/drizzle/                           generated migrations
apps/agents/scripts/f0/{index,runner,executor,probes,report}.ts
apps/agents/tests/f0/{runner,executor}.test.ts
```

Keep core pure and agents read-only.
The CLI is deterministic operator tooling, not an AI agent.
Do not introduce a new workspace or change Turborepo tasks just to run F0.
Read the bundled Turborepo or Next.js documentation before any changes governed by their AGENTS.md instructions.

## P3: Prove seller onboarding

### Tasks

- Use the correct third-party platform onboarding flow for the app's enabled products.
- Create a partner referral through the outbox with a persisted tracking identity.
- Have the sandbox seller complete the consent flow in the browser.
- Resume the run and retrieve the authoritative seller status and granted integration features.
- Repeat for a second seller when preparing P5, recording separate evidence.

### Outputs and exit criteria

Record referral acceptance, seller completion, merchant mapping, payment readiness, and relevant granted permissions separately.
A created referral link alone is insufficient evidence of completed onboarding.
If partner access is denied, capture the sanitized error and distinguish a permission problem from malformed input.
Document whether existing sandbox sellers can support any later experiment without presenting that as successful Partner Referrals onboarding.

## P4: Prove one protection path

### Tasks

- Attempt a single-seller order using delayed disbursement if the prerequisites are available.
- Obtain buyer approval, capture, inspect delayed-disbursement evidence, request referenced disbursement, and confirm the outcome.
- If delayed disbursement is unavailable or cannot complete, test one AUTHORIZE order followed by buyer approval, authorization, detail retrieval, and capture.
- If delayed disbursement succeeds, record the authorization alternative as not tested unless separately exercised.
- Record amount, currency, receiving seller, operation identities, and provider resource relationships.
- Record expiry information provided by PayPal and document remaining renewal questions.

### Outputs and exit criteria

One evidence record describes each attempted path through its terminal outcome or exact blocker.
A successful protection path requires confirming evidence for the delayed capture and release, or authorization and subsequent capture.
Order creation or buyer approval alone cannot prove protection or release capability.
Do not wait weeks to test expiry in F0 or treat simulated errors as proof of real elapsed-time behavior.
Do not assume delayed disbursement is renewable or that reauthorization extends the original window indefinitely.

## P5: Test multiple payees

### Tasks

- Use two distinct ready sandbox sellers and an order with CAPTURE intent.
- Give purchase units unique references and explicitly map each to its seller and amount.
- Obtain buyer approval, capture, and inspect each purchase unit's payment result.
- Record whether the experiment used immediate or delayed disbursement.
- If immediate capture works but the intended delayed combination remains untested, record those as separate capabilities.

### Outputs and exit criteria

Evidence confirms both intended payees and amounts, or documents why the operation failed or remained unresolved.
Do not combine multiple purchase units with AUTHORIZE intent as the happy-path experiment.
Do not infer that multiple-payee capture support also establishes support for the authorization path.

## P6: Test Payouts and assess funding

### Tasks

- Identify the sender account, its permissions, its sandbox balance, and its role in the proposed Tranche money flow.
- Send a small payout to an existing sandbox recipient using persisted batch and item identities.
- Poll batch and item status with a bounded deadline and retain provider references.
- Distinguish successful submission from successful receipt.
- Explain how the intended sender would obtain funds from the proposed agency payment flow, or record that link as unproven.

### Outputs and exit criteria

Record an item-level terminal result or an explicit pending or inconclusive outcome.
Report API capability and subcontractor-funding feasibility separately.
A payout from a prefunded platform balance does not establish that agency proceeds can be distributed through that account.
Do not introduce a new custody model to make the experiment pass.

## P7: Review evidence and select the payment path

### Tasks

- Review evidence for all four required capabilities and any attempted authorization alternative.
- Separate observed sandbox behavior from documentation-derived limits and unresolved assumptions.
- Create docs/paypal/payment-path-decision.md with the tested configuration, selected protection mechanism, split strategy, and remaining constraints.
- Link evidence and state the consequences for H2, H4, and any needed design corrections.
- List all remaining sandbox resources and their final or unresolved states.

### Decision rules and exit criteria

| Evidence | Consequence |
|---|---|
| Delayed capture and release confirmed | Eligible protection path for that tested configuration |
| Delayed path unavailable and authorization plus capture confirmed | Eligible authorization alternative with documented limitations |
| Multiple-payee capture confirmed | Direct splits considered only for the tested compatible flow |
| Payouts confirmed but source funding unproven | Payouts API supported; subcontractor strategy unresolved |
| Neither protection path confirmed | H2 payment-path selection remains blocked |
| Required evidence missing | Decision is provisional and F0 remains incomplete |

F0 is complete when the four required questions have conclusive, evidence-backed results and a viable protection path has been confirmed and documented.
An unsupported optional split or Payouts capability can be a valid finding, with its product consequence recorded.
If an external prerequisite prevents completion, publish the partial findings and precise blocker without marking F0 complete.
Vaulting, unattended just-in-time funding, and renewal behavior remain follow-up validation work unless separately tested.

## Evidence, secrets, and residual resources

Use statuses supported, unsupported, blocked, inconclusive, and not_tested for capabilities.
Keep phase statuses separate: not started, in progress, blocked, and complete.
Use one experiment ID per fresh experiment and resume that ID after interruption.
Keep request identities stable for retries and never reuse an operation identity for a different payload.
Do not retry an ambiguous operation with a new request ID to force a result.
Record actual commands only after they exist and have been run.

Committed evidence must exclude client secrets, access tokens, authorization headers, passwords, private keys, buyer details, and approval or referral URLs containing tokens.
Keep raw payloads and private account mappings in an ignored local artifact directory or an approved private store.
P2 must configure artifact exclusion before generating reports.
Reviewed Markdown evidence can live under docs/paypal/evidence/.
Report each authorization, capture, disbursement, payout, referral, and vault resource created by an experiment.
Use the outbox for any applicable cleanup writes and record the result.
Do not promise captured or completed payments can simply be deleted or reversed.

## Documentation baseline

These official references were consulted during planning on 2026-10-09 and do not prove access for our accounts.
Recheck relevant endpoint documentation before implementing each probe.

- [Delayed disbursement](https://developer.paypal.com/platforms/checkout/delayed-disbursement/): partner and seller prerequisites, automatic disbursement, and referenced release.
- [Orders errors](https://developer.paypal.com/serversdk/php/api-endpoints/orders/errors): multiple purchase units are incompatible with AUTHORIZE intent.
- [Idempotency](https://developer.paypal.com/api/rest/reference/idempotency/): endpoint-specific support and retention.
- [Payout batch reference](https://developer.paypal.com/api/payments.payouts-batch/v1/definitions/payout_batch_header/): duplicate batch handling and item-level follow-up.
- [Platform authorization and capture](https://developer.paypal.com/platforms/checkout/standard/customize/auth-capture/): authorization and capture lifecycle constraints.

Resolve conflicting or incomplete guidance using the relevant endpoint contract and observed sandbox evidence, and record anything that remains uncertain.
