# Subcontractor split

Tranche supports one way of paying subcontractors today: `SUBCONTRACTOR_SPLIT=agency_pays`, the default.
A release captures the whole milestone amount to the agency's PayPal account, minus the platform fee.
The agency then pays its subcontractors itself, outside Tranche.
Milestone payees with `kind: "subcontractor"` are recorded for the plan and the client portal, but Tranche moves no money to them.

`multi_payee` and `payouts` are not implemented.
The agents service refuses to start when `SUBCONTRACTOR_SPLIT` is set to anything other than `agency_pays`.

`payouts` stays disabled until its money path is designed.
Sending a Payouts batch from the platform account after capturing the full amount to the agency would pay each subcontractor share out of Tranche's own balance.
A working design has to route the subcontractor shares to the platform first, for example as part of the platform fee on capture, before paying them out.

The [P7 decision](payment-path-decision.md) selects this split with authorization holds and records the evidence limits and deferred P5/P6 work.
