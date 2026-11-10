import { createDb } from "@tranche/db";
import type { Lock } from "./scheduler";

export type LockSession = {
  acquire(name: string): Promise<boolean>;
  heartbeat(): Promise<void>;
  close(): Promise<void>;
};
export type OpenLockSession = (onClose: () => void) => Promise<LockSession>;

async function openDatabaseSession(onClose: () => void): Promise<LockSession> {
  const client = createDb().$client;
  client.options.onclose = onClose;
  try {
    const connection = await client.reserve();
    return {
      async acquire(name) {
        const [row] = await connection<{ locked: boolean }[]>`
          select pg_try_advisory_lock(hashtextextended(${`tranche:vps:${name}`}, 0)) as locked
        `;
        return row?.locked === true;
      },
      async heartbeat() {
        await connection`select 1`;
      },
      async close() {
        await client.end({ timeout: 0 });
      },
    };
  } catch {
    await client.end({ timeout: 0 }).catch(() => {});
    throw new Error("lock_connection_failed");
  }
}

export async function acquireJobLock(
  name: string,
  openSession: OpenLockSession = openDatabaseSession,
): Promise<Lock | null> {
  let closed = false;
  let failed = false;
  let notifyLost = () => {};
  const lost = new Promise<void>((resolve) => {
    notifyLost = resolve;
  });
  const fail = () => {
    if (closed || failed) return;
    failed = true;
    notifyLost();
  };
  let heartbeat: NodeJS.Timeout | undefined;
  let deadline: NodeJS.Timeout | undefined;
  const bounded = async <T>(operation: Promise<T>): Promise<T> => {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            fail();
            reject(new Error("lock_timeout"));
          }, 10_000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const opening = openSession(fail);
  void opening.then(
    (session) => {
      if (failed) void session.close().catch(() => {});
    },
    () => {},
  );
  const session = await bounded(opening);
  const release = async () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearTimeout(heartbeat);
    if (deadline) clearTimeout(deadline);
    await session.close();
  };
  try {
    const acquired = await bounded(session.acquire(name));
    if (failed) throw new Error("lock_connection_lost");
    if (!acquired) {
      await release();
      return null;
    }
    const check = () => {
      if (closed || failed) return;
      deadline = setTimeout(fail, 5_000);
      void Promise.resolve()
        .then(() => session.heartbeat())
        .then(() => {
          if (deadline) clearTimeout(deadline);
          if (!closed && !failed) heartbeat = setTimeout(check, 2_000);
        }, fail);
    };
    heartbeat = setTimeout(check, 2_000);
    return { lost, release };
  } catch {
    await release().catch(() => {});
    throw new Error("lock_unavailable");
  }
}
