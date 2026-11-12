"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const FAILED = "PayPal onboarding could not start. Try again.";

export function ConnectPayPalButton({
  label = "Connect PayPal",
  fresh = false,
}: {
  label?: string;
  fresh?: boolean;
}) {
  const attemptId = useRef<string | null>(null);
  const [pending, setPending] = useState(false);

  async function connect() {
    setPending(true);
    try {
      if (fresh) attemptId.current ??= crypto.randomUUID();
      const res = await fetch("/api/paypal/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(fresh ? { attemptId: attemptId.current } : {}),
      });
      const body = res.ok ? ((await res.json()) as { actionUrl?: string }) : null;
      if (!body?.actionUrl) {
        toast.error(FAILED);
        setPending(false);
        return;
      }
      window.location.assign(body.actionUrl);
    } catch {
      toast.error(FAILED);
      setPending(false);
    }
  }

  return (
    <Button onClick={connect} disabled={pending} aria-busy={pending}>
      {pending ? "Opening PayPal" : label}
    </Button>
  );
}
