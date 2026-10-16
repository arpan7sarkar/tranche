import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export function sandboxTestOptions(value: string | undefined) {
  if (!value) throw new Error("TEST_DATABASE_URL is required");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("invalid_sandbox_test_database_url");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.port !== "55432" ||
    url.pathname !== "/tranche_p2_test" ||
    value.includes("?") ||
    value.includes("#") ||
    !url.username
  )
    throw new Error(
      "Use only the query-free disposable local tranche_p2_test database on port 55432",
    );
  return {
    host: url.hostname,
    port: Number(url.port),
    database: "tranche_p2_test",
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    max: 10,
    connect_timeout: 5,
    ssl: false as const,
    onnotice: () => {},
  };
}

export async function openSandboxTestDb(value: string | undefined) {
  const client = postgres(sandboxTestOptions(value));
  try {
    const [identity] = await client`
      select current_database() as database,
        current_setting('tranche.test_fixture', true) as fixture
    `;
    if (identity?.database !== "tranche_p2_test" || identity.fixture !== "tranche-f0-disposable-v1")
      throw new Error("sandbox_test_database_identity_mismatch");
    return drizzle(client, { schema, casing: "snake_case" });
  } catch (error) {
    await client.end();
    throw error;
  }
}
