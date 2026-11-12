import { z } from "zod";
import { RepoRef } from "./ids";

export const LighthouseCategory = z.enum(["performance", "accessibility", "best-practices", "seo"]);

export const MachineCheck = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pr_merged"), repo: RepoRef, base: z.string().min(1) }),
  z.object({ kind: z.literal("ci_green"), repo: RepoRef }),
  z.object({ kind: z.literal("url_live"), url: z.url().optional() }),
  z.object({
    kind: z.literal("lighthouse"),
    url: z.url(),
    category: LighthouseCategory,
    min: z.number().int().min(0).max(100),
  }),
]);
export type MachineCheck = z.infer<typeof MachineCheck>;

export const AcceptanceCriteria = z.object({
  checks: z.array(MachineCheck).min(1).max(20),
  prose: z.array(z.string().min(1).max(500)).max(20),
});
export type AcceptanceCriteria = z.infer<typeof AcceptanceCriteria>;
