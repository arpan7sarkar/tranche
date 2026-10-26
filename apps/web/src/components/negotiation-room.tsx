"use client";
import type { NegotiationView } from "@tranche/agents";
import { fromPayPalValue } from "@tranche/contracts";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { GanttLoader } from "@/components/gantt/gantt-loader";
import { negotiationPreview } from "@/components/negotiation-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDealStream } from "@/hooks/use-deal-stream";
import { formatMoney } from "@/lib/money";
import type { DealView } from "@/server/deals";

export function NegotiationRoom({
  deal,
  initial,
}: {
  deal: DealView;
  initial: NegotiationView | null;
}) {
  const [view, setView] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [budget, setBudget] = useState("");
  const [floor, setFloor] = useState("");
  const [deadline, setDeadline] = useState("");
  const [rounds, setRounds] = useState("4");
  const [confirmed, setConfirmed] = useState(false);
  const id = view?.id;
  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/negotiations/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Could not refresh negotiation. Your saved turns are safe.");
      setView(await res.json());
      setError(null);
    } catch {
      setError("Could not refresh negotiation. Try again.");
    }
  }, [id]);
  useDealStream(deal.deal.id, null, () => {
    void refresh();
  });
  useEffect(() => {
    if (
      !id ||
      (view?.status !== "open" &&
        !["pending", "approved", "needs_approval"].includes(view?.applicationStatus ?? ""))
    )
      return;
    const timer = setInterval(() => {
      void refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [id, refresh, view?.status, view?.applicationStatus]);
  async function start(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const clientLimit = fromPayPalValue(deal.deal.currency, budget).minor;
      const agencyFloor = floor ? fromPayPalValue(deal.deal.currency, floor).minor : undefined;
      const res = await fetch("/api/negotiations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId: deal.deal.id,
          client: {
            limitMinor: clientLimit,
            latestEndDate: deadline || null,
            maxRounds: Number(rounds),
          },
          ...(agencyFloor === undefined ? {} : { agencyFloorMinor: agencyFloor }),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not start negotiation");
      const loaded = await fetch(`/api/negotiations/${body.negotiationId}`, { cache: "no-store" });
      if (!loaded.ok) throw new Error("Negotiation started. Reload to reconnect.");
      setView(await loaded.json());
      setBudget("");
      setFloor("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check the entered amounts.");
    } finally {
      setBusy(false);
    }
  }
  const lastPlan = view?.turns.filter((t) => t.plan).at(-1)?.plan;
  const preview =
    lastPlan && view?.startDate ? negotiationPreview(deal, lastPlan, view.startDate) : deal;
  const canStart =
    (!view ||
      view.status === "escalated" ||
      view.status === "failed" ||
      ["failed", "rejected"].includes(view.applicationStatus ?? "")) &&
    ["sent", "negotiating"].includes(deal.deal.status);
  return (
    <div className="grid gap-6">
      <header>
        <Link className="underline" href={`/deals/${deal.deal.id}`}>
          Back to deal
        </Link>
        <h1 className="mt-3 text-3xl">Negotiation room</h1>
        <p className="text-muted-foreground">{deal.deal.title}</p>
      </header>
      {error && (
        <div role="alert" className="rounded border border-destructive p-4">
          <p>{error}</p>
          <Button
            variant="outline"
            onClick={() => (id ? void refresh() : window.location.reload())}
          >
            Try again
          </Button>
        </div>
      )}
      {!view && <p>No negotiation yet. Send the plan before negotiating its price and dates.</p>}
      {canStart && (
        <form onSubmit={start} className="grid gap-4 rounded-lg border bg-card p-5">
          <h2 className="text-xl">Simulated client agent</h2>
          <p className="text-sm text-muted-foreground">
            Set up both sides for this demo. Agent agreement remains subject to policy and approval;
            this does not grant permission to release funds.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="client-budget">Client budget ({deal.deal.currency})</Label>
              <Input
                id="client-budget"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                inputMode="decimal"
                required
              />
            </div>
            <div>
              <Label htmlFor="agency-floor">Agency minimum (optional)</Label>
              <Input
                id="agency-floor"
                value={floor}
                onChange={(e) => setFloor(e.target.value)}
                inputMode="decimal"
              />
            </div>
            <div>
              <Label htmlFor="deadline">Latest end date (optional)</Label>
              <Input
                id="deadline"
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="rounds">Maximum rounds</Label>
              <Input
                id="rounds"
                type="number"
                min="1"
                max="12"
                value={rounds}
                onChange={(e) => setRounds(e.target.value)}
                required
              />
            </div>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Use these limits for the simulated client.
          </label>
          <Button type="submit" disabled={busy || !confirmed}>
            {busy ? "Starting..." : "Start negotiation"}
          </Button>
        </form>
      )}
      {view && (
        <section aria-live="polite" className="rounded-lg border p-4">
          <h2 className="text-xl">
            {view.status === "open"
              ? "Negotiating"
              : view.status === "agreed"
                ? "Agents agreed on terms"
                : "Human review required"}
          </h2>
          {view.status === "open" && (
            <p>
              Waiting for the next turn. Model-disabled or temporarily unavailable work resumes when
              the worker is ready.
            </p>
          )}
          {view.status === "agreed" && (
            <p>
              Application status: {view.applicationStatus ?? "pending"}. Review approvals in the
              deal workspace or client portal.
            </p>
          )}
          {view.status === "escalated" && <p>Review the plan and limits before starting again.</p>}
        </section>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {(["agency", "client"] as const).map((side) => {
          const last = view?.turns.filter((t) => t.side === side && t.plan).at(-1);
          return (
            <section key={side} className="rounded-lg border bg-card p-4">
              <h2 className="text-lg capitalize">{side} offer</h2>
              {last?.totalMinor != null ? (
                <>
                  <p className="text-2xl">
                    {formatMoney({ currency: deal.deal.currency, minor: last.totalMinor })}
                  </p>
                  <p>Ends {last.endDate}</p>
                </>
              ) : (
                <p className="text-muted-foreground">No offer yet.</p>
              )}
            </section>
          );
        })}
      </div>
      <section className="grid gap-2">
        <h2 className="text-xl">Latest proposed schedule</h2>
        <p className="text-sm text-muted-foreground">
          Preview only. The deal changes after approval.
        </p>
        <GanttLoader view={preview} onMove={async () => false} readOnly />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Proposed milestone dates and prices</caption>
            <thead>
              <tr>
                <th className="p-2">Milestone</th>
                <th className="p-2">Start</th>
                <th className="p-2">End</th>
                <th className="p-2">Price</th>
              </tr>
            </thead>
            <tbody>
              {preview.milestones.map((m) => (
                <tr key={m.id} className="border-t">
                  <td className="p-2">{m.title}</td>
                  <td className="p-2">{m.startDate}</td>
                  <td className="p-2">{m.endDate}</td>
                  <td className="p-2">
                    {formatMoney({ currency: deal.deal.currency, minor: m.priceMinor })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <h2 className="text-xl">Transcript</h2>
        <ol className="mt-3 grid gap-3">
          {view?.turns.map((turn) => (
            <li key={turn.id} className="rounded border p-4">
              <p className="font-medium">
                Round {turn.round} · {turn.side} · {turn.kind}
              </p>
              <p>{turn.message}</p>
              {turn.totalMinor != null && (
                <p>
                  {formatMoney({ currency: deal.deal.currency, minor: turn.totalMinor })} · Ends{" "}
                  {turn.endDate}
                </p>
              )}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
