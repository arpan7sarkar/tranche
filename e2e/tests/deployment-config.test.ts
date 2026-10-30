import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parse } from "yaml";

const compose = parse(
  readFileSync(new URL("../../deploy/vps/compose.yaml", import.meta.url), "utf8"),
);
it("keeps worker traffic private behind HTTPS and pauses domain workers by default", () => {
  expect(compose.services.worker.ports).toBeUndefined();
  // biome-ignore lint/suspicious/noTemplateCurlyInString: Docker Compose interpolation is intentional.
  expect(compose.services.worker.environment.WORKER_MODE).toBe("${WORKER_MODE:-health}");
  expect(compose.services.worker.environment.PAYPAL_ENV).toBe("sandbox");
  expect(compose.services.postgres.ports[0]).toContain("127.0.0.1");
});
it("uses persistent database storage, verified TLS, and an explicit migration service", () => {
  expect(compose.services.postgres.volumes).toContain("pgdata:/var/lib/postgresql");
  expect(compose.services.migrate.environment.DATABASE_SSL).toBe("verify-full");
  expect(compose.services.migrate.command).toContain("packages/db/scripts/migrate-deploy.ts");
  expect(compose.services.worker.environment.DATABASE_SSL).toBe("verify-full");
});
it("builds the complete Next.js application for Vercel without database migrations", () => {
  const config = JSON.parse(
    readFileSync(new URL("../../apps/web/vercel.json", import.meta.url), "utf8"),
  );
  expect(config.framework).toBe("nextjs");
  expect(config.installCommand).toContain("--frozen-lockfile");
  expect(config.buildCommand).not.toContain("migrate");
});
