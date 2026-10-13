"use client";

import { CheckCircle2, LayoutDashboard, Plug, Rows3 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/deals", label: "Deals", icon: Rows3 },
  { href: "/approvals", label: "Approvals", icon: CheckCircle2 },
  { href: "/dashboard", label: "Cash flow", icon: LayoutDashboard },
  { href: "/onboarding", label: "Connections", icon: Plug },
];

const isCurrent = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

export function NavLinks({ pathname }: { pathname: string }) {
  return (
    <nav
      className="-mx-2 flex gap-0.5 overflow-x-auto md:mx-0 md:flex-col md:gap-1 md:overflow-visible"
      aria-label="Main"
    >
      {NAV.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={isCurrent(pathname, href) ? "page" : undefined}
          className="flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium"
        >
          <Icon className="size-4 max-sm:hidden" aria-hidden />
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function MainNav() {
  return <NavLinks pathname={usePathname()} />;
}
