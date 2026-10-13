"use client";

import { useEffect, useEffectEvent } from "react";
import type { StreamEvent } from "@/lib/sse";

export function useDealStream(
  dealId: string,
  token: string | null,
  onEvent: (e: StreamEvent) => void,
) {
  const handle = useEffectEvent(onEvent);
  useEffect(() => {
    const query = new URLSearchParams({ dealId, ...(token ? { token } : {}) });
    const source = new EventSource(`/api/stream?${query}`);
    source.onmessage = (m) => handle(JSON.parse(m.data) as StreamEvent);
    return () => source.close();
  }, [dealId, token]);
}
