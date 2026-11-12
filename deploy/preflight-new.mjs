import { execFileSync } from "node:child_process";
import { validateImages } from "./validate-images.mjs";

// biome-ignore lint/suspicious/noUndeclaredEnvVars: Standalone deployment check, outside cached Turbo tasks.
const project = process.env.TRANCHE_PROJECT_NAME ?? "";
if (!/^[a-z0-9][a-z0-9_-]{2,47}$/.test(project)) {
  throw new Error("Set a unique, lowercase project name");
}
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--local"))
  throw new Error("Usage: node deploy/preflight-new.mjs [--local]");
validateImages(process.env, args[0] === "--local" ? "local" : "registry");

const docker = (...args) =>
  execFileSync("docker", ["--host", "unix:///var/run/docker.sock", ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: "/nonexistent" },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const lines = (value) => (value ? value.split("\n") : []);
const usedContainers = lines(
  docker("ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`),
);
const usedVolumes = lines(docker("volume", "ls", "--format", "{{.Name}}"));
const usedNetworks = lines(docker("network", "ls", "--format", "{{.Name}}"));
const usedNames = lines(docker("ps", "-a", "--format", "{{.Names}}"));
if (
  usedContainers.length ||
  docker("volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`) ||
  docker("network", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`) ||
  usedVolumes.some((name) => name.startsWith(`${project}_`)) ||
  usedNetworks.some((name) => name.startsWith(`${project}_`)) ||
  usedNames.some((name) => name.startsWith(`${project}-`) || name.startsWith(`${project}_`))
) {
  throw new Error("Project or generated resource name already exists; choose a different project");
}
const containers = JSON.parse(
  docker("network", "inspect", "--format", "{{json .Containers}}", "proxy") || "{}",
);
const reserved = new Set(["tranche-web", `${project}-tranche-web-1`]);
for (const id of Object.keys(containers ?? {})) {
  const networks = JSON.parse(
    docker("inspect", "--format", "{{json .NetworkSettings.Networks}}", id),
  );
  const peer = networks?.proxy;
  if (
    !peer ||
    (peer.Aliases != null && !Array.isArray(peer.Aliases)) ||
    (peer.DNSNames != null && !Array.isArray(peer.DNSNames))
  ) {
    throw new Error("Cannot verify proxy network DNS names");
  }
  const names = [containers[id].Name, ...(peer.Aliases ?? []), ...(peer.DNSNames ?? [])];
  if (names.some((name) => typeof name !== "string" || reserved.has(name.toLowerCase()))) {
    throw new Error(
      "A required web DNS name is already in use or cannot be verified on the proxy network",
    );
  }
}
console.log("No existing project resources or proxy DNS name conflicts detected");
