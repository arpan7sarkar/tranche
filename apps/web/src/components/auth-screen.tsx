import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";
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
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <Suspense fallback={<FormSkeleton />}>
        <AuthForm mode={mode} />
      </Suspense>
    </main>
  );
}
