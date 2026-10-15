import type {
  AcceptanceCriteria,
  ActionPayload,
  ActionStatus,
  ActionType,
  DealStatus,
  DomainEventType,
  EvidenceKind,
  HoldMechanism,
  HoldStatus,
  InboxMessage,
  MilestoneState,
  Payee,
  Policy,
  RateCard,
  ScheduledActionKind,
} from "@tranche/contracts";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

const id = () => uuid().primaryKey().defaultRandom();
const instant = () => timestamp({ withTimezone: true });
const createdAt = () => instant().notNull().defaultNow();
const minor = () => bigint({ mode: "number" });

export const workspace = pgTable("workspace", {
  id: id(),
  name: text().notNull(),
  paypalMerchantId: text(),
  paypalOnboarding: text()
    .$type<"not_started" | "pending" | "active">()
    .notNull()
    .default("not_started"),
  rateCard: jsonb().$type<RateCard>().notNull(),
  createdAt: createdAt(),
});

export const workspaceMember = pgTable(
  "workspace_member",
  {
    workspaceId: uuid()
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text().$type<"owner" | "member">().notNull().default("member"),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

export const client = pgTable("client", {
  id: id(),
  workspaceId: uuid()
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  name: text().notNull(),
  email: text().notNull(),
  paypalVaultId: text(),
  createdAt: createdAt(),
});

export const deal = pgTable(
  "deal",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    clientId: uuid()
      .notNull()
      .references(() => client.id),
    title: text().notNull(),
    brief: text().notNull(),
    currency: text().notNull(),
    status: text().$type<DealStatus>().notNull().default("draft"),
    agencyPolicy: jsonb().$type<Policy>(),
    clientPolicy: jsonb().$type<Policy>(),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  (t) => [index().on(t.workspaceId, t.status)],
);

export const milestone = pgTable(
  "milestone",
  {
    id: id(),
    dealId: uuid()
      .notNull()
      .references(() => deal.id, { onDelete: "cascade" }),
    key: text().notNull(),
    position: integer().notNull(),
    title: text().notNull(),
    priceMinor: minor().notNull(),
    criteria: jsonb().$type<AcceptanceCriteria>().notNull(),
    payees: jsonb().$type<Payee[]>().notNull(),
    state: text().$type<MilestoneState>().notNull().default("draft"),
    heldMinor: minor().notNull().default(0),
    releasedMinor: minor().notNull().default(0),
    verifiedAt: instant(),
    releaseAuthorizedAt: instant(),
    startDate: date(),
    endDate: date(),
    version: integer().notNull().default(0),
    updatedAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.dealId, t.key), index().on(t.state)],
);

export const task = pgTable(
  "task",
  {
    id: id(),
    dealId: uuid()
      .notNull()
      .references(() => deal.id, { onDelete: "cascade" }),
    milestoneId: uuid()
      .notNull()
      .references(() => milestone.id, { onDelete: "cascade" }),
    key: text().notNull(),
    title: text().notNull(),
    durationDays: integer().notNull(),
    startDate: date().notNull(),
    position: integer().notNull(),
  },
  (t) => [uniqueIndex().on(t.dealId, t.key)],
);

export const taskDependency = pgTable(
  "task_dependency",
  {
    fromTaskId: uuid()
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    toTaskId: uuid()
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.fromTaskId, t.toTaskId] })],
);

export const proposedAction = pgTable(
  "proposed_action",
  {
    id: id(),
    dealId: uuid()
      .notNull()
      .references(() => deal.id, { onDelete: "cascade" }),
    agent: text()
      .$type<"planner" | "verifier" | "monitor" | "negotiator" | "dispute" | "human" | "system">()
      .notNull(),
    side: text().$type<"agency" | "client" | "system">().notNull(),
    type: text().$type<ActionType>().notNull(),
    payload: jsonb().$type<ActionPayload>().notNull(),
    reasoning: text().notNull(),
    evidenceIds: jsonb().$type<string[]>().notNull().default([]),
    idempotencyKey: text().notNull().unique(),
    status: text().$type<ActionStatus>().notNull().default("pending"),
    decisionReason: text(),
    createdAt: createdAt(),
    decidedAt: instant(),
    executedAt: instant(),
  },
  (t) => [index().on(t.status, t.createdAt), index().on(t.dealId)],
);

