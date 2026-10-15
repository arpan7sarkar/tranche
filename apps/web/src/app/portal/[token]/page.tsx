import { ArrowRight, CircleCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ApprovalsList } from "@/components/approvals-list";
import { MilestoneBadge } from "@/components/milestone-badge";
import { AutoReleaseForm } from "@/components/portal/auto-release-form";
import { FundButton } from "@/components/portal/fund-button";
import { PendingReviewNote } from "@/components/portal/pending-review-note";
import { PortalLive } from "@/components/portal/portal-live";
import { ReleaseButton } from "@/components/portal/release-button";
import { EmptyState, LoadingState } from "@/components/states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { describeCheck } from "@/lib/criteria";
import { formatDay } from "@/lib/dates";
import { formatMoney, totalOf } from "@/lib/money";
import { getDb } from "@/server/db";
import { type DealView, getDealView } from "@/server/deals";
import { resolvePortalToken, submittedClientReleases } from "@/server/portal";

type Milestone = DealView["milestones"][number];

function MilestoneAction({
  milestone: m,
  token,
  currency,
  releaseSubmitted,
}: {
  milestone: Milestone;
  token: string;
  currency: string;
  releaseSubmitted: boolean;
}) {
  const amount = formatMoney({ currency, minor: m.priceMinor });
  if (m.state === "funding" && m.hold?.pendingReview) {
    return <PendingReviewNote milestoneKey={m.key} />;
  }
  if (m.state === "funding") {
    return (
      <FundButton
        token={token}
        milestoneId={m.id}
        currency={currency}
        label={`Fund ${amount}`}
        testId={`fund-${m.key}`}
        agreeFirst={false}
      />
    );
  }
  if (m.state === "release_pending") {
    return (
      <ReleaseButton
        token={token}
        milestoneId={m.id}
        milestoneKey={m.key}
        amount={amount}
        submitted={releaseSubmitted}
      />
    );
  }
  if (m.state === "agreed" && m.fundDueAt) {
    return (
      <p className="text-sm text-muted-foreground">
        {new Date(m.fundDueAt) <= new Date() ? (
          "Funding opens shortly."
        ) : (
          <>
            Funding opens <span className="tabular">{formatDay(m.fundDueAt)}</span>, a few days
            before work starts.
          </>
        )}
      </p>
    );
  }
  return null;
}

