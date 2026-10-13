"use client";

import { ErrorState } from "@/components/states";

export default function AgencyError({ reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorState
      title="This page failed to load"
      body="Your data is safe. Try again in a moment."
      retry={reset}
    />
  );
}
