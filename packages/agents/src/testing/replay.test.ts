import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { generateStructured } from "../runtime/llm";
import { untrusted } from "../runtime/untrusted";
import { cachedModel, cacheKey } from "./replay";
import { scriptedModel } from "./scripted-model";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});
it("replays structured decisions without provider calls despite fresh fence nonces", async () => {
  vi.stubEnv("TRANCHE_LLM", "on");
  const dir = await mkdtemp(join(tmpdir(), "tranche-replay-"));
  directories.push(dir);
  const options = { schema: z.object({ count: z.number() }), system: "Count" };
  await generateStructured({
    ...options,
    model: cachedModel(scriptedModel([{ count: 3 }]), { dir, mode: "record" }),
    prompt: untrusted("brief", "test"),
  });
  const offline = scriptedModel([]);
  const model = cachedModel(offline, { dir, mode: "replay" });
  expect(
    await generateStructured({ ...options, model, prompt: untrusted("brief", "test") }),
  ).toEqual({ count: 3 });
  await expect(
    generateStructured({ ...options, model, prompt: untrusted("brief", "changed") }),
  ).rejects.toThrow("missing_recording");
  expect(offline.doGenerateCalls).toHaveLength(0);
});
it("keeps model, schema and content changes in the cache identity", () => {
  expect(cacheKey("a", { text: "x", schema: "one" })).not.toBe(
    cacheKey("b", { text: "x", schema: "one" }),
  );
  expect(cacheKey("a", { text: "x", schema: "one" })).not.toBe(
    cacheKey("a", { text: "x", schema: "two" }),
  );
});
