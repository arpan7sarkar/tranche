import { z } from "zod";
import { Id, IsoDate, RepoRef } from "./ids";

export const StagingUrl = z.url({ protocol: /^https?$/ }).refine((value) => {
  const url = new URL(value);
  return !url.username && !url.password;
}, "URLs cannot contain credentials");
export const PlanningOptions = z.object({
  repo: RepoRef.nullable(),
  stagingUrl: StagingUrl,
  startDate: IsoDate,
});
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
