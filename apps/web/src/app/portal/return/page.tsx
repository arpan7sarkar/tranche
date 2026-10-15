import { CircleCheck } from "lucide-react";

// Token-less return target for timer-started funding; it confirms nothing and grants no access.
export default function PortalReturnPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
      <CircleCheck className="size-6 text-tone-released" aria-hidden />
      <h1 className="text-3xl">Thanks, PayPal has your approval</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The money stays with PayPal until you release the milestone, or your auto-release rule does.
        It shows as held once PayPal confirms the payment.
      </p>
      <p className="max-w-sm text-sm text-muted-foreground">
        You can close this tab. Use the link in your latest email from the agency to see the plan.
      </p>
    </div>
  );
}
