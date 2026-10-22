import type { Mandate, Offer } from "@tranche/contracts";
import {
  bigint,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { deal, event } from "./core";

const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

export const negotiation = pgTable("negotiation", {
  id: uuid().primaryKey().defaultRandom(),
  dealId: uuid()
    .notNull()
    .references(() => deal.id, { onDelete: "cascade" }),
  status: text().$type<"open" | "agreed" | "escalated" | "failed">().notNull().default("open"),
  agencyMandate: jsonb().$type<Mandate>().notNull(),
  clientMandate: jsonb().$type<Mandate>().notNull(),
  createdAt: createdAt(),
});

export const negotiationTurn = pgTable(
  "negotiation_turn",
  {
    id: uuid().primaryKey().defaultRandom(),
    negotiationId: uuid()
      .notNull()
      .references(() => negotiation.id, { onDelete: "cascade" }),
    round: integer().notNull(),
    side: text().$type<"agency" | "client">().notNull(),
    kind: text().$type<"offer" | "accept" | "reject" | "escalate">().notNull(),
    offer: jsonb().$type<Offer>(),
    message: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.negotiationId, t.round, t.side)],
);

export const notification = pgTable(
  "notification",
  {
    id: uuid().primaryKey().defaultRandom(),
    kind: text().notNull(),
    ref: text().notNull(),
    to: text().notNull(),
    providerId: text(),
    sentAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.kind, t.ref)],
);

export const eventCursor = pgTable("event_cursor", {
  consumer: text().primaryKey(),
  lastEventId: bigint({ mode: "number" }).notNull().default(0),
});

export const agentEventReceipt = pgTable(
  "agent_event_receipt",
  {
    consumer: text().notNull(),
    eventId: bigint({ mode: "number" })
      .notNull()
      .references(() => event.id, { onDelete: "cascade" }),
    completedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.consumer, t.eventId] })],
);
