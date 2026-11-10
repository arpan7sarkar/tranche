import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { acquireJobLock } from "../src/vps/lock";

const url = process.env.DATABASE_URL ?? "";
assert.match(url, /^postgresql:\/\/vps_test:vps_test@127\.0\.0\.1:\d+\/vps_test$/);
const name = "vps-integration-money-tick";

if (process.argv[2] === "hold") {
  const lock = await acquireJobLock(name);
  assert(lock);
  process.stdout.write("LOCKED\n");
  await lock.lost;
  await lock.release();
  process.exitCode = 1;
} else {
  const child = spawn(
    process.execPath,
    [...process.execArgv, fileURLToPath(import.meta.url), "hold"],
    {
      env: {
        DATABASE_URL: url,
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        NODE_PATH: process.env.NODE_PATH,
      },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  const exited = once(child, "exit");
  let differentLock: Awaited<ReturnType<typeof acquireJobLock>> = null;
  let reacquired: Awaited<ReturnType<typeof acquireJobLock>> = null;
  try {
    const ready = Promise.race([
      once(child.stdout, "data").then(([data]) => String(data)),
      exited.then(() => {
        throw new Error("holder exited before acquiring the lock");
      }),
      delay(10_000).then(() => {
        throw new Error("holder did not become ready");
      }),
    ]);
    assert.equal(await ready, "LOCKED\n");
    assert.equal(await acquireJobLock(name), null);
    differentLock = await acquireJobLock(`${name}-other`);
    assert(differentLock);
    assert(child.kill("SIGKILL"));
    const [, signal] = await exited;
    assert.equal(signal, "SIGKILL");
    const deadline = Date.now() + 5_000;
    do {
      reacquired = await acquireJobLock(name);
      if (!reacquired) await delay(50);
    } while (!reacquired && Date.now() < deadline);
    assert(reacquired, "lock was not released after holder process death");
    process.stdout.write("PASS: lock exclusion, independent names, and crash release\n");
  } finally {
    await differentLock?.release();
    await reacquired?.release();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
  }
}
