import type { DomainEventType } from "@tranche/contracts";
import { createDb, createMagicLink, type Db, migrateDb, schema } from "@tranche/db";
import { eq, max } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamEvent } from "@/lib/sse";
import { createDeal, createUser, createWorkspace, one } from "@/server/test-fixtures";

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), requestHeaders: vi.fn() }));

vi.mock("@/server/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
vi.mock("next/headers", () => ({ headers: async () => mocks.requestHeaders() }));
vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new Error(`redirect:${target}`);
  },
}));

const url = process.env.DATABASE_URL;

type Frame = { id: number | null; data: StreamEvent | null; comment: string | null };

function frameReader(res: Response) {
  const body = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const frames: Frame[] = [];
  let buffer = "";
  let pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;
  let closed = false;

  function parse(block: string) {
    const lines = block.split("\n");
    if (lines.every((l) => l.startsWith(":"))) {
      frames.push({ id: null, data: null, comment: lines.join("\n") });
      return;
    }
    const id = lines.find((l) => l.startsWith("id: "));
    const data = lines.find((l) => l.startsWith("data: "));
    frames.push({
      id: id ? Number(id.slice(4)) : null,
      data: data ? (JSON.parse(data.slice(6)) as StreamEvent) : null,
      comment: null,
    });
  }

  async function pump(ms: number) {
    pending ??= body.read();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = Symbol("timeout");
    const result = await Promise.race([
      pending,
      new Promise<typeof timedOut>((resolve) => {
        timer = setTimeout(() => resolve(timedOut), Math.max(ms, 1));
      }),
    ]);
    clearTimeout(timer);
    if (result === timedOut) return;
    pending = null;
    if (result.done) {
      closed = true;
      return;
    }
    buffer += decoder.decode(result.value, { stream: true });
    for (let at = buffer.indexOf("\n\n"); at >= 0; at = buffer.indexOf("\n\n")) {
      parse(buffer.slice(0, at));
      buffer = buffer.slice(at + 2);
    }
  }

  return {
    frames,
    ids: () => frames.flatMap((f) => (f.id === null ? [] : [f.id])),
    async until(predicate: () => boolean, ms = 8000) {
      const end = Date.now() + ms;
      while (!predicate()) {
        if (closed) throw new Error("stream closed before the expected frames arrived");
        if (Date.now() >= end) {
          throw new Error(`timed out; got ids [${frames.map((f) => f.id).join(", ")}]`);
        }
        await pump(end - Date.now());
      }
    },
    async settle(ms: number) {
      const end = Date.now() + ms;
      while (Date.now() < end && !closed) await pump(end - Date.now());
    },
    async cancel() {
      await body.cancel().catch(() => undefined);
    },
  };
}

