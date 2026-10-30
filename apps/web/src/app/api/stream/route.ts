import { resolveMagicLink, schema } from "@tranche/db";
import { and, asc, eq, gt } from "drizzle-orm";
import { parseEventId, SSE_HEARTBEAT, type StreamEvent, sseFrame } from "@/lib/sse";
import { getDb } from "@/server/db";
import { subscribe } from "@/server/event-hub";
import { requireDealAccess } from "@/server/session";

export const maxDuration = 60;

const HEARTBEAT_MS = 15_000;
const DEDUPE_WINDOW = 1000;

async function deny(dealId: string, token: string | null): Promise<Response | null> {
  if (token === null) {
    const access = await requireDealAccess(dealId);
    return access.ok ? null : access.response;
  }
  const link = await resolveMagicLink(getDb(), token);
  if (!link) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (link.dealId !== dealId) return Response.json({ error: "not_found" }, { status: 404 });
  return null;
}

async function eventsAfter(dealId: string, id: number): Promise<StreamEvent[]> {
  const rows = await getDb()
    .select({
      id: schema.event.id,
      dealId: schema.event.dealId,
      milestoneId: schema.event.milestoneId,
      type: schema.event.type,
    })
    .from(schema.event)
    .where(and(eq(schema.event.dealId, dealId), gt(schema.event.id, id)))
    .orderBy(asc(schema.event.id));
  return rows;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const dealId = params.get("dealId") ?? "";
  const denied = await deny(dealId, params.get("token"));
  if (denied) return denied;

  const resumeFrom = parseEventId(
    request.headers.get("last-event-id") ?? params.get("lastEventId"),
  );
  const encoder = new TextEncoder();
  const backlog: StreamEvent[] = [];
  const sent = new Set<number>();
  let cursor = resumeFrom ?? 0;
  let live = false;
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let lifetime: ReturnType<typeof setTimeout> | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array>;

  const write = (chunk: string) => {
    if (!closed) controller.enqueue(encoder.encode(chunk));
  };
  const deliver = (e: StreamEvent) => {
    if (sent.has(e.id)) return;
    sent.add(e.id);
    if (sent.size > DEDUPE_WINDOW) sent.delete(sent.values().next().value as number);
    cursor = Math.max(cursor, e.id);
    write(sseFrame(e));
  };
  const catchUp = async () => {
    for (const e of await eventsAfter(dealId, cursor)) deliver(e);
  };

  let unsubscribe = () => {};
  try {
    unsubscribe = await subscribe({
      onEvent: (e) => {
        if (e.dealId !== dealId) return;
        if (live) deliver(e);
        else backlog.push(e);
      },
      onResync: () => void catchUp().catch(() => close()),
    });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }

  function close() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearTimeout(lifetime);
    unsubscribe();
    try {
      controller.close();
    } catch {}
  }
  request.signal.addEventListener("abort", close, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(c) {
      controller = c;
      try {
        if (resumeFrom !== null) await catchUp();
        for (const e of backlog) deliver(e);
        backlog.length = 0;
        live = true;
        write(SSE_HEARTBEAT);
        heartbeat = setInterval(() => write(SSE_HEARTBEAT), HEARTBEAT_MS);
        // EventSource reconnects with Last-Event-ID before the function duration limit.
        lifetime = setTimeout(close, 45_000);
        if (request.signal.aborted) close();
      } catch (error) {
        close();
        c.error(error);
      }
    },
    cancel: close,
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
