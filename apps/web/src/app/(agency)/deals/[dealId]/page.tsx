import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DealWorkspace } from "@/components/deal-workspace";
import { LoadingState } from "@/components/states";
import { getDb } from "@/server/db";
import { getDealView } from "@/server/deals";
import { requireMember } from "@/server/session";

async function Workspace({ params }: { params: Promise<{ dealId: string }> }) {
  const member = await requireMember();
  const { dealId } = await params;
  const view = await getDealView(getDb(), dealId, { workspaceId: member.workspaceId });
  if (!view) notFound();
  return <DealWorkspace initialView={view} />;
}

export default function DealPage({ params }: PageProps<"/deals/[dealId]">) {
  return (
    <Suspense fallback={<LoadingState rows={10} />}>
      <Workspace params={params} />
    </Suspense>
  );
}