describe.runIf(Boolean(url))("GET /api/stream", { timeout: 30_000 }, () => {
  let db: Db;
  let GET: typeof import("./route").GET;
  const opened: Array<{ controller: AbortController; cancel: () => Promise<void> }> = [];

  beforeAll(async () => {
    db = createDb(url);
    await migrateDb(db);
    ({ GET } = await import("./route"));
  });
  afterAll(async () => {
    await db.$client.end();
  });
  beforeEach(() => {
    mocks.getSession.mockReset();
    mocks.requestHeaders.mockReset();
    mocks.requestHeaders.mockReturnValue(new Headers({ cookie: "session=test" }));
    mocks.getSession.mockResolvedValue(null);
  });
  afterEach(async () => {
    vi.useRealTimers();
    for (const { controller, cancel } of opened.splice(0)) {
      controller.abort();
      await cancel();
    }
  });

  async function agencyOf(workspaceId: string) {
    const user = await createUser(db);
    await db
      .insert(schema.workspaceMember)
      .values({ workspaceId, userId: user.id, role: "member" });
    mocks.getSession.mockResolvedValue({
      session: { id: `s-${user.id}` },
      user: { id: user.id, name: user.name },
    });
    return user;
  }

  async function newDeal() {
    const fixture = await createDeal(db, { milestones: 1 });
    return { ...fixture, dealId: fixture.deal.id };
  }

  async function addEvents(
    dealId: string,
    count: number,
    type: DomainEventType = "task.rescheduled",
  ) {
    return db
      .insert(schema.event)
      .values(Array.from({ length: count }, () => ({ dealId, type, payload: {} })))
      .returning();
  }

  async function addEvent(dealId: string, type: DomainEventType = "deal.agreed") {
    return one(await addEvents(dealId, 1, type));
  }

  function request(dealId: string, opts: { token?: string; header?: string; query?: string } = {}) {
    const params = new URLSearchParams({ dealId });
    if (opts.token) params.set("token", opts.token);
    if (opts.query) params.set("lastEventId", opts.query);
    const controller = new AbortController();
    const req = new Request(`http://localhost/api/stream?${params}`, {
      headers: opts.header ? { "last-event-id": opts.header } : {},
      signal: controller.signal,
    });
    return { req, controller };
  }

  async function open(dealId: string, opts: Parameters<typeof request>[1] = {}) {
    const { req, controller } = request(dealId, opts);
    const res = await GET(req);
    const reader = res.status === 200 ? frameReader(res) : null;
    opened.push({ controller, cancel: async () => reader?.cancel() });
    return { res, reader: reader as NonNullable<typeof reader> };
  }

  async function expectRejected(res: Response, statuses: number[]) {
    expect(statuses).toContain(res.status);
    expect(res.headers.get("content-type") ?? "").not.toContain("text/event-stream");
    await res.body?.cancel().catch(() => undefined);
  }

  describe("authorization", () => {
    it("answers 401 with no session and no token", async () => {
      const { dealId } = await newDeal();
      const { res } = await open(dealId);
      await expectRejected(res, [401]);
    });

    it("answers 401 for an unknown token", async () => {
      const { dealId } = await newDeal();
      const { res } = await open(dealId, { token: "nope" });
      await expectRejected(res, [401]);
    });

    it("answers 404, never the stream or the deal, for a member of another workspace", async () => {
      const { dealId, deal } = await newDeal();
      await agencyOf((await createWorkspace(db)).id);
      const { res } = await open(dealId);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type") ?? "").not.toContain("text/event-stream");
      expect(await res.text()).not.toContain(deal.title);
    });

    it("answers 404 for a dealId that is not a UUID or is missing", async () => {
      const { workspaceId } = await newDeal();
      await agencyOf(workspaceId);
      for (const bad of ["not-a-uuid", "", crypto.randomUUID()]) {
        const { res } = await open(bad);
        await expectRejected(res, [404]);
      }
    });

    it("streams for a member of the owning workspace", async () => {
      const { dealId, workspaceId } = await newDeal();
      await agencyOf(workspaceId);
      const { res, reader } = await open(dealId);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      expect(res.headers.get("cache-control")).toContain("no-cache");
      const row = await addEvent(dealId);
      await reader.until(() => reader.ids().includes(row.id));
    });

    it("streams for a portal token that resolves to the same deal, without a session", async () => {
      const { dealId, clientId } = await newDeal();
      const { token } = await createMagicLink(db, { clientId, dealId });
      const { res, reader } = await open(dealId, { token });
      expect(res.status).toBe(200);
      const row = await addEvent(dealId);
      await reader.until(() => reader.ids().includes(row.id));
    });

    it("answers 404 for a valid portal token of another deal", async () => {
      const mine = await newDeal();
      const other = await newDeal();
      const { token } = await createMagicLink(db, {
        clientId: other.clientId,
        dealId: other.dealId,
      });
      for (const dealId of [mine.dealId, "not-a-uuid"]) {
        const { res } = await open(dealId, { token });
        await expectRejected(res, [404]);
      }
    });

    it("ignores an agency session when the token is for another deal", async () => {
      const mine = await newDeal();
      const other = await newDeal();
      await agencyOf(other.workspaceId);
      const { token } = await createMagicLink(db, {
        clientId: other.clientId,
        dealId: other.dealId,
      });
      const { res } = await open(mine.dealId, { token });
      await expectRejected(res, [401, 404]);
    });

    it("rejects an expired portal token", async () => {
      const { dealId, clientId } = await newDeal();
      const { token } = await createMagicLink(db, {
        clientId,
        dealId,
        now: new Date(Date.now() - 40 * 86_400_000),
      });
      const { res } = await open(dealId, { token });
      await expectRejected(res, [401, 404]);
    });

    it("rejects a tampered portal token", async () => {
      const { dealId, clientId } = await newDeal();
      const { token } = await createMagicLink(db, { clientId, dealId });
      const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
      const { res } = await open(dealId, { token: tampered });
      await expectRejected(res, [401, 404]);
    });
  });

  describe("replay and live delivery", () => {
    it("replays events after Last-Event-ID in ascending order, then streams live ones", async () => {
      const { dealId, workspaceId } = await newDeal();
      await agencyOf(workspaceId);
      const rows = await addEvents(dealId, 4);
      const [first, ...rest] = rows;
      const { reader } = await open(dealId, { header: String(first?.id) });
      await reader.until(() => reader.ids().length >= rest.length);
      expect(reader.ids()).toEqual(rest.map((r) => r.id));

      const live = await addEvent(dealId);
      await reader.until(() => reader.ids().includes(live.id));
      expect(reader.ids()).toEqual([...rest.map((r) => r.id), live.id]);
      expect(live.id).toBeGreaterThan(rest.at(-1)?.id ?? Number.POSITIVE_INFINITY);
      expect(reader.frames.at(-1)?.data).toEqual({
        id: live.id,
        dealId,
        milestoneId: null,
        type: "deal.agreed",
      });
    });

    it("honours lastEventId in the query for the first connection", async () => {
      const { dealId, clientId } = await newDeal();
      const { token } = await createMagicLink(db, { clientId, dealId });
      const [first, second, third] = await addEvents(dealId, 3);
      const { reader } = await open(dealId, { token, query: String(first?.id) });
      await reader.until(() => reader.ids().length >= 2);
      await reader.settle(150);
      expect(reader.ids()).toEqual([second?.id, third?.id]);
    });

    it("sends nothing for an id at or beyond the newest event, then only new events", async () => {
      const { dealId, workspaceId } = await newDeal();
      await agencyOf(workspaceId);
      const rows = await addEvents(dealId, 2);
      const newest = rows.at(-1)?.id ?? 0;
      const { reader } = await open(dealId, { header: String(newest) });
      await reader.settle(200);
      expect(reader.ids()).toEqual([]);
      const live = await addEvent(dealId);
      await reader.until(() => reader.ids().length >= 1);
      expect(reader.ids()).toEqual([live.id]);
    });

    it("still streams live events when Last-Event-ID is garbage", async () => {
      const { dealId, workspaceId } = await newDeal();
      await agencyOf(workspaceId);
      for (const header of ["abc", "-5", "1e999", " "]) {
        const { res, reader } = await open(dealId, { header });
        expect(res.status).toBe(200);
        const live = await addEvent(dealId);
        await reader.until(() => reader.ids().includes(live.id));
      }
    });

    it("never delivers the events of other deals", async () => {
      const mine = await newDeal();
      const other = await newDeal();
      await agencyOf(mine.workspaceId);
      const { reader } = await open(mine.dealId);
      const foreignLive = await addEvent(other.dealId);
      const foreignMore = await addEvents(other.dealId, 3);
      const own = await addEvent(mine.dealId);
      await reader.until(() => reader.ids().includes(own.id));
      await reader.settle(150);
      const foreign = new Set([foreignLive.id, ...foreignMore.map((r) => r.id)]);
      expect(reader.ids().some((id) => foreign.has(id))).toBe(false);
      expect(reader.frames.every((f) => f.data === null || f.data.dealId === mine.dealId)).toBe(
        true,
      );
    });

    it("never replays the events of other deals or events without a deal", async () => {
      const mine = await newDeal();
      const other = await newDeal();
      await agencyOf(mine.workspaceId);
      await addEvents(other.dealId, 3);
      await db.insert(schema.event).values({ type: "deal.created", payload: {} });
      const [first, second] = await addEvents(mine.dealId, 2);
      const { reader } = await open(mine.dealId, { header: String((first?.id ?? 1) - 1) });
      await reader.until(() => reader.ids().length >= 2);
      await reader.settle(150);
      expect(reader.ids()).toEqual([first?.id, second?.id]);
    });

    it("never delivers an event twice when events are inserted while the replay runs", async () => {
      for (let round = 0; round < 4; round += 1) {
        const { dealId, workspaceId } = await newDeal();
        await agencyOf(workspaceId);
        const seeded = await addEvents(dealId, 200);
        const after = seeded[0]?.id ?? 0;
        const { req, controller } = request(dealId, { header: String(after) });
        const inserting = (async () => {
          for (let i = 0; i < 40; i += 1) await addEvent(dealId);
        })();
        const [res] = await Promise.all([GET(req), inserting]);
        const reader = frameReader(res);
        opened.push({ controller, cancel: () => reader.cancel() });

        const newest = (
          await db
            .select({ newest: max(schema.event.id) })
            .from(schema.event)
            .where(eq(schema.event.dealId, dealId))
        )[0]?.newest;
        const expected = (
          await db
            .select({ id: schema.event.id })
            .from(schema.event)
            .where(eq(schema.event.dealId, dealId))
        )
          .map((r) => r.id)
          .filter((id) => id > after)
          .sort((a, b) => a - b);
        await reader.until(() => reader.ids().includes(newest ?? 0));
        await reader.settle(200);
        expect(reader.ids()).toEqual(expected);
      }
    });

    it("delivers an event inserted right after connecting, exactly once", async () => {
      const { dealId, workspaceId } = await newDeal();
      await agencyOf(workspaceId);
      const base = await addEvent(dealId);
      const { req, controller } = request(dealId, { header: String(base.id - 1) });
      const [res, live] = await Promise.all([GET(req), addEvent(dealId)]);
      const reader = frameReader(res);
      opened.push({ controller, cancel: () => reader.cancel() });
      await reader.until(() => reader.ids().includes(live.id));
      await reader.settle(200);
      expect(reader.ids()).toEqual([base.id, live.id]);
    });

    it("fans one event out to every open stream of the deal", async () => {
      const { dealId, workspaceId, clientId } = await newDeal();
      await agencyOf(workspaceId);
      const { token } = await createMagicLink(db, { clientId, dealId });
      const streams = await Promise.all([open(dealId), open(dealId), open(dealId, { token })]);
      const live = await addEvent(dealId);
      for (const { reader } of streams) await reader.until(() => reader.ids().includes(live.id));
      for (const { reader } of streams) expect(reader.ids()).toEqual([live.id]);
    });

    it("uses one LISTEN connection per process however many streams are open", async () => {
      const { dealId, workspaceId } = await newDeal();
      await agencyOf(workspaceId);
      const streams = await Promise.all([open(dealId), open(dealId), open(dealId)]);
      const live = await addEvent(dealId);
      for (const { reader } of streams) await reader.until(() => reader.ids().includes(live.id));
      const [row] = await db.$client<{ n: number }[]>`
        select count(*)::int as n from pg_stat_activity
        where datname = current_database() and query ilike 'listen%tranche_events%'`;
      expect(row?.n).toBe(1);
    });
  });

  describe("heartbeat", () => {
    it("sends comment frames on an idle connection without an id line", async () => {
      const { dealId, workspaceId } = await newDeal();
      await agencyOf(workspaceId);
      const warm = await open(dealId);
      const row = await addEvent(dealId);
      await warm.reader.until(() => warm.reader.ids().includes(row.id));

      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      const { reader } = await open(dealId, { header: String(row.id) });
      for (let i = 0; i < 40 && !reader.frames.some((f) => f.comment !== null); i += 1) {
        await vi.advanceTimersByTimeAsync(60_000);
        await reader.settle(50);
      }
      vi.useRealTimers();
      await reader.until(() => reader.frames.some((f) => f.comment !== null), 1000);
      const beat = reader.frames.find((f) => f.comment !== null);
      expect(beat?.comment).toMatch(/^:/);
      expect(beat?.id).toBeNull();
      expect(reader.ids()).toEqual([]);
    });
  });
});
