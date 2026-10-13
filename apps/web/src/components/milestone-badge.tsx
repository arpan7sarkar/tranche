import type { MilestoneState } from "@tranche/contracts";
import { milestoneTone, type Tone } from "@/lib/milestone-tone";
import { cn } from "@/lib/utils";

export const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-tone-neutral/12 text-tone-neutral",
  progress: "bg-tone-progress/12 text-tone-progress",
  held: "bg-tone-held/15 text-tone-held",
  verifying: "bg-tone-verifying/12 text-tone-verifying",
  attention: "bg-tone-attention/15 text-tone-attention",
  released: "bg-tone-released/15 text-tone-released",
  danger: "bg-tone-danger/12 text-tone-danger",
};

export function MilestoneBadge({
  state,
  className,
}: {
  state: MilestoneState;
  className?: string;
}) {
  const { label, tone } = milestoneTone(state);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        TONE_CLASS[tone],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}
