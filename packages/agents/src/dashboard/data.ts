import { minorUnitExponent } from "@tranche/contracts";
import { type Db, schema } from "@tranche/db";
import { and, asc, desc, eq } from "drizzle-orm";

export type DashboardData = {
  currency: string;
  currencies: string[];
  kpis: { held: number; released: number; overdue: number; forecast: number }[];
  cashflow: { day: string; held: number; released: number; overdue: number; forecast: number }[];
  deals: {
    title: string;
    client: string;
    status: string;
    total: number;
    held: number;
    released: number;
    milestones: number;
    milestonesReleased: number;
    nextDue: string | null;
  }[];
  audit: {
    createdAt: string;
    deal: string;
    agent: string;
    side: string;
    type: string;
    status: string;
    reasoning: string;
    decisionReason: string | null;
  }[];
};

export async function loadDashboardData(
  db: Db,
  workspaceId: string,
  selectedCurrency?: string,
): Promise<DashboardData> {
  const [ws] = await db.select().from(schema.workspace).where(eq(schema.workspace.id, workspaceId));
  if (!ws) throw new Error(`workspace ${workspaceId} not found`);
  const available = await db
    .selectDistinct({ currency: schema.deal.currency })
    .from(schema.deal)
    .where(eq(schema.deal.workspaceId, workspaceId));
  const currencies = [
    ...new Set([ws.rateCard.currency, ...available.map((d) => d.currency)]),
  ].sort();
  const currency = selectedCurrency ?? ws.rateCard.currency;
  if (!currencies.includes(currency)) throw new Error("invalid_dashboard_currency");
  const major = (minor: number) => minor / 10 ** minorUnitExponent(currency);

  const flows = await db
    .select()
    .from(schema.vCashflowDaily)
    .where(
      and(
        eq(schema.vCashflowDaily.workspaceId, workspaceId),
        eq(schema.vCashflowDaily.currency, currency),
      ),
    )
    .orderBy(asc(schema.vCashflowDaily.day));

  const byDay = new Map<string, DashboardData["cashflow"][number]>();
  const kpi = { held: 0, released: 0, overdue: 0, forecast: 0 };
  for (const f of flows) {
    const row = byDay.get(f.day) ?? { day: f.day, held: 0, released: 0, overdue: 0, forecast: 0 };
    row[f.bucket] += major(f.amountMinor);
    kpi[f.bucket] += major(f.amountMinor);
    byDay.set(f.day, row);
  }

  const deals = await db
    .select()
    .from(schema.vDealSummary)
    .where(
      and(
        eq(schema.vDealSummary.workspaceId, workspaceId),
        eq(schema.vDealSummary.currency, currency),
      ),
    );

  const audit = await db
    .select()
    .from(schema.vAgentAudit)
    .where(eq(schema.vAgentAudit.workspaceId, workspaceId))
    .orderBy(desc(schema.vAgentAudit.createdAt))
    .limit(500);

  return {
    currency,
    currencies,
    kpis: [kpi],
    cashflow: [...byDay.values()],
    deals: deals.map((d) => ({
      title: d.title,
      client: d.clientName,
      status: d.status,
      total: major(d.totalMinor),
      held: major(d.heldMinor),
      released: major(d.releasedMinor),
      milestones: d.milestones,
      milestonesReleased: d.milestonesReleased,
      nextDue: d.nextDue,
    })),
    audit: audit.map((a) => ({
      createdAt: a.createdAt.toISOString(),
      deal: a.dealTitle,
      agent: a.agent,
      side: a.side,
      type: a.type,
      status: a.status,
      reasoning: a.reasoning,
      decisionReason: a.decisionReason,
    })),
  };
}
