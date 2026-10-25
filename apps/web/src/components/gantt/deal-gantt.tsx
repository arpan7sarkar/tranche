"use client";

import type { Gantt, GanttConfig } from "@bryntum/gantt";
import { useEffect, useMemo, useRef, useState } from "react";
import { ErrorState, LoadingState } from "@/components/states";
import { milestoneTone, type Tone } from "@/lib/milestone-tone";
import type { DealView } from "@/server/deals";
import { addDays, type GanttTask, toGanttData, toIsoDate } from "./gantt-data";
import "./gantt.css";

type Props = {
  view: DealView;
  onMove: (taskId: string, start: string) => Promise<boolean>;
  readOnly?: boolean;
};

const BRYNTUM_URL = "/bryntum/gantt.module.js";

function localDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
}

async function load(gantt: Gantt, data: ReturnType<typeof toGanttData>) {
  await gantt.project.loadInlineData({ tasks: data.tasks, dependencies: data.dependencies });
  const dates = data.tasks
    .flatMap((g): GanttTask[] => g.children ?? [])
    .flatMap((t) => [t.startDate, t.endDate])
    .filter((d): d is string => Boolean(d))
    .sort();
  const first = dates[0];
  const last = dates.at(-1);
  // Room after the last payment diamond for its label.
  if (first && last)
    await gantt.setTimeSpan(localDate(addDays(first, -2)), localDate(addDays(last, 9)));
}

export default function DealGantt({ view, onMove, readOnly = false }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const gantt = useRef<Gantt | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const data = useMemo(() => toGanttData(view), [view]);
  const tones = useMemo(
    () =>
      new Map<string, Tone>(
        view.milestones.map((m) => [
          `pay:${m.id}`,
          milestoneTone(m.state, { pendingReview: m.hold?.pendingReview }).tone,
        ]),
      ),
    [view.milestones],
  );
  const latest = useRef({ data, tones, onMove });
  latest.current = { data, tones, onMove };

  useEffect(() => {
    let disposed = false;
    import(/* turbopackIgnore: true */ /* webpackIgnore: true */ BRYNTUM_URL).then(
      (bryntum: { Gantt: new (config: GanttConfig) => Gantt }) => {
        if (disposed || !host.current) return;
        const instance = new bryntum.Gantt({
          readOnly,
          appendTo: host.current,
          columns: [{ type: "name", field: "name", text: "Work", width: 320 }],
          viewPreset: "weekAndDayLetter",
          tickSize: 23,
          barMargin: 8,
          rowHeight: 40,
          autoHeight: true,
          features: {
            taskResize: false,
            taskEdit: false,
            taskMenu: false,
            cellEdit: false,
            cellMenu: false,
            headerMenu: false,
            scheduleMenu: false,
            taskDragCreate: false,
            dependencyEdit: false,
            dependencies: { allowCreate: false },
            projectLines: false,
            labels: {
              after: {
                renderer: ({ taskRecord, domConfig }) => {
                  if (taskRecord.getData("kind") !== "payment") return;
                  domConfig.children = [
                    {
                      tag: "span",
                      className: "tranche-payment-label",
                      text: `${String(taskRecord.getData("price"))} · ${String(taskRecord.getData("holdLabel"))}`,
                    },
                  ];
                },
              },
            },
          },
          taskRenderer: ({ taskRecord, renderData }) => {
            const tone = latest.current.tones.get(String(taskRecord.id));
            if (!tone) return "";
            const cls = `tranche-tone-${tone}`;
            if (typeof renderData.wrapperCls === "string") renderData.wrapperCls += ` ${cls}`;
            else renderData.wrapperCls.add(cls);
            return "";
          },
          listeners: {
            taskDrop: ({ taskRecords }) => {
              for (const record of taskRecords) {
                if (record.getData("kind") === "task" && record.startDate instanceof Date) {
                  void latest.current
                    .onMove(String(record.id), toIsoDate(record.startDate))
                    .then((ok) => {
                      // A refused move puts the bar back where the server still has it.
                      if (!ok && gantt.current) void load(gantt.current, latest.current.data);
                    });
                }
              }
            },
          },
        });
        gantt.current = instance;
        void load(instance, latest.current.data);
        setStatus("ready");
      },
      () => {
        if (!disposed) setStatus("error");
      },
    );
    return () => {
      disposed = true;
      gantt.current?.destroy();
      gantt.current = null;
    };
  }, [readOnly]);

  useEffect(() => {
    if (gantt.current) void load(gantt.current, data);
  }, [data]);

  if (status === "error") {
    return (
      <ErrorState
        title="The schedule did not load"
        body="The milestone list below still has every date and control."
        retry={() => window.location.reload()}
      />
    );
  }
  return (
    <div className="relative">
      {status === "loading" ? (
        <div className="absolute inset-0 z-10 bg-background">
          <LoadingState rows={8} />
        </div>
      ) : null}
      <div ref={host} className="tranche-gantt" />
    </div>
  );
}
