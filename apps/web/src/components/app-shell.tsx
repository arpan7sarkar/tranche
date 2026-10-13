import { CheckCircle2, LayoutDashboard, Plug, Rows3 } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

const NAV = [
  { href: "/deals", label: "Deals", icon: Rows3 },
  { href: "/approvals", label: "Approvals", icon: CheckCircle2 },
  { href: "/dashboard", label: "Cash flow", icon: LayoutDashboard },
  { href: "/onboarding", label: "Connections", icon: Plug },
];

export function AppShell({
  user,
  children,
}: {
  user: { name: string; workspaceName: string };
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[232px_1fr]">
      <aside className="flex flex-col gap-3 border-b bg-sidebar px-4 py-3 md:gap-6 md:border-r md:border-b-0 md:py-6">
        <Link href="/deals" className="font-serif text-2xl">
          Tranche
        </Link>
        <nav
          className="-mx-2 flex gap-0.5 overflow-x-auto md:mx-0 md:flex-col md:gap-1"
          aria-label="Main"
        >
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent"
            >
              <Icon className="size-4 max-sm:hidden" aria-hidden />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto hidden text-xs md:block text-muted-foreground">
          <p className="font-medium text-foreground">{user.workspaceName}</p>
          <p>{user.name}</p>
        </div>
      </aside>
      <main className="min-w-0 px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
