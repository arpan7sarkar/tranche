"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { safeNextPath } from "@/lib/safe-next";

const FAILED = "Could not reach the server. Check your connection and try again.";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    try {
      const result =
        mode === "sign-up"
          ? await authClient.signUp.email({ email, password, name: String(form.get("name")) })
          : await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message ?? "Something went wrong");
        return;
      }
      router.push(mode === "sign-up" ? "/onboarding" : safeNextPath(next));
    } catch {
      setError(FAILED);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <h1 className="text-4xl">{mode === "sign-up" ? "Create your studio" : "Sign in"}</h1>
      {mode === "sign-up" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" required autoComplete="name" />
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
          aria-describedby={mode === "sign-up" ? "password-hint" : undefined}
        />
        {mode === "sign-up" ? (
          <p id="password-hint" className="text-xs text-muted-foreground">
            At least 10 characters.
          </p>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
        {pending ? "Please wait" : mode === "sign-up" ? "Create account" : "Sign in"}
      </Button>
      <p className="text-sm text-muted-foreground">
        {mode === "sign-up" ? (
          <>
            Already have an account?{" "}
            <Link className="underline" href="/sign-in">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New to Tranche?{" "}
            <Link className="underline" href="/sign-up">
              Create an account
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
