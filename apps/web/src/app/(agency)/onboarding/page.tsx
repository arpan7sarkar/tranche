import { gmailConfig } from "@tranche/agents-service/gmail";
import { schema } from "@tranche/db";
import { SELLER_FEATURES, type SellerFeature } from "@tranche/paypal";
import { and, eq } from "drizzle-orm";
import { Suspense } from "react";
import { ConnectPayPalButton } from "@/components/connect-paypal-button";
import { GmailConnection } from "@/components/gmail-connection";
import { LocalTime } from "@/components/local-time";
import { LoadingState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/server/db";
import { completeOnboarding, needsSellerRecheck } from "@/server/onboarding";
import { getPayPal, holdMechanism } from "@/server/paypal";
import { requireMember } from "@/server/session";

const FEATURE_LABELS: Record<SellerFeature, string> = {
  PAYMENT: "take payments",
  REFUND: "issue refunds",
  PARTNER_FEE: "collect the platform fee",
  DELAY_FUNDS_DISBURSEMENT: "hold funds until release",
  VAULT: "save the client's payment method",
};

async function loadWorkspace(workspaceId: string) {
  const [ws] = await getDb()
    .select()
    .from(schema.workspace)
    .where(eq(schema.workspace.id, workspaceId));
  return ws;
}

function CheckAgainButton() {
  return (
    <Button
      variant="outline"
      nativeButton={false}
      render={<a href="/api/paypal/onboarding/return" />}
    >
      Check again
    </Button>
  );
}

type SearchParams = Promise<{ paypalCheck?: string; gmail?: string }>;

async function Connections({ searchParams }: { searchParams: SearchParams }) {
  const member = await requireMember();
  const [gmailRows, ownerRows] = await Promise.all([
    getDb()
      .select({ email: schema.gmailConnection.email })
      .from(schema.gmailConnection)
      .where(eq(schema.gmailConnection.workspaceId, member.workspaceId)),
    getDb()
      .select({ role: schema.workspaceMember.role })
      .from(schema.workspaceMember)
      .where(
        and(
          eq(schema.workspaceMember.workspaceId, member.workspaceId),
          eq(schema.workspaceMember.userId, member.userId),
        ),
      ),
  ]);
  let ws = await loadWorkspace(member.workspaceId);
  let checkFailed = (await searchParams).paypalCheck === "failed";
  if (ws && needsSellerRecheck(ws)) {
    try {
      await completeOnboarding(getDb(), getPayPal(), {
        workspaceId: member.workspaceId,
        mechanism: holdMechanism(),
      });
      ws = await loadWorkspace(member.workspaceId);
    } catch (err) {
      checkFailed = true;
      console.error("PayPal seller status check failed", err);
    }
  }
  const missingFeatures = SELLER_FEATURES.filter((f) => ws?.paypalMissingFeatures.includes(f));
  const githubUrl = process.env.NEXT_PUBLIC_GITHUB_APP_INSTALL_URL;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <GmailConnection
        configured={Boolean(gmailConfig())}
        owner={ownerRows[0]?.role === "owner"}
        email={gmailRows[0]?.email ?? null}
        result={(await searchParams).gmail}
      />
      <Card>
        <CardHeader>
          <CardTitle>PayPal</CardTitle>
          <CardDescription>
            Clients pay you through PayPal. Tranche never holds your money.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {checkFailed || ws?.paypalCheckError ? (
            <div className="flex flex-col items-start gap-3" role="alert">
              <p className="text-sm text-destructive">
                {ws?.paypalCheckError === "authorization"
                  ? "PayPal denied the connection check. Check your sandbox app's partner permissions and platform account configuration."
                  : "We could not check your PayPal connection. Please try again shortly."}
              </p>
              <p className="text-xs text-muted-foreground">Checks can be retried once a minute.</p>
              <CheckAgainButton />
            </div>
          ) : ws?.paypalOnboarding === "active" ? (
            <p className="text-sm">
              Connected as <span className="tabular">{ws.paypalMerchantId}</span>
            </p>
          ) : missingFeatures.length > 0 ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-muted-foreground">
                PayPal did not grant every permission Tranche needs. Missing:{" "}
                {missingFeatures.map((f) => FEATURE_LABELS[f]).join(", ")}. Connect again and
                approve all of them.
              </p>
              {ws?.paypalCheckedAt ? (
                <p className="text-xs text-muted-foreground">
                  Last checked <LocalTime at={ws.paypalCheckedAt.toISOString()} />
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <ConnectPayPalButton />
                <CheckAgainButton />
              </div>
            </div>
          ) : ws?.paypalOnboarding === "pending" ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-muted-foreground">
                Waiting for PayPal to confirm your account.
              </p>
              <ConnectPayPalButton label="Continue PayPal setup" />
              <ConnectPayPalButton label="Start new PayPal setup" fresh />
              <CheckAgainButton />
            </div>
          ) : (
            <ConnectPayPalButton />
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>GitHub</CardTitle>
          <CardDescription>
            Lets the verifier see merged pull requests and CI results.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {githubUrl ? (
            <Button variant="outline" nativeButton={false} render={<a href={githubUrl} />}>
              Connect GitHub
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              GitHub App is not configured on this server.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function OnboardingPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <h1 className="text-4xl">Connections</h1>
      <Suspense fallback={<LoadingState rows={2} />}>
        <Connections searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
