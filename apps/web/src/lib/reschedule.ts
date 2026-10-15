import { formatDay } from "./dates";

// Rewrites the core's reason (task keys, ISO dates) in the words the agency sees.
export function explainReschedule(
  reason: string,
  tasks: ReadonlyArray<{ key: string; title: string }>,
): string {
  const titles = new Map(tasks.map((t) => [t.key, t.title]));
  const text = reason
    .replace(/^task "/, '"')
    .replace(/"([^"]+)"/g, (_, key: string) => `"${titles.get(key) ?? key}"`)
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, (iso) => formatDay(iso));
  const sentence = text.charAt(0).toUpperCase() + text.slice(1);
  return sentence.endsWith(".") ? sentence : `${sentence}.`;
}
