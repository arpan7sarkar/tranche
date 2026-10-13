import "server-only";
import postgres from "postgres";
import type { StreamEvent } from "@/lib/sse";

export type Subscriber = {
  onEvent: (e: StreamEvent) => void;
  onResync: () => void;
};

type Hub = { subscribers: Set<Subscriber>; ready?: Promise<unknown> };

const KEY = Symbol.for("tranche.event-hub");
const globals = globalThis as { [KEY]?: Hub };
globals[KEY] ??= { subscribers: new Set() };
const hub = globals[KEY];

function start(): Promise<unknown> {
  const sql = postgres(process.env.DATABASE_URL as string, { max: 1 });
  let listened = false;
  return sql
    .listen(
      "tranche_events",
      (payload) => {
        let event: StreamEvent;
        try {
          event = JSON.parse(payload) as StreamEvent;
        } catch {
          return;
        }
        for (const s of hub.subscribers) s.onEvent(event);
      },
      () => {
        if (listened) for (const s of hub.subscribers) s.onResync();
        listened = true;
      },
    )
    .catch(async (error) => {
      hub.ready = undefined;
      await sql.end({ timeout: 0 });
      throw error;
    });
}

export async function subscribe(subscriber: Subscriber): Promise<() => void> {
  hub.ready ??= start();
  await hub.ready;
  hub.subscribers.add(subscriber);
  return () => {
    hub.subscribers.delete(subscriber);
  };
}
