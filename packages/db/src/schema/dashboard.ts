import { sql } from "drizzle-orm";
import { bigint, date, integer, pgView, text, timestamp, uuid } from "drizzle-orm/pg-core";

const WORKING = `'held','in_progress','delivered','verifying','changes_requested','release_pending'`;

export const vCashflowDaily = pgView("v_cashflow_daily", {
  workspaceId: uuid().notNull(),
  currency: text().notNull(),
  bucket: text().$type<"held" | "released" | "overdue" | "forecast">().notNull(),
  day: date().notNull(),
  amountMinor: bigint({ mode: "number" }).notNull(),
  milestones: integer().notNull(),
}).as(
  sql.raw(`
  with m as (
    select d.workspace_id, d.currency, ms.price_minor, ms.held_minor, ms.released_minor, ms.state, ms.end_date,
      (select max(e.created_at) from event e where e.milestone_id = ms.id and e.type = 'milestone.released') as released_at,
      (select max(e.created_at) from event e where e.milestone_id = ms.id and e.type = 'milestone.release_pending') as pending_since,
      (select max(e.created_at) from event e where e.milestone_id = ms.id and e.type = 'milestone.held') as held_at
    from milestone ms join deal d on d.id = ms.deal_id where d.status <> 'cancelled'
  ), b as (
    select workspace_id, currency, case when state in ('released','paid_out') then released_minor when state in ('draft','agreed','funding') then price_minor else greatest(held_minor - released_minor, 0) end as amount_minor,
      case
        when state in ('released','paid_out') then 'released'
        when state = 'release_pending' and pending_since < now() - interval '48 hours' then 'overdue'
        when state in (${WORKING}) then 'held'
        when state in ('draft','agreed','funding') then 'forecast'
      end as bucket,
      case
        when state in ('released','paid_out') then coalesce(released_at, now())::date
        when state in ('draft','agreed','funding') then coalesce(end_date, current_date)
        else coalesce(held_at, now())::date
      end as day
    from m
  )
  select workspace_id, currency, bucket, day, sum(amount_minor)::bigint as amount_minor, count(*)::int as milestones
  from b where bucket is not null
  group by workspace_id, currency, bucket, day
`),
);

export const vDealSummary = pgView("v_deal_summary", {
  workspaceId: uuid().notNull(),
  dealId: uuid().notNull(),
  title: text().notNull(),
  clientName: text().notNull(),
  status: text().notNull(),
  currency: text().notNull(),
  totalMinor: bigint({ mode: "number" }).notNull(),
  heldMinor: bigint({ mode: "number" }).notNull(),
  releasedMinor: bigint({ mode: "number" }).notNull(),
  milestones: integer().notNull(),
  milestonesReleased: integer().notNull(),
  nextDue: date(),
}).as(
  sql.raw(`
  select d.workspace_id, d.id as deal_id, d.title, c.name as client_name, d.status, d.currency,
    coalesce(sum(m.price_minor), 0)::bigint as total_minor,
    coalesce(sum(greatest(m.held_minor - m.released_minor, 0)) filter (where m.state in (${WORKING})), 0)::bigint as held_minor,
    coalesce(sum(m.released_minor) filter (where m.state in ('released','paid_out')), 0)::bigint as released_minor,
    count(m.id)::int as milestones,
    (count(m.id) filter (where m.state in ('released','paid_out')))::int as milestones_released,
    min(m.end_date) filter (where m.state not in ('released','paid_out','refunded','cancelled')) as next_due
  from deal d
  join client c on c.id = d.client_id and c.workspace_id = d.workspace_id
  left join milestone m on m.deal_id = d.id
  group by d.id, c.name
`),
);

export const vAgentAudit = pgView("v_agent_audit", {
  workspaceId: uuid().notNull(),
  id: uuid().notNull(),
  dealId: uuid().notNull(),
  dealTitle: text().notNull(),
  agent: text().notNull(),
  side: text().notNull(),
  type: text().notNull(),
  status: text().notNull(),
  reasoning: text().notNull(),
  decisionReason: text(),
  createdAt: timestamp({ withTimezone: true }).notNull(),
}).as(
  sql.raw(`
  select d.workspace_id, pa.id, pa.deal_id, d.title as deal_title, pa.agent, pa.side, pa.type, pa.status,
    pa.reasoning, pa.decision_reason, pa.created_at
  from proposed_action pa join deal d on d.id = pa.deal_id
`),
);
