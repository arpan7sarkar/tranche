import { randomUUID } from "node:crypto";
import { openSandboxTestDb, sandboxTestOptions } from "@tranche/db/testing";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configureSchedules, enqueue, initializeQueues } from "./queue";

describe.runIf(Boolean(process.env.TEST_DATABASE_URL))("VPS durable task queue", () => {
  let boss: PgBoss;
  beforeAll(async () => {
    const checked = await openSandboxTestDb(process.env.TEST_DATABASE_URL);
    await checked.$client.end();
    const options = sandboxTestOptions(process.env.TEST_DATABASE_URL);
    boss = new PgBoss({
      host: options.host,
      port: options.port,
      database: options.database,
      user: options.username,
      password: options.password,
      schema: "tranche_jobs_test",
      schedule: false,
    });
    boss.on("error", () => {});
    await boss.start();
    await initializeQueues(boss);
  });
  afterAll(async () => {
    await boss?.stop({ graceful: false });
  });

  it("accepts only known tasks and validated arguments", async () => {
    await expect(enqueue(boss, "arbitrary", [], randomUUID())).rejects.toThrow();
    await expect(enqueue(boss, "runNegotiation", ["not-an-id"], randomUUID())).rejects.toThrow();
  });
  it("deduplicates concurrent pending submissions with the same identity", async () => {
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => enqueue(boss, "moneyTick", [], key)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });
  it("persists queued work across queue client restart", async () => {
    const id = await enqueue(boss, "runNegotiation", [randomUUID()], randomUUID());
    expect(id).toBeTruthy();
    await boss.stop();
    await boss.start();
    expect((await boss.getJobById("runNegotiation", id as string))?.state).toBe("created");
  });
  it("stores schedules durably and removes them in health mode", async () => {
    await configureSchedules(boss, true);
    const schedules = await boss.getSchedules();
    expect(schedules.map((s) => s.name)).toEqual(
      expect.arrayContaining(["moneyTick", "reconcile", "consumeAll"]),
    );
    await configureSchedules(boss, false);
    expect(await boss.getSchedules()).toEqual([]);
  });
  it("retries a failed claim and rejects completion from its stale attempt", async () => {
    const name = `retry-${randomUUID()}`;
    await boss.createQueue(name, { policy: "exclusive", retryLimit: 2, retryDelay: 0 });
    const id = await boss.send(name, { safe: true }, { singletonKey: "one" });
    const [first] = await boss.fetch(name, { includeMetadata: true });
    expect(first?.id).toBe(id);
    expect(await boss.fetch(name)).toEqual([]);
    if (!first) throw new Error("missing_claim");
    await boss.fail(name, first, { error: "simulated_failure" });
    const [second] = await boss.fetch(name, { includeMetadata: true });
    expect(second?.id).toBe(id);
    expect(second?.retryCount).toBeGreaterThan(first.retryCount);
    await boss.complete(name, first);
    expect((await boss.getJobById(name, id as string))?.state).toBe("active");
    if (!second) throw new Error("missing_retry");
    await boss.complete(name, second);
    expect((await boss.getJobById(name, id as string))?.state).toBe("completed");
  });
});
