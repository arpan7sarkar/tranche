import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type LanguageModel, wrapLanguageModel } from "ai";
import { canonical } from "../runtime/persistence";
export class MissingRecordingError extends Error {
  constructor(key: string) {
    super(`missing_recording:${key}`);
    this.name = "MissingRecordingError";
  }
}
function normalize(value: unknown): unknown {
  if (typeof value === "string")
    return value
      .replace(/(<<<UNTRUSTED [a-zA-Z0-9 _-]+ )[0-9a-f]{16}(>>>)/g, "$1NONCE$2")
      .replace(/<<<END [0-9a-f]{16}>>>/g, "<<<END NONCE>>>");
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  return value;
}
export function cacheKey(modelId: string, params: unknown): string {
  const input =
    params && typeof params === "object" && !Array.isArray(params)
      ? Object.fromEntries(Object.entries(params).filter(([key]) => key !== "abortSignal"))
      : params;
  return createHash("sha256")
    .update(canonical({ modelId, params: normalize(input) }))
    .digest("hex");
}
export function cachedModel(
  model: Exclude<LanguageModel, string>,
  options: { dir: string; mode: "replay" | "record" },
) {
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v4",
      async wrapGenerate({ doGenerate, params, model: underlying }) {
        const key = cacheKey(`${underlying.provider}:${underlying.modelId}`, params);
        const path = join(options.dir, `${key}.json`);
        if (options.mode === "replay") {
          try {
            return JSON.parse(await readFile(path, "utf8"));
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
              throw new MissingRecordingError(key);
            throw error;
          }
        }
        const result = await doGenerate();
        await mkdir(options.dir, { recursive: true });
        const temporary = join(options.dir, `${key}.${randomUUID()}.tmp`);
        // Keep output fixtures only; provider headers, request bodies and credentials are excluded.
        await writeFile(
          temporary,
          JSON.stringify({
            content: result.content,
            finishReason: result.finishReason,
            usage: result.usage,
            warnings: [],
          }),
          { mode: 0o600 },
        );
        await rename(temporary, path);
        return result;
      },
      async wrapStream() {
        throw new Error("replay_streaming_not_supported");
      },
    },
  });
}
