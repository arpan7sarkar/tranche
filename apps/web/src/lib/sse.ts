import type { DomainEventType } from "@tranche/contracts";

export type StreamEvent = {
  id: number;
  dealId: string | null;
  milestoneId: string | null;
  type: DomainEventType;
};

export const SSE_HEARTBEAT = ": ping\n\n";

export function sseFrame(e: StreamEvent): string {
  return `id: ${e.id}\ndata: ${JSON.stringify(e)}\n\n`;
}

export function parseEventId(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}
