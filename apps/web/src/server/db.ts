import "server-only";
import { createDb, type Db } from "@tranche/db";

// Next.js reloads server modules in development; keep one pool per process.
const processState = globalThis as typeof globalThis & { trancheWebDb?: Db };

export function getDb(): Db {
  processState.trancheWebDb ??= createDb();
  return processState.trancheWebDb;
}
