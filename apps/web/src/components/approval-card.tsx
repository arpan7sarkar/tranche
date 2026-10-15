"use client";

import type { ActionPayload, ActionType } from "@tranche/contracts";
import { CircleCheck, CircleX } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/dates";
import { formatMoney, totalOf } from "@/lib/money";
import type { DealView } from "@/server/deals";

type Approval = DealView["approvals"][number];
type Decision = "approved" | "rejected";

const TITLES: Record<ActionType, string> = {
  create_plan: "Apply a new plan",
  mark_verified: "Mark milestone verified",
  request_changes: "Request changes",
  release: "Release payment",
  send_reminder: "Send a reminder",
  reschedule: "Reschedule tasks",
  flag_risk: "Acknowledge a risk",
  accept_plan: "Accept the negotiated plan",
  escalate: "Escalate to a person",
  submit_dispute_evidence: "Submit dispute evidence",
};

export function proposalTitle(type: ActionType): string {
  return TITLES[type];
}

function proposer(agent: string): string {
  return agent === "system" ? "Proposed by Tranche" : `Proposed by the ${agent} agent`;
}

function headlineAmount(payload: ActionPayload): string | null {
  if (payload.type === "release") return formatMoney(payload.amount);
  if (payload.type === "create_plan" || payload.type === "accept_plan") {
    const { currency, milestones } = payload.plan;
    return formatMoney(
      totalOf(
        currency,
        milestones.map((m) => m.price.minor),
      ),
    );
  }
  return null;
}

function Details({ payload }: { payload: ActionPayload }) {
  switch (payload.type) {
    case "request_changes":
      return (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {payload.missing.map((item, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: items can repeat and never reorder
            <li key={i} className="break-words">
              {item}
            </li>
          ))}
        </ul>
      );
    case "reschedule":
      return (
        <p className="text-sm">
          {payload.shifts.length === 1 ? "1 task moves" : `${payload.shifts.length} tasks move`},
          starting{" "}
          <span className="tabular">
            {formatDay(payload.shifts.map((s) => s.start).sort()[0] ?? "")}
          </span>
          . <span className="break-words">{payload.reason}</span>
        </p>
      );
    case "flag_risk":
      return (
        <p className="text-sm break-words">
          <span className="font-medium capitalize">{payload.severity} risk.</span> {payload.message}
        </p>
      );
    case "send_reminder":
      return (
        <div className="flex flex-col gap-0.5 text-sm">
          <p className="break-words">
            To the {payload.to}: <span className="font-medium">{payload.subject}</span>
          </p>
          <p className="line-clamp-3 whitespace-pre-wrap break-words text-muted-foreground">
            {payload.body}
          </p>
        </div>
      );
    case "create_plan":
    case "accept_plan":
      return (
        <ol className="flex flex-col divide-y rounded-md border text-sm">
          {payload.plan.milestones.map((m) => (
            <li key={m.key} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
              <span className="min-w-0 break-words">{m.title}</span>
              <span className="tabular shrink-0">{formatMoney(m.price)}</span>
            </li>
          ))}
        </ol>
      );
    case "mark_verified":
      return (
        <p className="text-sm">
          Backed by {payload.evidenceIds.length}{" "}
          {payload.evidenceIds.length === 1 ? "piece" : "pieces"} of evidence.
        </p>
      );
    case "escalate":
      return <p className="text-sm break-words">{payload.reason}</p>;
    case "submit_dispute_evidence":
      return <p className="text-sm whitespace-pre-wrap break-words">{payload.notes}</p>;
    case "release":
      return null;
  }
}

export function ApprovalCard({
  approval,
  decideUrl,
  milestoneTitle,
  context,
  onDone,
}: {
  approval: Approval;
  decideUrl: string;
  milestoneTitle?: string | null;
  context?: ReactNode;
  onDone: () => void;
}) {
  const [pending, setPending] = useState<Decision | null>(null);
  const [decided, setDecided] = useState<Decision | null>(null);
  const amount = headlineAmount(approval.payload);

  async function decide(decision: Decision) {
    setPending(decision);
    const res = await fetch(decideUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    }).catch(() => null);
    setPending(null);
    if (!res) {
      toast.error("Network error. Check your connection and try again.");
      return;
    }
    if (res.ok) {
      setDecided(decision);
      toast.success(decision === "approved" ? "Approved." : "Rejected.");
    } else if (res.status === 409) {
      toast.info("Someone already decided this one.");
    } else if (res.status === 404) {
      toast.error("This request is no longer waiting for you.");
    } else {
      toast.error("Could not record your decision. Try again.");
      return;
    }
    onDone();
  }

  return (
    <article
      data-testid={`approval-${approval.id}`}
      className="flex flex-col gap-3 rounded-lg border bg-card p-4"
    >
      <header className="flex flex-col gap-1">
        {context}
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-medium">{TITLES[approval.actionType]}</h3>
          {amount ? <span className="tabular shrink-0 text-sm">{amount}</span> : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {milestoneTitle ? <span className="break-words">{milestoneTitle}. </span> : null}
          {proposer(approval.agent)}
        </p>
      </header>
      <Details payload={approval.payload} />
      <p className="text-sm whitespace-pre-wrap break-words text-muted-foreground">
        {approval.reasoning}
      </p>
      {decided ? (
        <p className="flex items-center gap-1.5 text-sm font-medium" role="status">
          {decided === "approved" ? (
            <CircleCheck className="size-4 text-tone-released" aria-hidden />
          ) : (
            <CircleX className="size-4 text-muted-foreground" aria-hidden />
          )}
          {decided === "approved" ? "Approved" : "Rejected"}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            data-testid={`approve-${approval.id}`}
            disabled={pending !== null}
            onClick={() => decide("approved")}
          >
            {pending === "approved" ? "Approving" : "Approve"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            data-testid={`reject-${approval.id}`}
            disabled={pending !== null}
            onClick={() => decide("rejected")}
          >
            {pending === "rejected" ? "Rejecting" : "Reject"}
          </Button>
        </div>
      )}
    </article>
  );
}
