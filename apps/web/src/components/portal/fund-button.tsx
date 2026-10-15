"use client";

import { loadCoreSdkScript, type OneTimePaymentSession } from "@paypal/paypal-js/sdk-v6";
import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Order = { orderId: string; approveUrl: string | null };
type Status = "loading" | "ready" | "busy" | "unavailable";
type Router = ReturnType<typeof useRouter>;

const FAKE_PAYPAL = process.env.NEXT_PUBLIC_E2E_FAKE_PAYPAL === "1";
const ORDER_WAIT_MS = 20_000;
const ORDER_POLL_MS = 1_500;

class Expired extends Error {}
class NotReady extends Error {}
class Charged extends Error {}

async function errorText(res: Response): Promise<string | undefined> {
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  return typeof body.error === "string" ? body.error : undefined;
}

// Funding opens once the money pipeline moves the milestone to `funding`, a few seconds after the plan is agreed.
async function requestOrder(token: string, milestoneId: string, agreeFirst: boolean) {
  if (agreeFirst) {
    const res = await fetch(`/api/portal/${token}/agree`, { method: "POST" });
    if (res.status === 404) throw new Expired();
    if (!res.ok) throw new Error(await errorText(res));
  }
  const deadline = Date.now() + ORDER_WAIT_MS;
  for (;;) {
    const res = await fetch(`/api/portal/${token}/milestones/${milestoneId}/fund`, {
      method: "POST",
    });
    if (res.ok) return (await res.json()) as Order;
    if (res.status === 404) throw new Expired();
    if (res.status !== 409) throw new Error(await errorText(res));
    if (Date.now() > deadline) throw new NotReady(await errorText(res));
    await new Promise((resolve) => setTimeout(resolve, ORDER_POLL_MS));
  }
}

async function confirmApproval(token: string, orderId: string, router: Router) {
  const res = await fetch(`/api/portal/${token}/orders/${orderId}/approved`, {
    method: "POST",
  }).catch(() => null);
  if (res?.ok) toast.success("Payment approved. PayPal holds the funds until you release them.");
  else toast.error("PayPal approved the payment. It shows here as soon as PayPal confirms it.");
  router.refresh();
}

export function FundButton({
  token,
  milestoneId,
  currency,
  label,
  testId,
  agreeFirst,
}: {
  token: string;
  milestoneId: string;
  currency: string;
  label: string;
  testId: string;
  agreeFirst: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(FAKE_PAYPAL ? "ready" : "loading");
  const [fakeOrderId, setFakeOrderId] = useState<string | null>(null);
  const session = useRef<OneTimePaymentSession | null>(null);
  const handledOwnFailure = useRef(false);

  useEffect(() => {
    if (FAKE_PAYPAL) return;
    let cancelled = false;
    (async () => {
      const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
      const paypal = clientId ? await loadCoreSdkScript({ environment: "sandbox" }) : null;
      if (!paypal || !clientId) throw new Error("PayPal SDK unavailable");
      const sdk = await paypal.createInstance({
        clientId,
        components: ["paypal-payments"],
        pageType: "checkout",
      });
      const eligible = await sdk.findEligibleMethods({ currencyCode: currency });
      if (cancelled) return;
      if (!eligible.isEligible("paypal")) return setStatus("unavailable");
      const created = sdk.createPayPalOneTimePaymentSession({
        onApprove: async ({ orderId }) => {
          await confirmApproval(token, orderId, router);
          setStatus("ready");
        },
        onCancel: () => {
          setStatus("ready");
          router.refresh();
        },
        onError: () => {
          if (!handledOwnFailure.current) toast.error("PayPal could not complete the payment.");
          setStatus("ready");
        },
      });
      session.current = created;
      setStatus("ready");
      if (created.hasReturned?.()) {
        setStatus("busy");
        await created.resume?.();
      }
    })().catch(() => {
      if (!cancelled) setStatus("unavailable");
    });
    return () => {
      cancelled = true;
    };
  }, [currency, token, router]);

  function settle(error: unknown) {
    handledOwnFailure.current = true;
    setStatus("ready");
    if (error instanceof Charged) {
      toast.success("Paid with your saved PayPal account. Funds are held until you release them.");
    } else if (error instanceof Expired) {
      toast.error("This link has expired. Ask the agency for a fresh one.");
    } else if (error instanceof NotReady) {
      toast.info(agreeFirst ? "Plan approved." : "This milestone is not ready to fund yet.", {
        description: error.message || "Funding opens shortly. This page updates on its own.",
      });
    } else {
      toast.error("Could not start the payment. Try again in a moment.");
    }
    router.refresh();
  }

  function fund() {
    handledOwnFailure.current = false;
    setStatus("busy");
    const order = requestOrder(token, milestoneId, agreeFirst).then((o) => {
      if (o.approveUrl === null) throw new Charged();
      return o;
    });
    order.catch(settle);
    if (FAKE_PAYPAL) {
      void order.then((o) => setFakeOrderId(o.orderId), () => {});
      return;
    }
    // Started synchronously in the click so browsers allow the PayPal window.
    session.current
      ?.start(
        { presentationMode: "auto" },
        order.then((o) => ({ orderId: o.orderId })),
      )
      .then((result) => {
        if (result?.redirectURL) window.location.assign(result.redirectURL);
      })
      .catch(() => {
        if (handledOwnFailure.current) return;
        toast.error("Could not open PayPal. Try again.");
        setStatus("ready");
      });
  }

  async function approveFake(orderId: string) {
    setStatus("busy");
    const res = await fetch(`/api/portal/${token}/orders/${orderId}/fake-approve`, {
      method: "POST",
    }).catch(() => null);
    if (res?.ok) {
      setFakeOrderId(null);
      await confirmApproval(token, orderId, router);
    } else {
      toast.error("The test PayPal server did not approve the order.");
    }
    setStatus("ready");
  }

  if (status === "unavailable") {
    return (
      <p className="text-sm text-destructive">PayPal is unavailable right now. Try again later.</p>
    );
  }
  if (fakeOrderId) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Button
          data-testid="fake-paypal-approve"
          disabled={status === "busy"}
          onClick={() => approveFake(fakeOrderId)}
        >
          Approve test payment
        </Button>
        <span className="text-xs text-muted-foreground">Test mode, no PayPal window opens.</span>
      </div>
    );
  }
  return (
    <Button
      data-testid={testId}
      onClick={fund}
      disabled={status !== "ready"}
      aria-busy={status !== "ready"}
      className="self-start"
    >
      {status === "ready" ? null : (
        <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
      )}
      {status === "busy" ? "Waiting for PayPal" : label}
    </Button>
  );
}
