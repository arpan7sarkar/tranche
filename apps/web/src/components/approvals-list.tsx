"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApprovalCard } from "@/components/approval-card";
import type { PendingApproval } from "@/server/approvals";

export function ApprovalsList({ approvals }: { approvals: PendingApproval[] }) {
  const router = useRouter();
  return (
    <ul className="flex flex-col gap-3">
      {approvals.map((a) => (
        <li key={a.id}>
          <ApprovalCard
            approval={a}
            decideUrl={`/api/approvals/${a.id}/decide`}
            milestoneTitle={a.milestoneTitle}
            onDone={() => router.refresh()}
            context={
              <Link
                href={`/deals/${a.dealId}`}
                className="self-start text-xs text-muted-foreground break-words hover:text-foreground hover:underline"
              >
                {a.dealTitle}
              </Link>
            }
          />
        </li>
      ))}
    </ul>
  );
}
