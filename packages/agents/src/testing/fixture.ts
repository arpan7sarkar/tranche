import { type Db, schema } from "@tranche/db";
export async function makeDeal(db: Db) {
  const [workspace] = await db
    .insert(schema.workspace)
    .values({
      name: "Agent test",
      rateCard: { currency: "USD", dailyRateMinor: 10000, minimumProjectMinor: 10000 },
    })
    .returning();
  if (!workspace) throw new Error("fixture_workspace");
  const [client] = await db
    .insert(schema.client)
    .values({ workspaceId: workspace.id, name: "Client", email: "test@example.com" })
    .returning();
  if (!client) throw new Error("fixture_client");
  const [deal] = await db
    .insert(schema.deal)
    .values({
      workspaceId: workspace.id,
      clientId: client.id,
      title: "Test",
      brief: "Build",
      currency: "USD",
    })
    .returning();
  if (!deal) throw new Error("fixture_deal");
  const [milestone] = await db
    .insert(schema.milestone)
    .values({
      dealId: deal.id,
      key: "build",
      position: 0,
      title: "Build",
      priceMinor: 10000,
      criteria: { checks: [{ kind: "url_live", url: "https://example.com" }], prose: [] },
      payees: [{ kind: "agency", shareBps: 10000 }],
    })
    .returning();
  if (!milestone) throw new Error("fixture_milestone");
  return { dealId: deal.id, milestoneId: milestone.id, workspaceId: workspace.id };
}
