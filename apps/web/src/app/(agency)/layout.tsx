import { type ReactNode, Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { LoadingState } from "@/components/states";
import { requireMember } from "@/server/session";

async function Shell({ children }: { children: ReactNode }) {
  const member = await requireMember();
  return (
    <AppShell user={{ name: member.name, workspaceName: member.workspaceName }}>
      {children}
    </AppShell>
  );
}

export default function AgencyLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="p-8">
          <LoadingState />
        </div>
      }
    >
      <Shell>{children}</Shell>
    </Suspense>
  );
}
