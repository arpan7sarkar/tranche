export type JobSummary =
  | {
      type: "summary";
      job: "moneyTick";
      timersAttempted: number;
      inboxAttempted: number;
      actionsAttempted: number;
      outboxAttempted: number;
    }
  | {
      type: "summary";
      job: "reconcile";
      checked: number;
      mismatches: number;
      recovered: number;
      unavailable: number;
      unknown: number;
    };

export function validateSummary(job: string, value: unknown): JobSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const fields =
    job === "moneyTick"
      ? ["timersAttempted", "inboxAttempted", "actionsAttempted", "outboxAttempted"]
      : job === "reconcile"
        ? ["checked", "mismatches", "recovered", "unavailable", "unknown"]
        : null;
  if (
    !fields ||
    record.type !== "summary" ||
    record.job !== job ||
    Object.keys(record).length !== fields.length + 2 ||
    !fields.every((field) => Number.isSafeInteger(record[field]) && Number(record[field]) >= 0)
  ) {
    return null;
  }
  if (job === "moneyTick") {
    return {
      type: "summary",
      job,
      timersAttempted: record.timersAttempted as number,
      inboxAttempted: record.inboxAttempted as number,
      actionsAttempted: record.actionsAttempted as number,
      outboxAttempted: record.outboxAttempted as number,
    };
  }
  return {
    type: "summary",
    job: "reconcile",
    checked: record.checked as number,
    mismatches: record.mismatches as number,
    recovered: record.recovered as number,
    unavailable: record.unavailable as number,
    unknown: record.unknown as number,
  };
}

export function sendSummary(
  summary: JobSummary,
  send: (message: JobSummary, callback: (error: Error | null) => void) => unknown,
): Promise<void> {
  return new Promise((resolve, reject) => {
    send(summary, (error) => (error ? reject(error) : resolve()));
  });
}
