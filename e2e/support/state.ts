import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../.state/seed.json", import.meta.url);

export type JourneyDeal = {
  dealId: string;
  milestoneId: string;
  portalToken: string;
  taskIds: Record<string, string>;
};
export type SeedState = {
  workspaceId: string;
  happy: JourneyDeal;
  rejected: JourneyDeal;
  slip: JourneyDeal;
  recovery: JourneyDeal;
  pullRequest: JourneyDeal;
};

export function writeState(s: SeedState) {
  mkdirSync(new URL("../.state/", import.meta.url), { recursive: true });
  writeFileSync(FILE, JSON.stringify(s, null, 2));
}

export function readState(): SeedState {
  return JSON.parse(readFileSync(FILE, "utf8"));
}

export const AGENCY = {
  email: "e2e@tranche.dev",
  password: "e2e-password-123",
  name: "E2E Studio",
};
export const STAGING = "http://localhost:4020";
