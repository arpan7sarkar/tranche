"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApprovalCard } from "@/components/approval-card";
import type { DealView } from "@/server/deals";

type ListedApproval = DealView["approvals"][number] & {
  milestoneTitle: string | null;
  dealId?: string;
  dealTitle?: string;
};

export function ApprovalsList({
  approvals,
  decideBase,
}: {
  approvals: ListedApproval[];
  decideBase: string;
}) {
  const router = useRouter();
  return (
    <ul className="flex flex-col gap-3">
      {approvals.map((a) => (
        <li key={a.id}>
          <ApprovalCard
            approval={a}
            decideUrl={`${decideBase}/${a.id}/decide`}
            milestoneTitle={a.milestoneTitle}
            onDone={() => router.refresh()}
            context={
              a.dealId && a.dealTitle ? (
                <Link
                  href={`/deals/${a.dealId}`}
                  className="self-start text-xs text-muted-foreground break-words hover:text-foreground hover:underline"
                >
                  {a.dealTitle}
                </Link>
              ) : null
            }
          />
        </li>
      ))}
    </ul>
  );
}
