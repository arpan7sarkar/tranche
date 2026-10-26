"use client";

import { fromPayPalValue, type PlanDraft, toPayPalValue } from "@tranche/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { describeCheck } from "@/lib/criteria";

export function BriefPlanner({ initialDealId }: { initialDealId: string | null }) {
  const router = useRouter();
  const [dealId, setDealId] = useState(initialDealId);
  const [plan, setPlan] = useState<PlanDraft | null>(null);
  const [proposalId, setProposalId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [poll, setPoll] = useState(Date.now);
  const requestId = useRef<string | null>(null);
  useEffect(() => {
    if (!dealId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function check() {
      try {
        const response = await fetch(`/api/plans/${dealId}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Unable to load the draft");
        if (data.status === "saved") {
          router.replace(`/deals/${dealId}`);
          return;
        }
        if (data.status === "ready") {
          setPlan(data.plan);
          setProposalId(data.proposalId);
          return;
        }
        if (data.status === "failed") throw new Error(data.message);
        if (Date.now() - poll >= 120_000)
          throw new Error("Your draft is still queued. You can return later or check again.");
        timer = setTimeout(check, 2000);
      } catch (err) {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : "Unable to load the draft");
      }
    }
    void check();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [dealId, poll, router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    requestId.current ??= crypto.randomUUID();
    try {
      const response = await fetch("/api/plans/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...fields,
          requestId: requestId.current,
          repo: fields.repo || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to create the draft");
      setDealId(data.dealId);
      setPoll(Date.now());
      window.history.replaceState(null, "", `/deals/new?draft=${data.dealId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create the draft");
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/plans/${dealId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proposalId, plan }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to save the plan");
      router.push(`/deals/${dealId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save the plan");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      {error && (
        <div role="alert" className="rounded-lg border border-destructive p-4 text-destructive">
          {error}
        </div>
      )}
      {!dealId ? (
        <form
          onSubmit={submit}
          onChange={() => {
            requestId.current = null;
          }}
          className="grid gap-5"
        >
          <p className="text-muted-foreground">
            Describe the website or app. Review the proposed milestones before sending anything to
            your client.
          </p>
          {(
            [
              ["title", "Project title", "text"],
              ["clientName", "Client name", "text"],
              ["clientEmail", "Client email", "email"],
              ["repo", "GitHub repository (optional, owner/repository)", "text"],
              ["stagingUrl", "Staging URL", "url"],
              ["startDate", "Start date", "date"],
            ] as const
          ).map(([name, label, type]) => (
            <div key={name} className="grid gap-2">
              <Label htmlFor={name}>{label}</Label>
              <Input
                id={name}
                name={name}
                type={type}
                required={name !== "repo"}
                maxLength={name === "stagingUrl" ? 2000 : 200}
                defaultValue={
                  name === "startDate" ? new Date().toISOString().slice(0, 10) : undefined
                }
                disabled={busy}
              />
            </div>
          ))}
          <div className="grid gap-2">
            <Label htmlFor="brief">Project brief</Label>
            <Textarea
              id="brief"
              name="brief"
              required
              minLength={40}
              maxLength={20000}
              rows={8}
              disabled={busy}
              placeholder="Describe the deliverables, pages, functionality, and acceptance requirements."
            />
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? "Submitting brief…" : "Draft plan"}
          </Button>
        </form>
      ) : !plan ? (
        <div className="grid gap-4" role="status">
          <p>{error ? "Your brief is saved." : "Preparing your draft plan…"}</p>
          <Button
            variant="outline"
            onClick={() => {
              setError("");
              setPoll(Date.now());
            }}
          >
            Check again
          </Button>
          <Link href="/deals" className="underline">
            Back to deals
          </Link>
        </div>
      ) : (
        <>
          <h2 className="text-2xl">Review your draft</h2>
          <p>{plan.summary}</p>
          {plan.milestones.map((milestone, index) => (
            <section key={milestone.key} className="grid gap-4 rounded-xl border bg-card p-5">
              <div className="grid gap-2">
                <Label htmlFor={`title-${index}`}>Milestone title</Label>
                <Input
                  id={`title-${index}`}
                  value={milestone.title}
                  onChange={(e) =>
                    setPlan({
                      ...plan,
                      milestones: plan.milestones.map((m, i) =>
                        i === index ? { ...m, title: e.target.value } : m,
                      ),
                    })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`price-${index}`}>Price ({plan.currency})</Label>
                <Input
                  id={`price-${index}`}
                  key={`${proposalId}-${milestone.key}`}
                  defaultValue={toPayPalValue(milestone.price)}
                  onBlur={(e) => {
                    try {
                      const price = fromPayPalValue(plan.currency, e.target.value);
                      setPlan({
                        ...plan,
                        milestones: plan.milestones.map((m, i) =>
                          i === index ? { ...m, price } : m,
                        ),
                      });
                      setError("");
                    } catch {
                      setError("Enter a valid price in the project currency.");
                      e.target.value = toPayPalValue(milestone.price);
                    }
                  }}
                />
              </div>
              <ul className="list-inside list-disc text-sm">
                {milestone.criteria.checks.map((check) => (
                  <li key={JSON.stringify(check)}>{describeCheck(check)}</li>
                ))}
              </ul>
              <div className="grid gap-2">
                <Label htmlFor={`criteria-${index}`}>
                  Written acceptance criteria (one per line)
                </Label>
                <Textarea
                  id={`criteria-${index}`}
                  defaultValue={milestone.criteria.prose.join("\n")}
                  onBlur={(e) =>
                    setPlan({
                      ...plan,
                      milestones: plan.milestones.map((m, i) =>
                        i === index
                          ? {
                              ...m,
                              criteria: {
                                ...m.criteria,
                                prose: e.target.value.split("\n").filter(Boolean),
                              },
                            }
                          : m,
                      ),
                    })
                  }
                />
              </div>
            </section>
          ))}
          <h3 className="text-xl">Tasks and dependencies</h3>
          {plan.tasks.map((task, index) => (
            <div key={task.key} className="grid gap-2 rounded-lg border p-4">
              <Label htmlFor={`task-${index}`}>{task.title}: duration in days</Label>
              <Input
                id={`task-${index}`}
                type="number"
                min={1}
                max={120}
                value={task.durationDays}
                onChange={(e) =>
                  setPlan({
                    ...plan,
                    tasks: plan.tasks.map((t, i) =>
                      i === index ? { ...t, durationDays: Number(e.target.value) } : t,
                    ),
                  })
                }
              />
              <p className="text-sm text-muted-foreground">
                Depends on: {task.dependsOn.join(", ") || "None"}
              </p>
            </div>
          ))}
          <Button disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save draft and open Gantt"}
          </Button>
          <p className="text-sm text-muted-foreground">
            Adjust task dates in the workspace, then send the plan when you are ready.
          </p>
        </>
      )}
    </div>
  );
}
