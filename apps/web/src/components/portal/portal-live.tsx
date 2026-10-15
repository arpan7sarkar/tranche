"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDealStream } from "@/hooks/use-deal-stream";

export function PortalLive({
  dealId,
  token,
  since,
}: {
  dealId: string;
  token: string;
  since: number | undefined;
}) {
  const router = useRouter();
  const [from] = useState(since);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), 150);
  }, [router]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // With a cursor the stream replays what it missed; without one, refetch on every (re)connect.
  useDealStream(dealId, token, refresh, from, from === undefined ? refresh : undefined);
  return null;
}
