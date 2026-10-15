import { Suspense } from "react";
import { ApprovalsList } from "@/components/approvals-list";
import { EmptyState, LoadingState } from "@/components/states";
import { listPendingApprovals } from "@/server/approvals";
import { getDb } from "@/server/db";
import { requireMember } from "@/server/session";

async function Pending() {
  const member = await requireMember();
  const approvals = await listPendingApprovals(getDb(), member.workspaceId);
  if (approvals.length === 0) {
    return (
      <EmptyState
        title="No approvals waiting"
        body="When an agent wants to do something outside your rules, it shows up here."
      />
    );
  }
  return <ApprovalsList approvals={approvals} />;
}

export default function ApprovalsPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-4xl">Approvals</h1>
        <p className="text-sm text-muted-foreground">
          Agent proposals that need a person before anything happens.
        </p>
      </div>
      <Suspense fallback={<LoadingState rows={3} />}>
        <Pending />
      </Suspense>
    </div>
  );
}
