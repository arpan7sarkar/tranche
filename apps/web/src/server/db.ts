import { createDb, type Db } from "@tranche/db";

let db: Db | undefined;

export function getDb(): Db {
  db ??= createDb();
  return db;
}
