import type { DealStatus } from "@tranche/contracts";
import { TONE_CLASS } from "@/components/milestone-badge";
import type { Tone } from "@/lib/milestone-tone";
import { cn } from "@/lib/utils";

const STATUS: Record<DealStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "Awaiting client review", tone: "progress" },
  negotiating: { label: "Negotiating", tone: "attention" },
  agreed: { label: "Agreed", tone: "verifying" },
  active: { label: "Active", tone: "progress" },
  completed: { label: "Completed", tone: "released" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export function DealStatusBadge({ status, className }: { status: DealStatus; className?: string }) {
  const { label, tone } = STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE_CLASS[tone],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}
