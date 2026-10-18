import type { Models } from "../runtime/models";
export type EvalCase<I, O> = {
  id: string;
  input: I;
  critical?: boolean;
  check: (output: O) => string[];
};
export type CaseResult = {
  suite: string;
  id: string;
  critical: boolean;
  passed: boolean;
  failures: string[];
};
export function defineSuite<I, O>(suite: {
  name: string;
  run: (input: I, models: Models) => Promise<O>;
  cases: EvalCase<I, O>[];
}) {
  if (
    !suite.cases.length ||
    new Set(suite.cases.map((item) => item.id)).size !== suite.cases.length
  )
    throw new Error("invalid_eval_cases");
  return {
    ...suite,
    async execute(models: Models): Promise<CaseResult[]> {
      const results: CaseResult[] = [];
      for (const item of suite.cases) {
        let failures: string[];
        try {
          failures = item.check(await suite.run(item.input, models));
        } catch {
          failures = ["decision_failed"];
        }
        results.push({
          suite: suite.name,
          id: item.id,
          critical: item.critical ?? false,
          passed: failures.length === 0,
          failures,
        });
      }
      return results;
    },
  };
}
export function summarize(results: CaseResult[], thresholds: Record<string, number>) {
  const names = new Set([...Object.keys(thresholds), ...results.map((result) => result.suite)]);
  const suites = [...names].map((name) => {
    const rows = results.filter((result) => result.suite === name);
    const threshold = thresholds[name];
    const passed = rows.filter((row) => row.passed).length;
    const rate = rows.length ? passed / rows.length : 0;
    return {
      name,
      total: rows.length,
      passed,
      rate,
      ok:
        rows.length > 0 &&
        threshold !== undefined &&
        Number.isFinite(threshold) &&
        threshold >= 0 &&
        threshold <= 1 &&
        rate >= threshold,
    };
  });
  const criticalFailures = results.filter((result) => result.critical && !result.passed);
  return {
    suites,
    criticalFailures,
    ok: suites.length > 0 && suites.every((suite) => suite.ok) && criticalFailures.length === 0,
  };
}
