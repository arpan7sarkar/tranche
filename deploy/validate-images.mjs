import { pathToFileURL } from "node:url";

const names = [
  "TRANCHE_POSTGRES_IMAGE",
  "TRANCHE_WEB_IMAGE",
  "TRANCHE_SCHEDULER_IMAGE",
  "TRANCHE_MIGRATION_IMAGE",
];

export function validateImages(env, mode = "registry") {
  if (mode !== "registry" && mode !== "local") throw new Error("Unknown image validation mode");
  for (const name of names) {
    const value = env[name] ?? "";
    const registryDigest = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*@sha256:[a-f0-9]{64}$/.test(value);
    const localId = /^sha256:[a-f0-9]{64}$/.test(value);
    if (!registryDigest && !(mode === "local" && localId)) {
      throw new Error(
        `${name} must be a registry digest${mode === "local" ? " or local image ID" : ""}`,
      );
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== "--local"))
      throw new Error("Usage: node deploy/validate-images.mjs [--local]");
    const mode = args[0] === "--local" ? "local" : "registry";
    validateImages(process.env, mode);
    console.log(
      `${mode} image reference syntax checks passed; provenance still requires verification`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
