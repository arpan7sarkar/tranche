"use client";

import { ErrorState } from "@/components/states";

export default function PortalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorState
      title="This page failed to load"
      body="Nothing has changed with your payments. Try again in a moment."
      retry={reset}
    />
  );
}
