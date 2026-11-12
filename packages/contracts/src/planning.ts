import { z } from "zod";
import { Id, IsoDate, RepoRef } from "./ids";

export const ReferenceUrl = z.url({ protocol: /^https?$/ }).refine((value) => {
  const url = new URL(value);
  return !url.username && !url.password;
}, "URLs cannot contain credentials");
export const StagingUrl = ReferenceUrl.refine((value) => {
  const host = new URL(value).hostname.toLowerCase();
  return host !== "figma.com" && !host.endsWith(".figma.com");
}, "Use the deployed website URL, not a Figma reference. Put design references in the project brief.");
export const PlanningOptions = z.object({
  repo: RepoRef.nullable(),
  referenceUrl: ReferenceUrl.nullable().optional().default(null),
  // Retained for existing API clients and historical planning events.
  stagingUrl: ReferenceUrl.nullable().optional().default(null),
  startDate: IsoDate,
});
export function planningTargets(options: {
  stagingUrl?: string | null;
  referenceUrl?: string | null;
}) {
  const stagingUrl = StagingUrl.safeParse(options.stagingUrl).success
    ? (options.stagingUrl ?? null)
    : null;
  return {
    stagingUrl,
    referenceUrl: options.referenceUrl ?? (stagingUrl ? null : (options.stagingUrl ?? null)),
  };
}
export const PlanDealInput = PlanningOptions.extend({ dealId: Id });
export type PlanDealInput = z.infer<typeof PlanDealInput>;
export const DraftRequest = PlanningOptions.extend({
  requestId: Id,
  title: z.string().trim().min(3).max(200),
  clientName: z.string().trim().min(1).max(200),
  clientEmail: z.email(),
  brief: z.string().trim().min(40).max(20_000),
});
export type DraftRequest = z.infer<typeof DraftRequest>;
