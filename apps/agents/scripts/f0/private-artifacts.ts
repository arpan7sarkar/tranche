import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function sandboxBrowserUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    !["www.sandbox.paypal.com", "sandbox.paypal.com"].includes(url.hostname)
  )
    throw new Error("browser_destination");
  return url.href;
}

export class PrivateSandboxArtifacts {
  constructor(private readonly directory: string) {}

  async saveBrowserUrl(value: string): Promise<string> {
    const url = sandboxBrowserUrl(value);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const key = randomUUID();
    await writeFile(join(this.directory, `${key}.json`), JSON.stringify({ url }), {
      mode: 0o600,
      flag: "wx",
    });
    return key;
  }

  async readBrowserUrl(key: string): Promise<string> {
    if (!/^[a-f0-9-]{36}$/.test(key)) throw new Error("artifact_key");
    const artifact: unknown = JSON.parse(
      await readFile(join(this.directory, `${key}.json`), "utf8"),
    );
    if (
      !artifact ||
      typeof artifact !== "object" ||
      !("url" in artifact) ||
      typeof artifact.url !== "string"
    )
      throw new Error("artifact_invalid");
    return sandboxBrowserUrl(artifact.url);
  }
}
