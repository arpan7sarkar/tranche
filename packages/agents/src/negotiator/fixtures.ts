import type { PlanDraft } from "@tranche/contracts";

const usd = (minor: number) => ({ currency: "USD", minor });
const agencyOnly = [{ kind: "agency" as const, shareBps: 10000 }];

export const STOREFRONT_PLAN: PlanDraft = {
  summary: "Acme storefront rebuild",
  currency: "USD",
  milestones: [
    {
      key: "design",
      title: "Design system and key screens",
      price: usd(240000),
      criteria: {
        checks: [{ kind: "url_live", url: "https://acme-staging.example.com/styleguide" }],
        prose: [],
      },
      payees: agencyOnly,
    },
    {
      key: "build",
      title: "Storefront build",
      price: usd(480000),
      criteria: { checks: [{ kind: "ci_green", repo: "northwind/acme-storefront" }], prose: [] },
      payees: agencyOnly,
    },
    {
      key: "launch",
      title: "Launch and handover",
      price: usd(120000),
      criteria: { checks: [{ kind: "url_live", url: "https://acme.example.com" }], prose: [] },
      payees: agencyOnly,
    },
  ],
  tasks: [
    {
      key: "wireframes",
      title: "Wireframes",
      durationDays: 3,
      dependsOn: [],
      milestoneKey: "design",
    },
    {
      key: "visual",
      title: "Visual design",
      durationDays: 5,
      dependsOn: ["wireframes"],
      milestoneKey: "design",
    },
    {
      key: "catalog",
      title: "Catalog pages",
      durationDays: 6,
      dependsOn: ["visual"],
      milestoneKey: "build",
    },
    {
      key: "checkout",
      title: "Cart and checkout",
      durationDays: 6,
      dependsOn: ["visual"],
      milestoneKey: "build",
    },
    {
      key: "perf",
      title: "Performance pass",
      durationDays: 2,
      dependsOn: ["catalog", "checkout"],
      milestoneKey: "build",
    },
    {
      key: "launch-day",
      title: "Launch",
      durationDays: 1,
      dependsOn: ["perf"],
      milestoneKey: "launch",
    },
  ],
};
