"use client";

import type { MilestoneState } from "@tranche/contracts";
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  Pencil,
  TriangleAlert,
  X,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ActivityPanel } from "@/components/activity-panel";
import { ApprovalCard, proposalTitle } from "@/components/approval-card";
import { DealStatusBadge } from "@/components/deal-status-badge";
import { addDays, LOCKED_STATES } from "@/components/gantt/gantt-data";
import { GanttLoader } from "@/components/gantt/gantt-loader";
import { MilestoneBadge } from "@/components/milestone-badge";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDealStream } from "@/hooks/use-deal-stream";
import { describeCheck } from "@/lib/criteria";
import { formatDay } from "@/lib/dates";
import { formatMoney, totalOf } from "@/lib/money";
import { explainReschedule } from "@/lib/reschedule";
import type { DealView } from "@/server/deals";

type Milestone = DealView["milestones"][number];
type Task = DealView["tasks"][number];

const DELIVERABLE: ReadonlySet<MilestoneState> = new Set([
  "held",
  "in_progress",
  "changes_requested",
]);

async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  return typeof body.error === "string" ? body.error : fallback;
}

function latestEvidence(m: Milestone) {
  const seen = new Set<string>();
  return m.evidence.filter((e) => {
    const key = `${e.kind}:${e.checkIndex}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function evidenceLabel(m: Milestone, e: Milestone["evidence"][number]): string {
  const check = e.checkIndex === null ? undefined : m.criteria.checks[e.checkIndex];
  return check ? describeCheck(check) : e.kind.replaceAll("_", " ");
}

export function DealWorkspace({ initialView }: { initialView: DealView }) {
  const [view, setView] = useState(initialView);
  const [editing, setEditing] = useState<Task | null>(null);
  const [delivering, setDelivering] = useState<Milestone | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{
    kind: "error" | "warning";
    title: string;
    message: string;
  } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [since] = useState(initialView.activity[0]?.id);
  const dealId = view.deal.id;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const res = await fetch(`/api/deals/${dealId}`, { cache: "no-store" }).catch(() => null);
      if (res?.ok) setView((await res.json()) as DealView);
    }, 150);
  }, [dealId]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useDealStream(dealId, null, refresh, since, refresh);

  async function post(path: string, body?: unknown): Promise<Response | null> {
    setPending(true);
    try {
      return await fetch(`/api/deals/${dealId}${path}`, {
        method: "POST",
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      toast.error("Network error. Check your connection and try again.");
      return null;
    } finally {
      setPending(false);
    }
  }

  async function move(taskId: string, start: string): Promise<{ ok: boolean; reason?: string }> {
    const res = await post("/tasks/reschedule", { taskId, start });
    if (!res) return { ok: false };
    if (res.status === 422) {
      const reason = await errorOf(res, "That move is not allowed.");
      return { ok: false, reason: explainReschedule(reason, view.tasks) };
    }
    if (!res.ok) {
      toast.error("Could not update the schedule. Try again.");
      return { ok: false };
    }
    refresh();
    const { warning } = (await res.json().catch(() => ({}))) as { warning?: unknown };
    if (typeof warning === "string" && warning) {
      setNotice({
        kind: "warning",
        title: "Schedule updated past a hold deadline",
        message: explainReschedule(warning, view.tasks),
      });
    } else {
      setNotice(null);
      toast.success("Schedule updated.");
    }
    return { ok: true };
  }

  async function moveFromGantt(taskId: string, start: string): Promise<boolean> {
    const result = await move(taskId, start);
    const title = view.tasks.find((t) => t.id === taskId)?.title ?? "this task";
    if (result.reason) {
      setNotice({ kind: "error", title: `Could not move ${title}`, message: result.reason });
    }
    return result.ok;
  }

  function editTask(task: Task | null) {
    setEditError(null);
    setEditing(task);
  }

  async function send() {
    const res = await post("/send");
    if (!res) return;
    if (!res.ok) {
      const error = await errorOf(res, "Could not send the plan.");
      toast.error(
        error === "plan_has_no_milestones" ? "Add at least one milestone before sending." : error,
      );
      return refresh();
    }
    const { portalUrl } = (await res.json()) as { portalUrl: string };
    setView((v) => ({ ...v, deal: { ...v.deal, status: "sent" } }));
    const copied = await navigator.clipboard.writeText(portalUrl).then(
      () => true,
      () => false,
    );
    toast.success(copied ? "Plan sent. Portal link copied." : "Plan sent to the client.");
    refresh();
  }

  async function deliver(milestone: Milestone, url: string): Promise<boolean> {
    const res = await post(`/milestones/${milestone.id}/deliver`, { urls: [url] });
    refresh();
    if (!res) return false;
    if (res.status === 404) {
      toast.error("Marking a delivery is not available yet.");
      return false;
    }
    if (!res.ok) {
      toast.error(await errorOf(res, "Could not record the delivery."));
      return false;
    }
    toast.success("Delivery recorded. Verification starts shortly.");
    return true;
  }

  async function saveTask(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const start = String(new FormData(e.currentTarget).get("start") ?? "");
    if (start === editing.startDate) return editTask(null);
    const result = await move(editing.id, start);
    if (result.ok) editTask(null);
    else setEditError(result.reason ?? null);
  }

  async function submitDelivery(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!delivering) return;
    const url = String(new FormData(e.currentTarget).get("url") ?? "");
    if (await deliver(delivering, url)) setDelivering(null);
  }

  const total = totalOf(
    view.deal.currency,
    view.milestones.map((m) => m.priceMinor),
  );
  const agencyApprovals = view.approvals.filter((a) => a.side === "agency");
  const clientApprovals = view.approvals.filter((a) => a.side === "client");
  const milestoneTitleOf = (a: DealView["approvals"][number]) => {
    const id = "milestoneId" in a.payload ? a.payload.milestoneId : null;
    return view.milestones.find((m) => m.id === id)?.title ?? null;
  };

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-4xl break-words">{view.deal.title}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>{view.deal.clientName}</span>
            <span className="tabular text-foreground">{formatMoney(total)}</span>
            <span data-testid="deal-status" data-status={view.deal.status}>
              <DealStatusBadge status={view.deal.status} />
            </span>
          </div>
        </div>
        {view.deal.status === "draft" ? (
          <div className="flex flex-col items-start gap-1.5 sm:items-end">
            <Button
              data-testid="send-plan"
              onClick={send}
              disabled={pending || view.milestones.length === 0}
              aria-describedby={view.milestones.length === 0 ? "send-plan-reason" : undefined}
            >
              Send plan to client
            </Button>
            {view.milestones.length === 0 ? (
              <p id="send-plan-reason" className="text-xs text-muted-foreground">
                Add at least one milestone first.
              </p>
            ) : null}
          </div>
        ) : null}
      </header>

      {notice ? (
        <Alert
          variant={notice.kind === "error" ? "destructive" : "default"}
          data-testid={notice.kind === "error" ? "reschedule-error" : "reschedule-warning"}
        >
          {notice.kind === "error" ? (
            <CircleAlert />
          ) : (
            <TriangleAlert className="text-tone-attention" />
          )}
          <AlertTitle>{notice.title}</AlertTitle>
          <AlertDescription>{notice.message}</AlertDescription>
          <AlertAction>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Dismiss"
              onClick={() => setNotice(null)}
            >
              <X />
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      {view.tasks.length > 0 ? (
        <section aria-label="Schedule" className="hidden md:block">
          <GanttLoader view={view} onMove={moveFromGantt} />
        </section>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-8">
          <section aria-labelledby="milestones-heading" className="flex flex-col gap-4">
            <h2 id="milestones-heading" className="text-2xl">
              Milestones
            </h2>
            {view.milestones.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                This plan has no milestones yet.
              </p>
            ) : (
              <ol className="flex flex-col gap-4">
                {view.milestones.map((m) => (
                  <MilestoneCard
                    key={m.id}
                    milestone={m}
                    currency={view.deal.currency}
                    tasks={view.tasks.filter((t) => t.milestoneId === m.id)}
                    onEditTask={editTask}
                    onDeliver={setDelivering}
                  />
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside className="flex flex-col gap-8">
          <section aria-labelledby="needs-you-heading" className="flex flex-col gap-3">
            <h2 id="needs-you-heading" className="text-2xl">
              Needs you
            </h2>
            {agencyApprovals.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing waiting on you.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {agencyApprovals.map((a) => (
                  <li key={a.id}>
                    <ApprovalCard
                      approval={a}
                      decideUrl={`/api/approvals/${a.id}/decide`}
                      milestoneTitle={milestoneTitleOf(a)}
                      onDone={refresh}
                    />
                  </li>
                ))}
              </ul>
            )}
            {clientApprovals.length > 0 ? (
              <div className="flex flex-col gap-1.5 pt-1">
                <p className="text-xs text-muted-foreground">Waiting on the client</p>
                <ul className="flex flex-col gap-1 text-sm">
                  {clientApprovals.map((a) => (
                    <li key={a.id} className="break-words">
                      {proposalTitle(a.actionType)}
                      {milestoneTitleOf(a) ? (
                        <span className="text-muted-foreground"> for {milestoneTitleOf(a)}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
          <section aria-labelledby="activity-heading" className="flex flex-col gap-3">
            <h2 id="activity-heading" className="text-2xl">
              Activity
            </h2>
            <ActivityPanel activity={view.activity} />
          </section>
        </aside>
      </div>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && editTask(null)}>
        <DialogContent>
          <form onSubmit={saveTask} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Reschedule task</DialogTitle>
              <DialogDescription>
                {editing?.title}. Dependent tasks, milestone dates and funding timers move with it.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor="task-start">Start date</Label>
              <Input
                id="task-start"
                name="start"
                type="date"
                required
                defaultValue={editing?.startDate}
                data-testid="task-start-input"
                className="tabular"
                aria-invalid={editError ? true : undefined}
                aria-describedby={editError ? "task-start-error" : undefined}
                onChange={() => setEditError(null)}
              />
              {editError ? (
                <p id="task-start-error" role="alert" className="text-sm text-destructive">
                  {editError}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => editTask(null)}>
                Cancel
              </Button>
              <Button type="submit" data-testid="save-task" disabled={pending}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={delivering !== null} onOpenChange={(open) => !open && setDelivering(null)}>
        <DialogContent>
          <form onSubmit={submitDelivery} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Mark as delivered</DialogTitle>
              <DialogDescription>
                {delivering?.title}. The verifier checks this URL against the acceptance criteria.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor="delivery-url">Delivery URL</Label>
              <Input
                id="delivery-url"
                name="url"
                type="url"
                required
                placeholder="https://staging.example.com"
                data-testid="delivery-url-input"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDelivering(null)}>
                Cancel
              </Button>
              <Button type="submit" data-testid="submit-delivery" disabled={pending}>
                Submit delivery
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MilestoneCard({
  milestone: m,
  currency,
  tasks,
  onEditTask,
  onDeliver,
}: {
  milestone: Milestone;
  currency: string;
  tasks: Task[];
  onEditTask: (task: Task) => void;
  onDeliver: (milestone: Milestone) => void;
}) {
  const locked = LOCKED_STATES.has(m.state);
  const start = m.startDate ?? tasks.map((t) => t.startDate).sort()[0];
  const end =
    m.endDate ??
    tasks
      .map((t) => addDays(t.startDate, t.durationDays))
      .sort()
      .at(-1);
  const evidence = latestEvidence(m);
  const missing = evidence.filter((e) => e.passed === false);

  return (
    <li
      data-testid={`milestone-${m.key}`}
      data-state={m.state}
      className="flex flex-col gap-4 rounded-lg border bg-card p-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h3 className="font-medium break-words">{m.title}</h3>
          <MilestoneBadge
            state={m.state}
            pendingReview={m.hold?.pendingReview}
            className="self-start"
          />
        </div>
        <span className="tabular text-lg">{formatMoney({ currency, minor: m.priceMinor })}</span>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">Dates</dt>
          <dd className="tabular" data-testid={`milestone-dates-${m.key}`}>
            {start && end ? `${formatDay(start)} - ${formatDay(end)}` : "Not scheduled"}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">Funding</dt>
          <dd className="tabular" data-testid={`scheduled-fund-${m.key}`}>
            {m.hold?.pendingReview
              ? "In PayPal review"
              : m.fundDueAt
                ? `Due ${formatDay(m.fundDueAt)}`
                : "Not scheduled"}
          </dd>
        </div>
        {m.hold?.status === "active" ? (
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">Hold expires</dt>
            <dd className="tabular">{formatDay(m.hold.expiresAt)}</dd>
          </div>
        ) : null}
      </dl>

      {m.hold?.pendingReview ? (
        <p className="text-sm text-muted-foreground" data-testid={`pending-review-${m.key}`}>
          PayPal is reviewing the client's payment. Work can start once it clears.
        </p>
      ) : null}

      {tasks.length > 0 ? (
        <ul className="flex flex-col divide-y rounded-md border" aria-label={`Tasks in ${m.title}`}>
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="flex min-w-0 flex-col">
                <span className="text-sm break-words">{t.title}</span>
                <span className="tabular text-xs text-muted-foreground">
                  {formatDay(t.startDate)}, {t.durationDays} {t.durationDays === 1 ? "day" : "days"}
                </span>
              </div>
              {locked ? null : (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  data-testid={`edit-task-${t.key}`}
                  aria-label={`Reschedule ${t.title}`}
                  onClick={() => onEditTask(t)}
                >
                  <Pencil />
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {missing.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-md bg-tone-attention/10 p-3">
          <p className="text-sm font-medium text-tone-attention">Missing before release</p>
          <ul data-testid={`milestone-missing-${m.key}`} className="flex flex-col gap-1 text-sm">
            {missing.map((e) => (
              <li key={e.id} className="flex flex-col">
                <span>{evidenceLabel(m, e)}</span>
                {e.summary ? (
                  <span className="text-xs text-muted-foreground">{e.summary}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {evidence.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">Evidence</p>
          <ul data-testid={`evidence-${m.key}`} className="flex flex-col gap-2 text-sm">
            {evidence.map((e) => (
              <li key={e.id} className="flex gap-2">
                <EvidenceIcon passed={e.passed} />
                <div className="flex min-w-0 flex-col">
                  <span className="break-words">{evidenceLabel(m, e)}</span>
                  {e.summary ? (
                    <span className="text-xs break-words text-muted-foreground">{e.summary}</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {DELIVERABLE.has(m.state) ? (
        <Button
          variant="outline"
          className="self-start"
          data-testid={`mark-delivered-${m.key}`}
          onClick={() => onDeliver(m)}
        >
          Mark as delivered
        </Button>
      ) : null}
    </li>
  );
}

function EvidenceIcon({ passed }: { passed: boolean | null }) {
  if (passed === true) {
    return (
      <CircleCheck className="mt-0.5 size-4 shrink-0 text-tone-released" aria-label="Passed" />
    );
  }
  if (passed === false) {
    return <CircleX className="mt-0.5 size-4 shrink-0 text-tone-danger" aria-label="Failed" />;
  }
  return (
    <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Noted" />
  );
}
