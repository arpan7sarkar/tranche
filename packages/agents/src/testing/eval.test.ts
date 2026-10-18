import { expect, it } from "vitest";
import { defineSuite, summarize } from "./eval";
import { scriptedModel } from "./scripted-model";

it("fails critical regressions and missing suites even when the aggregate threshold passes", async () => {
  const model = scriptedModel([]);
  const suite = defineSuite({
    name: "runtime",
    run: async (input: boolean) => input,
    cases: [
      { id: "safe", input: true, check: (value) => (value ? [] : ["failed"]) },
      { id: "unsafe", input: false, critical: true, check: (value) => (value ? [] : ["failed"]) },
    ],
  });
  const rows = await suite.execute({ judge: model, fast: model });
  expect(summarize(rows, { runtime: 0.5 }).ok).toBe(false);
  expect(summarize(rows.slice(0, 1), { runtime: 1 }).ok).toBe(true);
  expect(summarize(rows.slice(0, 1), {}).ok).toBe(false);
  expect(summarize([], { runtime: 0 }).ok).toBe(false);
});
