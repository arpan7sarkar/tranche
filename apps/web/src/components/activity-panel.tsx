import { LocalTime } from "@/components/local-time";
import { describeEvent } from "@/lib/activity";
import type { DealView } from "@/server/deals";

export function ActivityPanel({ activity }: { activity: DealView["activity"] }) {
  if (activity.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Agent activity appears here as the deal moves.
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-3">
      {activity.map((e) => (
        <li key={e.id} className="flex flex-col gap-0.5 border-l-2 border-border pl-3">
          <span className="text-sm">{describeEvent(e.type, e.payload)}</span>
          <LocalTime at={e.createdAt} className="text-xs text-muted-foreground" />
        </li>
      ))}
    </ol>
  );
}
