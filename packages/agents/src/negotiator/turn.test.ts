import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { scriptedModel } from "../testing";
import { negotiationEvalCases } from "./eval-cases";
import { negotiateTurn } from "./turn";

beforeEach(() => vi.stubEnv("TRANCHE_LLM", "on"));
afterEach(() => vi.unstubAllEnvs());
it.each(negotiationEvalCases)("eval: $name", async (c) => {
  const model = scriptedModel(c.responses);
  const result = await negotiateTurn(c.input, model);
  expect(result.kind).toBe(c.expected);
  expect(model.doGenerateCalls.length).toBeLessThanOrEqual(2);
  expect(result.message).not.toContain("800000");
  expect(result.offer?.note ?? "").not.toContain("800000");
  const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt);
  expect(prompt).toContain("UNTRUSTED");
  expect(prompt).not.toContain("agencyMandate");
});
it("pauses disabled model work without converting it into an escalation", async () => {
  const c = negotiationEvalCases[0];
  if (!c) throw new Error("missing_case");
  vi.stubEnv("TRANCHE_LLM", "off");
  const model = scriptedModel(c.responses);
  await expect(negotiateTurn(c.input, model)).rejects.toThrow("model_disabled");
  expect(model.doGenerateCalls).toHaveLength(0);
});
