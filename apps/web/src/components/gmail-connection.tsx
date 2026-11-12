"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function GmailConnection({
  configured,
  owner,
  email,
  result,
}: {
  configured: boolean;
  owner: boolean;
  email: string | null;
  result?: string;
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function act(action: "connect" | "disconnect") {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/gmail/${action}`, { method: "POST" });
      if (!response.ok) throw new Error("request_failed");
      const data = (await response.json()) as { url?: string };
      if (action === "connect" && data.url) {
        window.location.assign(data.url);
        return;
      }
      router.replace("/onboarding");
      router.refresh();
    } catch {
      setError("Could not update the Gmail connection. Please try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Gmail</CardTitle>
        <CardDescription>
          Send client project emails from your Google account, branded with your name and Tranche.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {email ? (
          <p className="break-words text-sm">
            Connected as <strong>{email}</strong>. Client notifications in this workspace use this
            account.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Connect Gmail to send client notifications. Tranche requests permission to send, without
            reading your inbox.
          </p>
        )}
        {!configured && (
          <p className="text-sm text-muted-foreground">Gmail is not configured on this server.</p>
        )}
        {(result === "failed" || result === "denied" || error) && (
          <p role="alert" className="text-sm text-destructive">
            {error ||
              (result === "denied"
                ? "Google authorization was cancelled. Your existing connection was kept."
                : "Could not connect Gmail. Check your Google test-user access, send permission, and callback URL, then try again.")}
          </p>
        )}
        {result === "connected" && email && (
          <p role="status" className="text-sm text-tone-released">
            Gmail connected. Sending a plan can now queue email from this account.
          </p>
        )}
        {owner && configured ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => act("connect")} disabled={pending || !ready}>
              {pending || !ready ? "Please wait..." : email ? "Reconnect Gmail" : "Connect Gmail"}
            </Button>
            {email && (
              <Button
                type="button"
                variant="outline"
                onClick={() => act("disconnect")}
                disabled={pending || !ready}
              >
                Disconnect Gmail
              </Button>
            )}
          </div>
        ) : (
          !owner && (
            <p className="text-sm text-muted-foreground">
              Only the workspace owner can change this connection.
            </p>
          )
        )}
        <p className="text-xs text-muted-foreground">
          Connecting does not send a test email. Pending client notifications can be sent by the
          running notification worker.
        </p>
      </CardContent>
    </Card>
  );
}
