import type { Db } from "@tranche/db";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
