import Link from "next/link";
import { Suspense } from "react";
import { DealStatusBadge } from "@/components/deal-status-badge";
import { EmptyState, LoadingState } from "@/components/states";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney } from "@/lib/money";
import { getDb } from "@/server/db";
import { listDeals } from "@/server/deals";
import { requireMember } from "@/server/session";

async function Deals() {
  const member = await requireMember();
  const deals = await listDeals(getDb(), member.workspaceId);
  if (deals.length === 0) {
    return (
      <EmptyState
        title="No deals yet"
        body="Paste a client brief and the planner agent turns it into priced milestones."
        action={
          <Button render={<Link href="/deals/new" />} nativeButton={false}>
            Start a deal
          </Button>
        }
      />
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Deal</TableHead>
          <TableHead className="hidden sm:table-cell">Client</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {deals.map((d) => (
          <TableRow key={d.id}>
            <TableCell className="whitespace-normal">
              <Link className="font-medium hover:underline" href={`/deals/${d.id}`}>
                {d.title}
              </Link>
              <span className="block text-xs text-muted-foreground sm:hidden">{d.clientName}</span>
            </TableCell>
            <TableCell className="hidden sm:table-cell">{d.clientName}</TableCell>
            <TableCell>
              <DealStatusBadge status={d.status} />
            </TableCell>
            <TableCell className="tabular text-right">{formatMoney(d.total)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function DealsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <h1 className="text-4xl">Deals</h1>
        <Button render={<Link href="/deals/new" />} nativeButton={false}>
          New deal
        </Button>
      </div>
      <Suspense fallback={<LoadingState />}>
        <Deals />
      </Suspense>
    </div>
  );
}
