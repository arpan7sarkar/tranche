import { Link2Off } from "lucide-react";

export default function PortalNotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
      <Link2Off className="size-6 text-muted-foreground" aria-hidden />
      <h1 className="text-3xl">This link has expired or is invalid</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Ask the agency to send you a fresh link. Your payments are safe with PayPal in the meantime.
      </p>
    </div>
  );
}
