"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      const { error } = await authClient.signOut();
      if (error) throw new Error(error.message);
      window.location.assign("/sign-in");
    } catch {
      toast.error("Could not sign out. Try again.");
      setPending(false);
    }
  }

  return (
    <Button variant="ghost" size="sm" onClick={signOut} disabled={pending} aria-busy={pending}>
      {pending ? "Signing out" : "Sign out"}
    </Button>
  );
}
