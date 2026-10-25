import { Suspense } from "react";
import { BriefPlanner } from "@/components/brief-planner";
import { LoadingState } from "@/components/states";
import { requireMember } from "@/server/session";

async function Form({ searchParams }: { searchParams: Promise<{ draft?: string }> }) {
  await requireMember();
  const { draft } = await searchParams;
  return <BriefPlanner initialDealId={draft ?? null} />;
}
export default function NewDealPage(props: { searchParams: Promise<{ draft?: string }> }) {
  return (
    <div className="grid gap-6">
      <h1 className="text-4xl">New deal</h1>
      <Suspense fallback={<LoadingState />}>
        <Form {...props} />
      </Suspense>
    </div>
  );
}
