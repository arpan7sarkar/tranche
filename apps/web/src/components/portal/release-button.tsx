"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function ReleaseButton({
  token,
  milestoneId,
  milestoneKey,
  amount,
  submitted,
}: {
  token: string;
  milestoneId: string;
  milestoneKey: string;
  amount: string;
  submitted: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "pending" | "submitted">("idle");

  if (submitted || status === "submitted") {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
        Release submitted. PayPal is moving the funds.
      </p>
    );
  }

  async function release() {
    setStatus("pending");
    const res = await fetch(`/api/portal/${token}/milestones/${milestoneId}/release`, {
      method: "POST",
    }).catch(() => null);
    if (!res) {
      setStatus("idle");
      toast.error("Network error. Check your connection and try again.");
      return;
    }
    if (res.ok) {
      setStatus("submitted");
      toast.success("Release submitted. PayPal moves the funds shortly.");
    } else {
      setStatus("idle");
      toast.error(
        res.status === 404
          ? "This link has expired. Ask the agency for a fresh one."
          : "This milestone cannot be released right now.",
      );
    }
    router.refresh();
  }

  return (
    <Button
      data-testid={`release-${milestoneKey}`}
      onClick={release}
      disabled={status === "pending"}
      className="self-start"
    >
      {status === "pending" ? "Releasing" : `Release ${amount}`}
    </Button>
  );
}
