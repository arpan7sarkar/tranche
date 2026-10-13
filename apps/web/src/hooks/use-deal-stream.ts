"use client";

import { useEffect, useEffectEvent } from "react";
import type { StreamEvent } from "@/lib/sse";

const RETRY_BASE_MS = 1000;
const RETRY_CAP_MS = 30_000;

export function useDealStream(
  dealId: string,
  token: string | null,
  onEvent: (e: StreamEvent) => void,
  since?: number,
  onOpen?: () => void,
) {
  const handle = useEffectEvent(onEvent);
  const opened = useEffectEvent(() => onOpen?.());

  useEffect(() => {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let lastId = since;
    let attempt = 0;
    let disposed = false;

    const connect = () => {
      const query = new URLSearchParams({ dealId, ...(token ? { token } : {}) });
      if (lastId !== undefined) query.set("lastEventId", String(lastId));
      const current = new EventSource(`/api/stream?${query}`);
      source = current;
      const live = () => !disposed && source === current;
      current.onopen = () => {
        if (!live()) return;
        attempt = 0;
        opened();
      };
      current.onmessage = (m) => {
        if (!live()) return;
        const id = Number(m.lastEventId);
        if (Number.isSafeInteger(id) && id > (lastId ?? 0)) lastId = id;
        handle(JSON.parse(m.data) as StreamEvent);
      };
      // The browser retries network errors itself; a non-200 or a closed source never comes back.
      current.onerror = () => {
        if (!live() || current.readyState !== EventSource.CLOSED) return;
        current.close();
        source = null;
        const ceiling = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** attempt);
        attempt += 1;
        retry = setTimeout(connect, ceiling / 2 + Math.random() * (ceiling / 2));
      };
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      source?.close();
    };
  }, [dealId, token, since]);
}
