import { and, eq } from "drizzle-orm";
import { createDb, type Db, migrateDb, schema } from "./index";

const WORKSPACE = "Northwind Studio";
const DEAL = "Acme storefront rebuild";

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("seed: expected a row");
  return value;
}

export async function seed(db: Db) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.workspace)
      .where(eq(schema.workspace.name, WORKSPACE));
    if (existing) {
      const [found] = await tx
        .select()
        .from(schema.deal)
        .where(and(eq(schema.deal.workspaceId, existing.id), eq(schema.deal.title, DEAL)));
      const d = must(found);
      return { workspaceId: existing.id, clientId: d.clientId, dealId: d.id };
    }

    const [wsRow] = await tx
      .insert(schema.workspace)
      .values({
        name: WORKSPACE,
        rateCard: { currency: "USD", dailyRateMinor: 60000, minimumProjectMinor: 300000 },
      })
      .returning();
    const ws = must(wsRow);
    const [clRow] = await tx
      .insert(schema.client)
      .values({ workspaceId: ws.id, name: "Acme Coffee", email: "buyer@acme.test" })
      .returning();
    const cl = must(clRow);
    const [dlRow] = await tx
      .insert(schema.deal)
      .values({
        workspaceId: ws.id,
        clientId: cl.id,
        title: DEAL,
        brief:
          "Rebuild the Acme Coffee storefront on Next.js with a new checkout and a 90+ Lighthouse score.",
        currency: "USD",
        status: "draft",
      })
      .returning();
    const dl = must(dlRow);

    const repo = "northwind/acme-storefront";
    const url = "https://acme-staging.example.com";
    const milestones = [
      {
        key: "design",
        title: "Design system and key screens",
        priceMinor: 240000,
        criteria: {
          checks: [{ kind: "url_live" as const, url: `${url}/styleguide` }],
          prose: ["Matches the approved Figma"],
        },
      },
      {
        key: "build",
        title: "Storefront build",
        priceMinor: 480000,
        criteria: {
          checks: [
            { kind: "pr_merged" as const, repo, base: "main" },
            { kind: "ci_green" as const, repo },
            { kind: "lighthouse" as const, url, category: "performance" as const, min: 90 },
          ],
          prose: ["Product, cart and checkout pages work on mobile"],
        },
      },
      {
        key: "launch",
        title: "Launch and handover",
        priceMinor: 120000,
        criteria: {
          checks: [{ kind: "url_live" as const, url: "https://acme.example.com" }],
          prose: ["Handover doc delivered"],
        },
      },
    ];
    const msRows = await tx
      .insert(schema.milestone)
      .values(
        milestones.map((m, i) => ({
          dealId: dl.id,
          key: m.key,
          position: i,
          title: m.title,
          priceMinor: m.priceMinor,
          criteria: m.criteria,
          payees: [{ kind: "agency" as const, shareBps: 10000 }],
        })),
      )
      .returning();
    const msId = new Map(msRows.map((m) => [m.key, m.id]));

    const start = new Date().toISOString().slice(0, 10);
    const tasks = [
      { key: "wireframes", title: "Wireframes", days: 3, ms: "design", after: [] as string[] },
      { key: "visual", title: "Visual design", days: 5, ms: "design", after: ["wireframes"] },
      { key: "catalog", title: "Catalog pages", days: 6, ms: "build", after: ["visual"] },
      { key: "checkout", title: "Cart and checkout", days: 6, ms: "build", after: ["visual"] },
      {
        key: "perf",
        title: "Performance pass",
        days: 2,
        ms: "build",
        after: ["catalog", "checkout"],
      },
      { key: "launch", title: "Launch", days: 1, ms: "launch", after: ["perf"] },
    ];
    const startOf = new Map<string, string>();
    const endOf = new Map<string, string>();
    for (const t of tasks) {
      const s =
        t.after.length === 0
          ? start
          : must(
              t.after
                .map((k) => must(endOf.get(k)))
                .sort()
                .at(-1),
            );
      startOf.set(t.key, s);
      endOf.set(t.key, addDays(s, t.days));
    }
    const taskRows = await tx
      .insert(schema.task)
      .values(
        tasks.map((t, i) => ({
          dealId: dl.id,
          milestoneId: must(msId.get(t.ms)),
          key: t.key,
          title: t.title,
          durationDays: t.days,
          startDate: must(startOf.get(t.key)),
          position: i,
        })),
      )
      .returning();
    const taskId = new Map(taskRows.map((t) => [t.key, t.id]));
    const deps = tasks.flatMap((t) =>
      t.after.map((a) => ({ fromTaskId: must(taskId.get(a)), toTaskId: must(taskId.get(t.key)) })),
    );
    if (deps.length > 0) await tx.insert(schema.taskDependency).values(deps);

    return { workspaceId: ws.id, clientId: cl.id, dealId: dl.id };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = createDb();
  await migrateDb(db);
  console.log(await seed(db));
  await db.$client.end();
}
