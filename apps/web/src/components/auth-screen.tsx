import Link from "next/link";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";
import { TrancheMark } from "@/components/tranche-mark";
import { Skeleton } from "@/components/ui/skeleton";

function FormSkeleton() {
  return (
    <div role="status" className="flex w-full max-w-sm flex-col gap-4">
      <span className="sr-only">Loading</span>
      <Skeleton className="h-10 w-3/4 bg-border" />
      <Skeleton className="h-8 w-full bg-border" />
      <Skeleton className="h-8 w-full bg-border" />
      <Skeleton className="h-9 w-full bg-border" />
    </div>
  );
}

export function AuthScreen({ mode }: { mode: "sign-in" | "sign-up" }) {
  return (
    <main className="relative grid min-h-screen place-items-center px-4 py-24">
      <Link
        href="/"
        className="absolute top-8 left-6 inline-flex items-center gap-2 rounded-sm font-serif text-2xl focus-visible:outline-2 focus-visible:outline-ring"
      >
        <TrancheMark /> Tranche
      </Link>
      <Suspense fallback={<FormSkeleton />}>
        <AuthForm mode={mode} />
      </Suspense>
    </main>
  );
}
