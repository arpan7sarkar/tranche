"use client";

import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

const INSTANT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const subscribe = () => () => {};

// The server cannot know the viewer's timezone, so it renders a blank line-height slot and the
// client fills it in after hydration.
export function LocalTime({ at, className }: { at: string; className?: string }) {
  const text = useSyncExternalStore(
    subscribe,
    () => INSTANT.format(new Date(at)),
    () => "\u00a0",
  );
  return (
    <time className={cn("tabular", className)} dateTime={at}>
      {text}
    </time>
  );
}