export const approval = pgTable("approval", {
  id: id(),
  proposedActionId: uuid()
    .notNull()
    .unique()
    .references(() => proposedAction.id, { onDelete: "cascade" }),
  side: text().$type<"agency" | "client">().notNull(),
  decision: text().$type<"approved" | "rejected">(),
  decidedBy: text(),
  decidedAt: instant(),
  createdAt: createdAt(),
});

export const hold = pgTable(
  "hold",
  {
    id: id(),
    milestoneId: uuid()
      .notNull()
      .references(() => milestone.id, { onDelete: "cascade" }),
    mechanism: text().$type<HoldMechanism>().notNull(),
    paypalOrderId: text().notNull(),
    paypalCaptureId: text(),
    paypalAuthorizationId: text(),
    originalAuthorizedAt: instant(),
    lastReauthorizedAt: instant(),
    replacesHoldId: uuid().references((): AnyPgColumn => hold.id),
    amountMinor: minor().notNull(),
    currency: text().notNull(),
    status: text().$type<HoldStatus>().notNull().default("pending"),
    expiresAt: instant().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.milestoneId), index().on(t.status, t.expiresAt)],
);

export const payout = pgTable("payout", {
  id: id(),
  milestoneId: uuid()
    .notNull()
    .references(() => milestone.id, { onDelete: "cascade" }),
  holdId: uuid()
    .notNull()
    .references(() => hold.id),
  payee: jsonb().$type<Payee>().notNull(),
  amountMinor: minor().notNull(),
  currency: text().notNull(),
  paypalRef: text(),
  status: text().$type<"pending" | "sent" | "completed" | "failed">().notNull().default("pending"),
  createdAt: createdAt(),
});

export const evidence = pgTable(
  "evidence",
  {
    id: id(),
    milestoneId: uuid()
      .notNull()
      .references(() => milestone.id, { onDelete: "cascade" }),
    kind: text().$type<EvidenceKind>().notNull(),
    checkIndex: integer(),
    passed: boolean(),
    summary: text().notNull(),
    data: jsonb().$type<Record<string, unknown>>().notNull(),
    contentHash: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.milestoneId, t.createdAt)],
);

export const event = pgTable(
  "event",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    dealId: uuid().references(() => deal.id, { onDelete: "cascade" }),
    milestoneId: uuid().references(() => milestone.id, { onDelete: "cascade" }),
    type: text().$type<DomainEventType>().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.dealId, t.id)],
);

export const scheduledAction = pgTable(
  "scheduled_action",
  {
    id: id(),
    milestoneId: uuid()
      .notNull()
      .references(() => milestone.id, { onDelete: "cascade" }),
    kind: text().$type<ScheduledActionKind>().notNull(),
    dueAt: instant().notNull(),
    status: text()
      .$type<"pending" | "running" | "done" | "cancelled" | "failed">()
      .notNull()
      .default("pending"),
    attempts: integer().notNull().default(0),
    lastError: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.status, t.dueAt)],
);

export const inbox = pgTable(
  "inbox",
  {
    id: id(),
    source: text().$type<"paypal" | "github" | "timer" | "user">().notNull(),
    sourceEventId: text().notNull(),
    message: jsonb().$type<InboxMessage>().notNull(),
    receivedAt: createdAt(),
    processedAt: instant(),
    attempts: integer().notNull().default(0),
    lastError: text(),
    nextAttemptAt: instant().notNull().defaultNow(),
  },
  (t) => [uniqueIndex().on(t.source, t.sourceEventId), index().on(t.processedAt)],
);

export const outbox = pgTable(
  "outbox",
  {
    id: id(),
    proposedActionId: uuid().references(() => proposedAction.id),
    scheduledActionId: uuid().references(() => scheduledAction.id),
    kind: text().notNull(),
    request: jsonb().$type<Record<string, unknown>>().notNull(),
    requestId: text().notNull().unique(),
    status: text()
      .$type<"pending" | "sent" | "succeeded" | "failed">()
      .notNull()
      .default("pending"),
    attempts: integer().notNull().default(0),
    lastError: text(),
    nextAttemptAt: instant().notNull().defaultNow(),
    response: jsonb().$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    completedAt: instant(),
  },
  (t) => [index().on(t.status, t.nextAttemptAt)],
);

export const magicLink = pgTable("magic_link", {
  id: id(),
  clientId: uuid()
    .notNull()
    .references(() => client.id, { onDelete: "cascade" }),
  dealId: uuid()
    .notNull()
    .references(() => deal.id, { onDelete: "cascade" }),
  tokenHash: text().notNull().unique(),
  expiresAt: instant().notNull(),
  createdAt: createdAt(),
});
