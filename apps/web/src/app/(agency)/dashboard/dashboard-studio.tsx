"use client";

import type { DashboardData } from "@tranche/agents";
import {
  type AgAiHarnessSetup,
  type AgDataSourcesDefinition,
  type AgReportState,
  AgStudioAiModule,
  createAiHarness,
  studioTheme,
} from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import { useEffect, useMemo, useState } from "react";
import { trancheAdapter } from "./studio-adapter";
import "./studio.css";

const LICENSE = process.env.NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY;

const kpi = (field: "held" | "released" | "overdue" | "forecast", caption: string) => ({
  type: "value" as const,
  dataMapping: { value: [{ id: `kpis.${field}`, aggregation: "sum" as const }] },
  format: { caption: { enabled: true, text: caption } },
});

const INITIAL_STATE: AgReportState = {
  selectedPageId: "cash",
  panels: { filters: { collapsed: true } },
  pages: [
    {
      id: "cash",
      widgets: {
        held: kpi("held", "Held by PayPal"),
        released: kpi("released", "Released"),
        overdue: kpi("overdue", "Overdue releases"),
        forecast: kpi("forecast", "Forecast"),
        flow: {
          type: "column-chart-stacked",
          dataMapping: {
            categoryKey: [{ id: "cashflow.day" }],
            valueKey: [
              { id: "cashflow.released", aggregation: "sum" },
              { id: "cashflow.held", aggregation: "sum" },
              { id: "cashflow.overdue", aggregation: "sum" },
              { id: "cashflow.forecast", aggregation: "sum" },
            ],
          },
        },
        deals: {
          type: "grid",
          dataMapping: {
            cols: [
              { id: "deals.title" },
              { id: "deals.client" },
              { id: "deals.status" },
              { id: "deals.total", aggregation: "sum" },
              { id: "deals.held", aggregation: "sum" },
              { id: "deals.released", aggregation: "sum" },
              { id: "deals.nextDue" },
            ],
          },
        },
      },
      widgetLayout: {
        held: { xTrack: 0, yTrack: 0, xSpan: 6, ySpan: 5 },
        released: { xTrack: 6, yTrack: 0, xSpan: 6, ySpan: 5 },
        overdue: { xTrack: 12, yTrack: 0, xSpan: 6, ySpan: 5 },
        forecast: { xTrack: 18, yTrack: 0, xSpan: 6, ySpan: 5 },
        flow: { xTrack: 0, yTrack: 5, xSpan: 24, ySpan: 14 },
        deals: { xTrack: 0, yTrack: 19, xSpan: 24, ySpan: 14 },
      },
    },
    {
      id: "audit",
      widgets: {
        audit: {
          type: "grid",
          dataMapping: {
            cols: [
              { id: "audit.createdAt" },
              { id: "audit.deal" },
              { id: "audit.agent" },
              { id: "audit.type" },
              { id: "audit.status" },
              { id: "audit.reasoning" },
              { id: "audit.decisionReason" },
            ],
          },
        },
      },
      widgetLayout: { audit: { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 30 } },
    },
  ],
};

function toSources(d: DashboardData): AgDataSourcesDefinition {
  return {
    sources: [
      {
        id: "kpis",
        data: d.kpis,
        fields: ["held", "released", "overdue", "forecast"].map((id) => ({
          id,
          format: "decimalFormat" as const,
        })),
      },
      {
        id: "cashflow",
        data: d.cashflow,
        fields: [
          { id: "day", format: "textFormat" },
          ...["held", "released", "overdue", "forecast"].map((id) => ({
            id,
            format: "decimalFormat" as const,
          })),
        ],
      },
      {
        id: "deals",
        data: d.deals,
        fields: [
          ...["title", "client", "status", "nextDue"].map((id) => ({
            id,
            format: "textFormat" as const,
          })),
          ...["total", "held", "released", "milestones", "milestonesReleased"].map((id) => ({
            id,
            format: "decimalFormat" as const,
          })),
        ],
      },
      {
        id: "audit",
        data: d.audit,
        fields: [
          "createdAt",
          "deal",
          "agent",
          "side",
          "type",
          "status",
          "reasoning",
          "decisionReason",
        ].map((id) => ({ id, format: "textFormat" as const })),
      },
    ],
  };
}

function useDarkMode() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setDark(root.classList.contains("dark"));
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

export function DashboardStudio() {
  const [data, setData] = useState<DashboardData>();
  const [currency, setCurrency] = useState("");
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const dark = useDarkMode();
  const [theme, setTheme] = useState<typeof studioTheme>();
  useEffect(() => {
    setTheme(
      studioTheme.withParams({
        studioWidgetBorder: getComputedStyle(document.documentElement)
          .getPropertyValue("--studio-widget-border-color")
          .trim(),
      }),
    );
  }, []);
  const sources = useMemo(() => (data ? toSources(data) : undefined), [data]);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    setData(undefined);
    fetch(
      `/api/dashboard/data?refresh=${revision}${currency ? `&currency=${encodeURIComponent(currency)}` : ""}`,
      {
        cache: "no-store",
        signal: controller.signal,
      },
    )
      .then(async (res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        setData((await res.json()) as DashboardData);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Could not load cash flow data.");
      });
    return () => controller.abort();
  }, [currency, revision]);

  const ai = useMemo<AgAiHarnessSetup>(
    () =>
      ({ api }) =>
        createAiHarness(api, {
          adapter: trancheAdapter,
          promptStarters: [
            {
              label: "Overdue releases",
              prompt: "Which deals have overdue releases, and how much money is waiting?",
            },
            {
              label: "Next 30 days",
              prompt: "Add a chart of forecast cash for the next 30 days by day.",
            },
            {
              label: "Agent activity",
              prompt: "Summarise what the agents did this week from the audit data.",
            },
          ],
        }),
    [],
  );

  if (error)
    return (
      <div role="alert" className="rounded-lg border border-destructive p-4">
        <p>{error}</p>
        <button type="button" onClick={() => setRevision((value) => value + 1)}>
          Try again
        </button>
      </div>
    );
  if (!data || !theme)
    return (
      <div
        className="tranche-studio animate-pulse bg-foreground/5"
        aria-busy="true"
        role="status"
        aria-label="Loading cash flow"
      />
    );

  return (
    <section className="space-y-4">
      <label className="flex items-center gap-3">
        Currency
        <select
          className="rounded border bg-background p-2"
          value={data.currency}
          onChange={(event) => setCurrency(event.target.value)}
        >
          {data.currencies.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <p className="text-sm text-muted-foreground">
        Amounts are in {data.currency}. Currencies are shown separately. The assistant can change
        this dashboard, but cannot approve actions or move money.
      </p>
      {!data.deals.length ? (
        <p className="rounded-lg border p-8">
          No deals in {data.currency} yet. Create a deal to see its cash flow here.
        </p>
      ) : (
        <div className="ag-theme-mode tranche-studio" data-ag-theme-mode={dark ? "dark" : "light"}>
          <AgStudioProvider
            modules={[AgStudioAiModule]}
            {...(LICENSE ? { licenseKey: LICENSE } : {})}
          >
            <AgStudio
              key={data.currency}
              data={sources}
              theme={theme}
              initialState={INITIAL_STATE}
              mode="edit"
              ai={ai}
              style={{ height: "100%", width: "100%" }}
            />
          </AgStudioProvider>
        </div>
      )}
    </section>
  );
}
