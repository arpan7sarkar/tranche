import type { MilestoneState } from "@tranche/contracts";
import { milestoneTone } from "@/lib/milestone-tone";
import { formatMoney } from "@/lib/money";
import type { DealView } from "@/server/deals";

export type GanttTask = {
  id: string;
  name: string;
  startDate?: string;
  endDate?: string;
  manuallyScheduled?: boolean;
  readOnly?: boolean;
  draggable?: boolean;
  resizable?: boolean;
  expanded?: boolean;
  children?: GanttTask[];
  kind: "group" | "task" | "payment";
  price?: string;
  holdLabel?: string;
  stateLabel?: string;
};

export type GanttDependency = { id: string; fromTask: string; toTask: string };

export const LOCKED_STATES: ReadonlySet<MilestoneState> = new Set([
  "released",
  "paid_out",
  "refunded",
  "cancelled",
  "disputed",
]);

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function toIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toGanttData(view: DealView): {
  tasks: GanttTask[];
  dependencies: GanttDependency[];
} {
  const dependencies: GanttDependency[] = view.dependencies.map((d) => ({
    id: `${d.fromTaskId}->${d.toTaskId}`,
    fromTask: d.fromTaskId,
    toTask: d.toTaskId,
  }));

  const tasks = view.milestones.map((m): GanttTask => {
    const locked = LOCKED_STATES.has(m.state);
    const { label } = milestoneTone(m.state);
    const children: GanttTask[] = view.tasks
      .filter((t) => t.milestoneId === m.id)
      .map((t) => ({
        id: t.id,
        name: t.title,
        startDate: t.startDate,
        endDate: addDays(t.startDate, t.durationDays),
        manuallyScheduled: true,
        readOnly: locked,
        draggable: !locked,
        resizable: false,
        kind: "task",
      }));
    const end =
      m.endDate ??
      children
        .map((c) => c.endDate as string)
        .sort()
        .at(-1);
    const paymentId = `pay:${m.id}`;
    for (const c of children) {
      dependencies.push({ id: `${c.id}->${paymentId}`, fromTask: c.id, toTask: paymentId });
    }
    children.push({
      id: paymentId,
      name: `${m.title} payment`,
      ...(end ? { startDate: end, endDate: end } : {}),
      manuallyScheduled: true,
      readOnly: true,
      draggable: false,
      resizable: false,
      kind: "payment",
      price: formatMoney({ currency: view.deal.currency, minor: m.priceMinor }),
      holdLabel: label,
      stateLabel: label,
    });
    return {
      id: `ms:${m.id}`,
      name: m.title,
      expanded: true,
      readOnly: locked,
      draggable: false,
      resizable: false,
      kind: "group",
      stateLabel: label,
      children,
    };
  });

  return { tasks, dependencies };
}
