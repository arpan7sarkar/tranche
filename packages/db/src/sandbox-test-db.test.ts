import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const end = vi.fn(async () => {});
  const client = Object.assign(vi.fn(), { end });
  return { client, end, connect: vi.fn(() => client) };
});
vi.mock("postgres", () => ({ default: mocks.connect }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: (client: unknown) => ({ $client: client }) }));

import { openSandboxTestDb, sandboxTestOptions } from "./sandbox-test-db";

const valid = "postgres://tranche:tranche@localhost:55432/tranche_p2_test";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.client.mockResolvedValue([
    { database: "tranche_p2_test", fixture: "tranche-f0-disposable-v1" },
  ]);
});

describe("guarded F0 database connection", () => {
  it.each([
    undefined,
    "",
    "not-a-url",
    `${valid}?database=tranche`,
    `${valid}?host=other`,
    `${valid}?options=-csearch_path=public`,
    `${valid}?`,
    `${valid}#fragment`,
    valid.replace("postgres:", "https:"),
    valid.replace("localhost", "other"),
    valid.replace("55432", "5433"),
    valid.replace("/tranche_p2_test", "/tranche"),
  ])("rejects unsafe targets before connecting: %s", async (value) => {
    await expect(openSandboxTestDb(value)).rejects.toThrow();
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("connects with explicit parsed options instead of a raw URL", async () => {
    expect(sandboxTestOptions(valid)).toMatchObject({
      host: "localhost",
      port: 55432,
      database: "tranche_p2_test",
      username: "tranche",
      password: "tranche",
    });
    await openSandboxTestDb(valid);
    expect(mocks.connect).toHaveBeenCalledWith(
      expect.objectContaining({ database: "tranche_p2_test", host: "localhost", port: 55432 }),
    );
    expect(mocks.client).toHaveBeenCalledOnce();
  });

  it.each([
    { database: "tranche", fixture: "tranche-f0-disposable-v1" },
    { database: "tranche_p2_test", fixture: null },
    { database: "tranche_p2_test", fixture: "foreign" },
  ])("rejects a wrong database or unowned fixture and closes it: %j", async (identity) => {
    mocks.client.mockResolvedValue([identity]);
    await expect(openSandboxTestDb(valid)).rejects.toThrow(
      "sandbox_test_database_identity_mismatch",
    );
    expect(mocks.end).toHaveBeenCalledOnce();
  });
});
