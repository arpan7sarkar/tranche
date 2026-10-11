import type { AcceptanceCriteria } from "@tranche/contracts";

export type EvidenceFact = {
  checkIndex: number | null;
  passed: boolean | null;
  createdAt: string;
};

export function verificationGate(
  criteria: AcceptanceCriteria,
  evidence: EvidenceFact[],
): { passed: boolean; failing: number[] } {
  const latest = new Map<number, { at: number; passed: boolean }>();
  for (const e of evidence) {
    const { checkIndex } = e;
    if (checkIndex === null || !Number.isInteger(checkIndex)) continue;
    if (checkIndex < 0 || checkIndex >= criteria.checks.length) continue;
    if (e.passed === null) continue;
    const at = Date.parse(e.createdAt);
    if (Number.isNaN(at)) continue;
    const cur = latest.get(checkIndex);
    if (!cur || at > cur.at) latest.set(checkIndex, { at, passed: e.passed });
    else if (at === cur.at && !e.passed) latest.set(checkIndex, { at, passed: false });
  }
  const failing = criteria.checks.map((_, i) => i).filter((i) => latest.get(i)?.passed !== true);
  return { passed: failing.length === 0, failing };
}
