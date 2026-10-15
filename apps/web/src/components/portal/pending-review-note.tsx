import { Clock } from "lucide-react";

export function PendingReviewNote({ milestoneKey }: { milestoneKey: string }) {
  return (
    <p
      className="flex items-start gap-2 text-sm text-muted-foreground"
      data-testid={`pending-review-${milestoneKey}`}
    >
      <Clock className="mt-0.5 size-4 shrink-0 text-tone-attention" aria-hidden />
      PayPal is reviewing your payment. There is nothing you need to do, and this page updates on
      its own once it clears.
    </p>
  );
}
