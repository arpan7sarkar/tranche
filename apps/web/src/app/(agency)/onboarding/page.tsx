import { schema } from "@tranche/db";
import { SELLER_FEATURES, type SellerFeature } from "@tranche/paypal";
import { eq } from "drizzle-orm";
import { Suspense } from "react";
import { ConnectPayPalButton } from "@/components/connect-paypal-button";
import { LoadingState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatInstant } from "@/lib/dates";
import { getDb } from "@/server/db";
import { requireMember } from "@/server/session";

const FEATURE_LABELS: Record<SellerFeature, string> = {
  PAYMENT: "take payments",
  REFUND: "issue refunds",
  PARTNER_FEE: "collect the platform fee",
  DELAY_FUNDS_DISBURSEMENT: "hold funds until release",
  VAULT: "save the client's payment method",
};

async function Connections() {
  const member = await requireMember();
  const [ws] = await getDb()
    .select()
    .from(schema.workspace)
    .where(eq(schema.workspace.id, member.workspaceId));
  const missingFeatures = SELLER_FEATURES.filter((f) => ws?.paypalMissingFeatures.includes(f));
  const githubUrl = process.env.NEXT_PUBLIC_GITHUB_APP_INSTALL_URL;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>PayPal</CardTitle>
          <CardDescription>
            Clients pay you through PayPal. Tranche never holds your money.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {ws?.paypalOnboarding === "active" ? (
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
                  Last checked{" "}
                  <time className="tabular" dateTime={ws.paypalCheckedAt.toISOString()}>
                    {formatInstant(ws.paypalCheckedAt)}
                  </time>
                </p>
              ) : null}
              <ConnectPayPalButton />
            </div>
          ) : ws?.paypalOnboarding === "pending" ? (
            <p className="text-sm text-muted-foreground">
              Waiting for PayPal to confirm your account.
            </p>
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

export default function OnboardingPage() {
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <h1 className="text-4xl">Connections</h1>
      <Suspense fallback={<LoadingState rows={2} />}>
        <Connections />
      </Suspense>
    </div>
  );
}
