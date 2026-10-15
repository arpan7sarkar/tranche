import { ArrowLeft, CircleCheck, CircleDashed, CircleX } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MilestoneBadge } from "@/components/milestone-badge";
import { PendingReviewNote } from "@/components/portal/pending-review-note";
import { PortalLive } from "@/components/portal/portal-live";
import { ReleaseButton } from "@/components/portal/release-button";
import { LoadingState } from "@/components/states";
import { describeCheck } from "@/lib/criteria";
import { formatMoney } from "@/lib/money";
import { getDb } from "@/server/db";
import { type DealView, getDealView } from "@/server/deals";
import { resolvePortalToken, submittedClientReleases } from "@/server/portal";

type EvidenceItem = DealView["milestones"][number]["evidence"][number];

function imageUrlOf(e: EvidenceItem): string | null {
  const url = typeof e.data.imageUrl === "string" ? URL.parse(e.data.imageUrl) : null;
  return url && (url.protocol === "https:" || url.protocol === "http:") ? url.href : null;
}

function CheckIcon({ passed }: { passed: boolean | undefined | null }) {
  if (passed === true) {
    return (
      <CircleCheck className="mt-0.5 size-4 shrink-0 text-tone-released" aria-label="Passed" />
    );
  }
  if (passed === false) {
    return <CircleX className="mt-0.5 size-4 shrink-0 text-tone-danger" aria-label="Failed" />;
  }
  return (
    <CircleDashed
      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
      aria-label="Not checked yet"
    />
  );
}

async function Evidence({ params }: { params: Promise<{ token: string; milestoneId: string }> }) {
  const { token, milestoneId } = await params;
  const link = await resolvePortalToken(token);
  if (!link) notFound();
  const db = getDb();
  const [view, releases] = await Promise.all([
    getDealView(db, link.dealId, { clientId: link.clientId }),
    submittedClientReleases(db, link.dealId),
  ]);
  const m = view?.milestones.find((x) => x.id === milestoneId);
  if (!view || !m) notFound();

  const amount = formatMoney({ currency: view.deal.currency, minor: m.priceMinor });
  const latest = (i: number) => m.evidence.find((e) => e.checkIndex === i);
  const verdict = m.evidence.find((e) => e.kind === "ai_verdict");
  const screenshots = m.evidence.flatMap((e) => {
    const src = e.kind === "screenshot" ? imageUrlOf(e) : null;
    return src ? [{ id: e.id, src, alt: e.summary }] : [];
  });

  return (
    <div className="flex flex-col gap-8">
      <PortalLive dealId={view.deal.id} token={token} since={view.activity[0]?.id} />
      <Link
        href={`/portal/${token}`}
        className="flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to the plan
      </Link>

      <header
        data-testid={`milestone-${m.key}`}
        data-state={m.state}
        className="flex flex-col gap-2"
      >
        <p className="text-sm text-muted-foreground break-words">{view.deal.title}</p>
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <h1 className="min-w-0 text-4xl break-words">{m.title}</h1>
          <span className="tabular text-lg">{amount}</span>
        </div>
        <MilestoneBadge
          state={m.state}
          pendingReview={m.hold?.pendingReview}
          className="self-start"
        />
        {m.state === "funding" && m.hold?.pendingReview ? (
          <PendingReviewNote milestoneKey={m.key} />
        ) : null}
      </header>

      {m.state === "release_pending" ? (
        <section className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:p-5">
          <p className="text-sm">
            Every check passed. Releasing tells PayPal to pay the agency for this milestone.
          </p>
          <ReleaseButton
            token={token}
            milestoneId={m.id}
            milestoneKey={m.key}
            amount={amount}
            submitted={releases.has(m.id)}
          />
        </section>
      ) : null}

      <section aria-labelledby="checks-heading" className="flex flex-col gap-3">
        <h2 id="checks-heading" className="text-2xl">
          Checks
        </h2>
        {m.criteria.checks.length === 0 && m.criteria.prose.length === 0 ? (
          <p className="text-sm text-muted-foreground">No checks were set for this milestone.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border bg-card">
            {m.criteria.checks.map((c, i) => {
              const e = latest(i);
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: check order is the check identity
                <li key={`c${i}`} className="flex items-start gap-3 px-4 py-3">
                  <CheckIcon passed={e?.passed} />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm break-words">{describeCheck(c)}</span>
                    {e?.summary ? (
                      <span className="text-xs break-words text-muted-foreground">{e.summary}</span>
                    ) : null}
                  </div>
                </li>
              );
            })}
            {m.criteria.prose.map((p, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: criteria are fixed for a milestone
              <li key={`p${i}`} className="flex items-start gap-3 px-4 py-3">
                <CircleDashed
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  aria-label="Reviewed by the verifier"
                />
                <span className="text-sm break-words">{p}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {verdict ? (
        <section aria-labelledby="notes-heading" className="flex flex-col gap-2">
          <h2 id="notes-heading" className="text-2xl">
            Reviewer notes
          </h2>
          <p className="text-sm whitespace-pre-wrap break-words">{verdict.summary}</p>
        </section>
      ) : null}

      {screenshots.length > 0 ? (
        <section aria-labelledby="screens-heading" className="flex flex-col gap-3">
          <h2 id="screens-heading" className="text-2xl">
            Screenshots
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {screenshots.map((s) => (
              // biome-ignore lint/performance/noImgElement: evidence images are external and unoptimized by design
              <img
                key={s.id}
                src={s.src}
                alt={s.alt}
                loading="lazy"
                referrerPolicy="no-referrer"
                className="w-full rounded-md border bg-muted"
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export default function MilestoneEvidencePage({
  params,
}: PageProps<"/portal/[token]/milestones/[milestoneId]">) {
  return (
    <Suspense fallback={<LoadingState rows={5} />}>
      <Evidence params={params} />
    </Suspense>
  );
}
