import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parse } from "yaml";

const blueprint = parse(readFileSync(new URL("../../render.yaml", import.meta.url), "utf8"));
type Variable = {
  key?: string;
  value?: string;
  sync?: boolean;
  fromService?: { name: string };
  fromDatabase?: { name: string };
  fromGroup?: string;
};
type Service = {
  name: string;
  type: string;
  envVars: Variable[];
  preDeployCommand?: string;
  healthCheckPath?: string;
};
const services = blueprint.services as Service[];

it("resolves service, database and environment group references", () => {
  for (const service of services) {
    for (const variable of service.envVars) {
      if (variable.fromService)
        expect(services.some((s) => s.name === variable.fromService?.name)).toBe(true);
      if (variable.fromDatabase)
        expect(
          blueprint.databases.some((d: { name: string }) => d.name === variable.fromDatabase?.name),
        ).toBe(true);
      if (variable.fromGroup)
        expect(
          blueprint.envVarGroups.some((g: { name: string }) => g.name === variable.fromGroup),
        ).toBe(true);
    }
  }
});
it("keeps secrets service-scoped and starts cron without payment access", () => {
  for (const group of blueprint.envVarGroups) {
    for (const variable of group.envVars as Variable[]) {
      expect(variable.sync).not.toBe(false);
      expect(variable.key).not.toMatch(/SECRET|API_KEY|DATABASE_URL/);
    }
  }
  for (const cron of services.filter((s) => s.type === "cron")) {
    expect(cron.envVars).toContainEqual({ key: "TRANCHE_CRON_MODE", value: "health" });
    expect(cron.envVars.some((v) => /PAYPAL|DATABASE/.test(v.key ?? "") || v.fromGroup)).toBe(
      false,
    );
  }
});
it("gives migrations a single owner and avoids unsupported workflow deployment hooks", () => {
  expect(services.filter((s) => s.preDeployCommand).map((s) => s.type)).toEqual(["web"]);
  const workflow = services.find((s) => s.type === "workflow");
  expect(workflow).toBeDefined();
  expect(workflow?.healthCheckPath).toBeUndefined();
  expect(workflow?.preDeployCommand).toBeUndefined();
});
