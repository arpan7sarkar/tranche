"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PlanSharing } from "@/server/plan-sharing";

const EMAIL_STATUS: Record<PlanSharing["emailStatus"], string> = {
  unconfigured:
    "Automatic email is not configured. Connect Gmail in Connections, or share the client link manually.",
  queued: "Email queued. Waiting for the notification worker.",
  pending: "Email queued. Waiting for the notification worker.",
  sending:
    "Email submission is pending confirmation. Check again shortly; an uncertain Gmail send needs review.",
  sent: "Email accepted by the email provider. Inbox delivery is not confirmed.",
  review: "Email needs attention. Share the client link manually.",
  cancelled: "Email was cancelled. Share a new client link manually.",
};

export function PlanSharingPanel({
  dealId,
  clientEmail,
  initialUrl,
}: {
  dealId: string;
  clientEmail: string;
  initialUrl: string | null;
}) {
  const [status, setStatus] = useState<PlanSharing>();
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    if (initialUrl) setUrl(initialUrl);
  }, [initialUrl]);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch(`/api/deals/${dealId}/sharing`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("status");
        const next = (await response.json()) as PlanSharing;
        if (!controller.signal.aborted) {
          setStatus(next);
          setError("");
        }
      } catch {
        if (!controller.signal.aborted)
          setError("Could not refresh sharing status. Retrying automatically.");
      }
    };
    void load();
    const interval = setInterval(() => {
      void load();
    }, 10_000);
    document.addEventListener("visibilitychange", load);
    return () => {
      controller.abort();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", load);
    };
  }, [dealId]);

  async function copyLink() {
    setPending(true);
    setFeedback("");
    try {
      let link = url;
      if (!link) {
        const response = await fetch(`/api/deals/${dealId}/sharing`, { method: "POST" });
        if (!response.ok) throw new Error("link");
        link = ((await response.json()) as { portalUrl: string }).portalUrl;
        setUrl(link);
      }
      try {
        await navigator.clipboard.writeText(link);
        setFeedback("Client link copied. Share it privately with your client.");
      } catch {
        setFeedback("Select and copy the client link below.");
      }
    } catch {
      setFeedback("Could not create the client link. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-label="Client sharing" className="space-y-3 rounded-lg border bg-card p-4 sm:p-5">
      <h2 className="text-lg font-semibold">Client sharing</h2>
      <p className="break-words text-sm text-muted-foreground">Client: {clientEmail}</p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!status && !error && (
        <p role="status" className="text-sm text-muted-foreground">
          Checking sharing status...
        </p>
      )}
      {status && (
        <div className="space-y-2 text-sm">
          <p>{EMAIL_STATUS[status.emailStatus]}</p>
          {status.senderEmail && (
            <p className="break-words text-muted-foreground">
              Client emails use {status.senderEmail} via Tranche.
            </p>
          )}
          {status.sentAt && (
            <p className="text-muted-foreground">
              Submitted: {new Date(status.sentAt).toLocaleString()}
            </p>
          )}
          <p>
            {status.openedAt
              ? `Portal first opened: ${new Date(status.openedAt).toLocaleString()}`
              : "Portal has not been opened yet."}
          </p>
          <p className="text-muted-foreground">
            An open records someone viewing the private link. It does not confirm their identity or
            acceptance.
          </p>
          {status.localOnly && (
            <p className="font-medium text-tone-attention">
              This link uses localhost and cannot be opened by a remote client. Use a publicly
              accessible app URL before sharing externally.
            </p>
          )}
        </div>
      )}
      <Button type="button" onClick={copyLink} disabled={pending || (!status && !error)}>
        {pending ? "Preparing link..." : url ? "Copy client link" : "Create client link"}
      </Button>
      {url && (
        <div className="space-y-1">
          <label htmlFor={`client-link-${dealId}`} className="text-sm font-medium">
            Private client link
          </label>
          <Input
            id={`client-link-${dealId}`}
            readOnly
            value={url}
            onFocus={(event) => event.target.select()}
          />
          <p className="text-xs text-muted-foreground">
            Anyone with this link can access the client portal. Share it only with your client.
          </p>
        </div>
      )}
      <p role="status" className="text-sm">
        {feedback}
      </p>
    </section>
  );
}
