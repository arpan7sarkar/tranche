import { schema } from "@tranche/db";
import { eq } from "drizzle-orm";
import { Suspense } from "react";
import { ConnectPayPalButton } from "@/components/connect-paypal-button";
import { LoadingState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/server/db";
import { requireMember } from "@/server/session";

async function Connections() {
  const member = await requireMember();
  const [ws] = await getDb()
    .select()
    .from(schema.workspace)
    .where(eq(schema.workspace.id, member.workspaceId));
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