function MilestoneItem({
  milestone: m,
  token,
  currency,
  releaseSubmitted,
}: {
  milestone: Milestone;
  token: string;
  currency: string;
  releaseSubmitted: boolean;
}) {
  const href = `/portal/${token}/milestones/${m.id}`;
  const terms = [...m.criteria.checks.map(describeCheck), ...m.criteria.prose];
  return (
    <li
      data-testid={`milestone-${m.key}`}
      data-state={m.state}
      className="flex flex-col gap-4 rounded-lg border bg-card p-4 sm:p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h3 className="font-medium break-words">
            <Link href={href} className="hover:underline">
              {m.title}
            </Link>
          </h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <MilestoneBadge state={m.state} pendingReview={m.hold?.pendingReview} />
            {m.startDate && m.endDate ? (
              <span className="tabular text-xs text-muted-foreground">
                {formatDay(m.startDate)} - {formatDay(m.endDate)}
              </span>
            ) : null}
          </div>
        </div>
        <span className="tabular shrink-0 text-lg">
          {formatMoney({ currency, minor: m.priceMinor })}
        </span>
      </div>
      {terms.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-muted-foreground">Paid when</p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            {terms.map((t, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: criteria are fixed for a milestone
              <li key={i} className="break-words">
                {t}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <MilestoneAction
        milestone={m}
        token={token}
        currency={currency}
        releaseSubmitted={releaseSubmitted}
      />
      {m.evidence.length > 0 ? (
        <Link
          href={href}
          className="flex items-center gap-1 self-start text-sm font-medium hover:underline"
        >
          Review checks and evidence
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      ) : null}
    </li>
  );
}

async function Portal({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const link = await resolvePortalToken(token);
  if (!link) notFound();
  const db = getDb();
  const [view, releases, query] = await Promise.all([
    getDealView(db, link.dealId, { clientId: link.clientId }),
    submittedClientReleases(db, link.dealId),
    searchParams,
  ]);
  if (!view) notFound();

  const { currency } = view.deal;
  const first = view.milestones[0];
  const canAgree = view.deal.status === "sent" || view.deal.status === "negotiating";
  const funded = view.milestones.find((m) => m.id === query.funded);
  const titleOf = (payload: DealView["approvals"][number]["payload"]) => {
    const id = "milestoneId" in payload ? payload.milestoneId : null;
    return view.milestones.find((m) => m.id === id)?.title ?? null;
  };

  return (
    <div className="flex flex-col gap-8">
      <PortalLive dealId={view.deal.id} token={token} since={view.activity[0]?.id} />
      <header className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground break-words">
          {view.deal.agencyName} for {view.deal.clientName}
        </p>
        <h1 className="text-4xl break-words">{view.deal.title}</h1>
        <p className="text-sm text-muted-foreground">
          <span className="tabular text-lg text-foreground">
            {formatMoney(
              totalOf(
                currency,
                view.milestones.map((m) => m.priceMinor),
              ),
            )}
          </span>{" "}
          across {view.milestones.length}{" "}
          {view.milestones.length === 1 ? "milestone" : "milestones"}
        </p>
      </header>

      {funded ? (
        <Alert>
          <CircleCheck className="text-tone-released" />
          <AlertTitle>PayPal approved your payment for {funded.title}</AlertTitle>
          <AlertDescription>
            It shows as held once PayPal confirms. Nothing reaches the agency until you release it.
          </AlertDescription>
        </Alert>
      ) : null}

      {canAgree && first ? (
        <section
          aria-labelledby="agree-heading"
          className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:p-5"
        >
          <h2 id="agree-heading" className="text-2xl">
            Ready to start?
          </h2>
          <p className="text-sm text-muted-foreground">
            Approving accepts this plan and funds the first milestone. PayPal holds the money, and
            the agency is paid only when you release each milestone.
          </p>
          <FundButton
            token={token}
            milestoneId={first.id}
            currency={currency}
            label={`Approve plan and fund ${formatMoney({ currency, minor: first.priceMinor })}`}
            testId="approve-plan"
            agreeFirst
          />
        </section>
      ) : null}

      {view.approvals.length > 0 ? (
        <section aria-labelledby="waiting-heading" className="flex flex-col gap-3">
          <h2 id="waiting-heading" className="text-2xl">
            Waiting on you
          </h2>
          <ApprovalsList
            approvals={view.approvals.map((a) => ({ ...a, milestoneTitle: titleOf(a.payload) }))}
            decideBase={`/api/portal/${token}/approvals`}
          />
        </section>
      ) : null}

      <section aria-labelledby="milestones-heading" className="flex flex-col gap-4">
        <h2 id="milestones-heading" className="text-2xl">
          Milestones
        </h2>
        {view.milestones.length === 0 ? (
          <EmptyState
            title="No milestones yet"
            body="The agency has not added milestones to this plan. This page updates on its own."
          />
        ) : (
          <ol className="flex flex-col gap-4">
            {view.milestones.map((m) => (
              <MilestoneItem
                key={m.id}
                milestone={m}
                token={token}
                currency={currency}
                releaseSubmitted={releases.has(m.id)}
              />
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="rules-heading" className="flex flex-col gap-3">
        <h2 id="rules-heading" className="text-2xl">
          Your rules
        </h2>
        <AutoReleaseForm
          token={token}
          current={view.deal.clientPolicy?.autoReleaseAfterHours ?? null}
        />
        <p className="text-xs text-muted-foreground">
          Funds stay with PayPal until you release them or your rule does.
        </p>
      </section>
    </div>
  );
}

export default function PortalPage({ params, searchParams }: PageProps<"/portal/[token]">) {
  return (
    <Suspense fallback={<LoadingState rows={6} />}>
      <Portal params={params} searchParams={searchParams} />
    </Suspense>
  );
}
