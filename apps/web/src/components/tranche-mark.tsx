import { Layers2 } from "lucide-react";

export function TrancheMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-background)] text-[var(--brand-foreground)] ${className}`}
      aria-hidden="true"
    >
      <Layers2 className="size-5" strokeWidth={1.7} />
    </span>
  );
}
