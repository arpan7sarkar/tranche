import { notFound } from "next/navigation";
import { Suspense } from "react";
import { NegotiationRoom } from "@/components/negotiation-room";
import { LoadingState } from "@/components/states";
import { getDb } from "@/server/db";
import { getDealView } from "@/server/deals";
import { latestNegotiation, loadNegotiationView } from "@/server/negotiations";
import { requireMember } from "@/server/session";

async function Room({ params }: { params: Promise<{ dealId: string }> }) {
  const member = await requireMember();
  const { dealId } = await params;
  const deal = await getDealView(getDb(), dealId, { workspaceId: member.workspaceId });
  if (!deal) notFound();
  const id = await latestNegotiation(getDb(), member.workspaceId, dealId);
  const initial = id ? await loadNegotiationView(getDb(), member.workspaceId, id) : null;
  return <NegotiationRoom deal={deal} initial={initial} />;
}
export default function Page(props: { params: Promise<{ dealId: string }> }) {
  return (
    <Suspense fallback={<LoadingState />}>
      <Room {...props} />
    </Suspense>
  );
}
