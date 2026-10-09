# F0 experiment evidence template

Copy this template to docs/paypal/evidence/<experiment-id>.md when an experiment is actually performed.
Ensure the evidence directory exists before saving the record.
Read the [plan](f0-plan.md) and update the [handoff](f0-status.md) after recording results.
Use links relative to the copied file's location.
Replace placeholders with observed facts or explicitly write unknown or not tested.
Never copy secrets, full approval URLs, or unredacted provider payloads into this record.

## Identity and scope

| Field | Value |
|---|---|
| Experiment ID | TBD |
| Phase and capability | TBD |
| Contributor and date | TBD |
| Code revision and relevant uncommitted changes | TBD |
| Environment | Sandbox |
| App and account aliases | TBD |
| Country and currency | TBD |
| Intent and disbursement configuration | TBD |
| Per-operation amount and total budget | TBD |
| Capability status | not_tested |

## Prerequisites and expected evidence

Describe the account permissions, seller readiness, and operator actions needed.
State the outcome that would prove the capability before running the experiment.
Identify any dependent experiment and its evidence path.

## Execution record

| Step | Command or action actually performed | Expected result | Observed result | Evidence reference |
|---|---|---|---|---|
| TBD | TBD | TBD | TBD | TBD |

For browser actions, record the account alias, action, and confirmed result without preserving token-bearing URLs.
For writes, record local run and operation references so the private outbox can establish request identity and payload continuity.
Record sanitized HTTP statuses, issue codes, debug IDs, and timestamps where relevant.
If a step was simulated, identify it as simulated rather than real sandbox evidence.

## Confirmation and interpretation

List authoritative API reads that confirmed each resulting resource state.
For multiple payees, map every purchase unit to its intended seller and confirmed amount.
For Payouts, record both batch and item outcomes and identify the sender's funding source.
Distinguish submission, approval, capture, delayed disbursement, release, and recipient receipt.
Explain why the evidence supports the assigned capability status.
State which conclusions cannot be drawn from this experiment.

## Retry and resume record

Record interruptions, retries, reused operation identities, and how ambiguous outcomes were resolved.
If outcome recovery remains incomplete, retain an inconclusive status and the exact next read or investigation.

## Resource accounting

| Resource alias | Private provider reference location | Final observed state | Remaining action and owner |
|---|---|---|---|
| TBD | TBD | TBD | TBD |

Record any cleanup as a separate operation with its own outcome.
State explicitly if cleanup was not applicable, not attempted, or could not be completed.

## Handoff and review

Record commands and tests actually executed, with pass, fail, or not run outcomes.
Record relevant official documentation links and the date consulted.
State remaining blockers and who can resolve them.
Give the exact next action and update f0-status.md with a link to this evidence.
Record a reviewer and review date if reviewed, or mark review pending.
