import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { createDb, createMagicLink, type Db, migrateDb, schema } from "@tranche/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ db: null as Db | null }));
vi.mock("@/server/db", () => ({
  getDb: () => {
    assert(state.db);
    return state.db;
  },
}));

import { POST } from "@/app/api/portal/[token]/orders/[orderId]/fake-approve/route";

const exec = promisify(execFile);
const dockerEnv = { HOME: process.env.HOME, PATH: process.env.PATH, NODE_ENV: "test" as const };
const docker = (...args: string[]) => exec("docker", args, { env: dockerEnv, timeout: 30_000 });
const enabled = process.env.RUN_FAKE_APPROVAL_ROUTE_TEST === "1";

describe.skipIf(!enabled)("fake approval route with isolated PostgreSQL", () => {
  let containerId = "";
  let fake: Server;
  let fakeUrl = "";
  let token = "";
  let expiredToken = "";
  let fakeStatus = 200;
  const calls: string[] = [];

  beforeAll(async () => {
    const name = `tranche-route-test-${randomBytes(8).toString("hex")}`;
    const result = await docker(
      "run",
      "-d",
      "--pull=never",
      "--name",
      name,
      "--memory",
      "512m",
      "--tmpfs",
      "/var/lib/postgresql:rw,size=256m",
      "-p",
      "127.0.0.1::5432",
      "-e",
      "POSTGRES_USER=route_test",
      "-e",
      "POSTGRES_PASSWORD=route_test",
      "-e",
      "POSTGRES_DB=route_test",
      "postgres:18",
    );
    containerId = result.stdout.trim();
    assert.match(containerId, /^[a-f0-9]{64}$/);
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        await docker(
          "exec",
          containerId,
          "pg_isready",
          "-h",
          "127.0.0.1",
          "-U",
          "route_test",
          "-d",
          "route_test",
        );
        ready = true;
        break;
      } catch {
        await delay(1_000);
      }
    }
    assert(ready, "isolated PostgreSQL did not become ready");
    const portOutput = (await docker("port", containerId, "5432/tcp")).stdout.trim();
    const binding = /^127\.0\.0\.1:(\d+)$/.exec(portOutput);
    assert(binding?.[1], "PostgreSQL must bind only to loopback");
    state.db = createDb(`postgresql://route_test:route_test@127.0.0.1:${binding[1]}/route_test`);
    await migrateDb(state.db);

    const [workspace] = await state.db
      .insert(schema.workspace)
      .values({
        name: "Route test",
        rateCard: { currency: "USD", dailyRateMinor: 100, minimumProjectMinor: 0 },
      })
      .returning();
    assert(workspace);
    const [client] = await state.db
      .insert(schema.client)
      .values({ workspaceId: workspace.id, name: "Test", email: "route@example.invalid" })
      .returning();
    assert(client);
    const deals = await state.db
      .insert(schema.deal)
      .values([
        {
          workspaceId: workspace.id,
          clientId: client.id,
          title: "Owner",
          brief: "test",
          currency: "USD",
        },
        {
          workspaceId: workspace.id,
          clientId: client.id,
          title: "Foreign",
          brief: "test",
          currency: "USD",
        },
      ])
      .returning();
    const [owner, foreign] = deals;
    assert(owner && foreign);
    const milestones = await state.db
      .insert(schema.milestone)
      .values([
        {
          dealId: owner.id,
          key: "own",
          position: 0,
          title: "Own",
          priceMinor: 100,
          criteria: { checks: [], prose: [] },
          payees: [{ kind: "agency", shareBps: 10000 }],
        },
        {
          dealId: foreign.id,
          key: "foreign",
          position: 0,
          title: "Foreign",
          priceMinor: 100,
          criteria: { checks: [], prose: [] },
          payees: [{ kind: "agency", shareBps: 10000 }],
        },
      ])
      .returning();
    const [ownMilestone, foreignMilestone] = milestones;
    assert(ownMilestone && foreignMilestone);
    await state.db.insert(schema.hold).values([
      {
        milestoneId: ownMilestone.id,
        mechanism: "authorization",
        paypalOrderId: "own-order",
        amountMinor: 100,
        currency: "USD",
        expiresAt: new Date(Date.now() + 60_000),
      },
      {
        milestoneId: foreignMilestone.id,
        mechanism: "authorization",
        paypalOrderId: "foreign-order",
        amountMinor: 100,
        currency: "USD",
        expiresAt: new Date(Date.now() + 60_000),
      },
    ]);
    token = (await createMagicLink(state.db, { clientId: client.id, dealId: owner.id })).token;
    expiredToken = (
      await createMagicLink(state.db, {
        clientId: client.id,
        dealId: owner.id,
        now: new Date(0),
        ttlDays: 1,
      })
    ).token;

    fake = createServer((request, response) => {
      calls.push(`${request.method} ${request.url}`);
      response.writeHead(fakeStatus).end();
    });
    await new Promise<void>((resolve, reject) => {
      fake.once("error", reject);
      fake.listen(0, "127.0.0.1", resolve);
    });
    const address = fake.address();
    assert(address && typeof address !== "string");
    fakeUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => {
    calls.length = 0;
    fakeStatus = 200;
    vi.stubEnv("WEB_MONEY_ENABLED", undefined);
    vi.stubEnv("NEXT_PUBLIC_E2E_FAKE_PAYPAL", "1");
    vi.stubEnv("PAYPAL_API_BASE", fakeUrl);
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
      const target = new URL(input instanceof Request ? input.url : input);
      if (target.origin !== fakeUrl) throw new Error("non-fake network blocked");
      return originalFetch(input, init);
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    try {
      if (fake?.listening)
        await new Promise<void>((resolve, reject) =>
          fake.close((error) => (error ? reject(error) : resolve())),
        );
    } finally {
      try {
        await state.db?.$client.end();
      } finally {
        if (containerId) await docker("rm", "-f", containerId);
      }
    }
  });

  async function approve(portalToken: string, orderId: string) {
    const request = new Request("http://localhost/api", { method: "POST" });
    const context = { params: Promise.resolve({ token: portalToken, orderId }) } as Parameters<
      typeof POST
    >[1];
    return POST(request, context);
  }

  it("rejects invalid and expired tokens without contacting the fake", async () => {
    for (const invalid of ["invalid", expiredToken]) {
      const response = await approve(invalid, "own-order");
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "invalid_link" });
    }
    expect(calls).toEqual([]);
  });

  it("rejects a foreign order without contacting the fake", async () => {
    const response = await approve(token, "foreign-order");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(calls).toEqual([]);
  });

  it("rejects requests when fake mode is disabled without contacting the fake", async () => {
    vi.stubEnv("NEXT_PUBLIC_E2E_FAKE_PAYPAL", "0");
    const response = await approve(token, "own-order");
    expect(response.status).toBe(404);
    expect(calls).toEqual([]);
  });

  it("denies fake approval by default without contacting the fake", async () => {
    const response = await approve(token, "own-order");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "payments_disabled" });
    expect(calls).toEqual([]);
  });

  it("surfaces fake service failure without retrying or other calls", async () => {
    vi.stubEnv("WEB_MONEY_ENABLED", "true");
    fakeStatus = 500;
    const response = await approve(token, "own-order");
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "fake_paypal_failed" });
    expect(calls).toEqual(["POST /__test/approve/own-order"]);
  });

  it("approves an owned order through the fake service", async () => {
    vi.stubEnv("WEB_MONEY_ENABLED", "true");
    const response = await approve(token, "own-order");
    expect(response.status).toBe(204);
    expect(calls).toEqual(["POST /__test/approve/own-order"]);
  });
});
