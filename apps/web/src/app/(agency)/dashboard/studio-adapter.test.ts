import { afterEach, expect, it, vi } from "vitest";
import { trancheAdapter } from "./studio-adapter";

afterEach(() => vi.unstubAllGlobals());

it.each([
  [429, "request limit has been reached"],
  [503, "temporarily unavailable"],
])("explains assistant failure %i without exposing provider details", async (status, message) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private details", { status })));
  const turn = trancheAdapter.executeTurn({ input: [], responseFormat: { type: "text" } });
  const response = await turn.complete;
  expect(response.status).toBe("failed");
  expect(response.error?.message).toContain(message);
  expect(response.error?.message).not.toContain("private details");
});
