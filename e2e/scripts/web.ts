import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { appEnv } from "../support/environment";

const env: NodeJS.ProcessEnv = { ...process.env, ...appEnv, NODE_ENV: "production" };
const guardPath = fileURLToPath(
  new URL("../support/network-guard.cjs", import.meta.url),
).replaceAll("\\", "/");
env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --require "${guardPath}"`;
async function run(args: string[]) {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const child = spawn(command, args, {
    env,
    stdio: ["inherit", "inherit", "pipe"],
    shell: process.platform === "win32",
    windowsHide: true,
  });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-20000);
    process.stderr.write(chunk);
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  return { code, stderr };
}
let build = await run(["--filter", "@tranche/web", "build"]);
if (
  build.code !== 0 &&
  build.stderr.includes("SecurityFatalError") &&
  build.stderr.includes("Retry the same command")
) {
  console.warn(
    "Next.js requested one retry after its security notice; the notice remains unresolved.",
  );
  build = await run(["--filter", "@tranche/web", "build"]);
}
if (build.code !== 0) process.exit(build.code ?? 1);
const server = await run(["--filter", "@tranche/web", "start", "--port", "3100"]);
process.exit(server.code ?? 1);
