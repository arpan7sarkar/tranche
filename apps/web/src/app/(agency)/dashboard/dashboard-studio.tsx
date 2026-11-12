"use client";

import type { DashboardData } from "@tranche/agents";
import {
  type AgAiHarnessSetup,
  type AgDataSourcesDefinition,
  type AgReportState,
  AgStudioAiModule,
  type AgStudioApi,
  createAiHarness,
  studioTheme,
} from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
  panels: {
    filters: { collapsed: true },
    ai: { collapsed: true },
    edit: { collapsed: true },
    data: { collapsed: true },
  },
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
          format: {
            title: { enabled: true, text: "Payment timeline" },
            style: { theme: { common: { legend: { enabled: true } } } },
          },
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
          format: { title: { enabled: true, text: "Deals" } },
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
          format: { title: { enabled: true, text: "Agent activity" } },
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
  const money = {
    format: "currencyFormat" as const,
    formatOptions: {
      format: new Intl.NumberFormat("en-US", { style: "currency", currency: d.currency }),
    },
  };
  return {
    sources: [
      {
        id: "kpis",
        data: d.kpis,
        fields: ["held", "released", "overdue", "forecast"].map((id) => ({
          id,
          ...money,
        })),
      },
      {
        id: "cashflow",
        data: d.cashflow,
        fields: [
          { id: "day", format: "textFormat" },
          ...["held", "released", "overdue", "forecast"].map((id) => ({
            id,
            ...money,
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

function useMedia(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const read = () => setMatches(media.matches);
    read();
    media.addEventListener("change", read);
    return () => media.removeEventListener("change", read);
  }, [query]);
  return matches;
}

export function DashboardStudio() {
  const [data, setData] = useState<DashboardData>();
  const [currency, setCurrency] = useState("");
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const dark = useMedia("(prefers-color-scheme: dark)");
  const compact = useMedia("(max-width: 767px)");
  const wide = useMedia("(min-width: 1280px)");
  const [editing, setEditing] = useState(false);
  const [assistant, setAssistant] = useState(false);
  const apiRef = useRef<AgStudioApi | null>(null);
  const [report, setReport] = useState("cash");
  const selectReport = (id: string) => {
    const api = apiRef.current;
    if (!api) return;
    api.setState({ ...api.getState(), selectedPageId: id });
    setReport(id);
  };
  const initialState = useMemo<AgReportState>(() => {
    if (!compact) return INITIAL_STATE;
    return {
      ...INITIAL_STATE,
      pages: INITIAL_STATE.pages.map((page) =>
        page.id !== "cash"
          ? page
          : {
              ...page,
              widgetLayout: {
                held: { xTrack: 0, yTrack: 0, xSpan: 12, ySpan: 5 },
                released: { xTrack: 12, yTrack: 0, xSpan: 12, ySpan: 5 },
                overdue: { xTrack: 0, yTrack: 5, xSpan: 12, ySpan: 5 },
                forecast: { xTrack: 12, yTrack: 5, xSpan: 12, ySpan: 5 },
                flow: { xTrack: 0, yTrack: 10, xSpan: 24, ySpan: 16 },
                deals: { xTrack: 0, yTrack: 26, xSpan: 24, ySpan: 16 },
              },
            },
      ),
    };
  }, [compact]);
  const [theme, setTheme] = useState<typeof studioTheme>();
  useEffect(() => {
    const styles = getComputedStyle(document.documentElement);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    // Charts need concrete RGB colours, including when app tokens use OKLCH.
    const color = (token: string) => {
      const value = styles.getPropertyValue(token).trim();
      if (!context) return value;
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
      return `rgb(${r}, ${g}, ${b})`;
    };
    const background = color("--background");
    const card = color("--card");
    const foreground = color("--foreground");
    const muted = color("--muted-foreground");
    const border = color("--border");
    setTheme(
      studioTheme.withParams({
        backgroundColor: background,
        foregroundColor: foreground,
        textColor: foreground,
        borderColor: border,
        browserColorScheme: dark ? "dark" : "light",
        studioMinWidth: 0,
        studioMinHeight: 0,
        studioCanvasMinWidth: 0,
        studioCanvasBackgroundColor: background,
        studioWidgetBackgroundColor: card,
        studioWidgetBorder: { color: border },
        studioWidgetTitleFontSize: 18,
        studioWidgetTitleTextColor: foreground,
        studioWidgetCaptionTextColor: muted,
        studioWidgetSubtitleTextColor: muted,
        chartTextColor: foreground,
        chartSubtleTextColor: muted,
        chartGridLineColor: border,
        gridDataBackgroundColor: card,
        gridHeaderBackgroundColor: color("--muted"),
        gridHeaderTextColor: foreground,
        gridCellTextColor: foreground,
        gridBrowserColorScheme: dark ? "dark" : "light",
      }),
    );
  }, [dark]);
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
    <section className="min-w-0 space-y-4" aria-label="Cash flow dashboard">
      <div className="flex flex-wrap items-center justify-between gap-3">
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
        <div className="hidden gap-2 xl:flex">
          <button
            type="button"
            aria-pressed={assistant}
            onClick={() => {
              setEditing(false);
              setAssistant((value) => !value);
            }}
            className="rounded-md border bg-card px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            {assistant ? "Close assistant" : "Ask cash flow"}
          </button>
          <button
            type="button"
            aria-pressed={editing}
            onClick={() => {
              setAssistant(false);
              setEditing((value) => !value);
            }}
            className="rounded-md border bg-card px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            {editing ? "Done editing" : "Customize dashboard"}
          </button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Amounts are in {data.currency}. Currencies are shown separately. The assistant can change
        this dashboard, but cannot approve actions or move money.
      </p>
      <fieldset className="flex gap-2" aria-label="Dashboard report">
        {(
          [
            ["cash", "Payments"],
            ["audit", "Agent activity"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={report === id}
            onClick={() => selectReport(id)}
            className="rounded-md border px-3 py-2 text-sm hover:bg-muted aria-pressed:bg-secondary aria-pressed:font-semibold focus-visible:outline-2 focus-visible:outline-ring"
          >
            {label}
          </button>
        ))}
      </fieldset>
      {!data.deals.length ? (
        <p className="rounded-lg border p-8">
          No deals in {data.currency} yet. Create a deal to see its cash flow here.
        </p>
      ) : (
        <div
          className="ag-theme-mode tranche-studio"
          data-editing={(editing || assistant) && wide}
          data-ag-theme-mode={dark ? "dark" : "light"}
        >
          <AgStudioProvider
            modules={[AgStudioAiModule]}
            {...(LICENSE ? { licenseKey: LICENSE } : {})}
          >
            <AgStudio
              key={`${data.currency}-${compact}`}
              onStudioReady={({ api }) => {
                apiRef.current = api;
                setReport("cash");
              }}
              onStateUpdated={({ state }) => setReport(state.selectedPageId)}
              data={sources}
              theme={theme}
              initialState={initialState}
              layout={{ minWidth: 0, pagePadding: compact ? 8 : 16 }}
              panels={{
                edit: { left: assistant ? ["ai"] : [], right: editing ? ["edit", "data"] : [] },
                view: { left: [], right: [] },
              }}
              mode={(editing || assistant) && wide ? "edit" : "view"}
              ai={ai}
              style={{ height: "100%", width: "100%" }}
            />
          </AgStudioProvider>
        </div>
      )}
    </section>
  );
}
