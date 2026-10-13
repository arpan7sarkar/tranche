import Link from "next/link";
import { type ReactNode, Suspense } from "react";
import { MainNav, NavLinks } from "@/components/main-nav";
import { SignOutButton } from "@/components/sign-out-button";

export function AppShell({
  user,
  children,
}: {
  user: { name: string; workspaceName: string };
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-screen grid-cols-1 grid-rows-[auto_1fr] md:grid-cols-[232px_1fr] md:grid-rows-1">
      <aside className="flex flex-col gap-3 border-b bg-sidebar px-4 py-3 md:gap-6 md:border-r md:border-b-0 md:py-6">
        <div className="flex items-center justify-between gap-2">
          <Link
            href="/deals"
            className="rounded-sm font-serif text-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Tranche
          </Link>
          <SignOutButton />
        </div>
        <Suspense fallback={<NavLinks pathname="" />}>
          <MainNav />
        </Suspense>
        <div className="mt-auto hidden text-xs md:block text-muted-foreground">
          <p className="font-medium text-foreground">{user.workspaceName}</p>
          <p>{user.name}</p>
        </div>
      </aside>
      <main className="min-w-0 px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
