import { z } from "zod";
import { Id } from "./ids";

export const EvidenceKind = z.enum([
  "pr_merged",
  "ci_green",
  "url_live",
  "lighthouse",
  "screenshot",
  "ai_verdict",
]);
export type EvidenceKind = z.infer<typeof EvidenceKind>;

export const EvidenceInput = z.object({
  milestoneId: Id,
  kind: EvidenceKind,
  checkIndex: z.number().int().nonnegative().nullable(),
  passed: z.boolean().nullable(),
  summary: z.string().max(2000),
  data: z.record(z.string(), z.unknown()),
  contentHash: z.string().min(8).max(128),
});
export type EvidenceInput = z.infer<typeof EvidenceInput>;
