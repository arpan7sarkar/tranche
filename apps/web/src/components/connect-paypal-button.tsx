"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const FAILED = "PayPal onboarding could not start. Try again.";

export function ConnectPayPalButton() {
  const [pending, setPending] = useState(false);

  async function connect() {
    setPending(true);
    try {
      const res = await fetch("/api/paypal/onboarding", { method: "POST" });
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
      {pending ? "Opening PayPal" : "Connect PayPal"}
    </Button>
  );
}
