import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { RepoRef } from "@tranche/contracts";
import { type Db, schema } from "@tranche/db";
import { repositoryAllowed } from "@tranche/verifiers";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";

export function verifyGitHubSignature(
  secret: string | undefined,
  body: string,
  signature: string | null,
): boolean {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}
const MergedPull = z.object({
  action: z.literal("closed"),
  repository: z.object({ full_name: RepoRef }),
  pull_request: z.object({
    number: z.number().int().positive(),
    merged: z.literal(true),
    merge_commit_sha: z.string().regex(/^[a-f0-9]{40}$/),
    base: z.object({ ref: z.string().min(1) }),
  }),
});
export async function recordGitHubDelivery(db: Db, payload: unknown) {
  const parsed = MergedPull.safeParse(payload);
  if (!parsed.success) return 0;
  const { repository, pull_request: pull } = parsed.data;
  const rows = await db
    .select({ milestone: schema.milestone, workspaceId: schema.deal.workspaceId })
    .from(schema.milestone)
    .innerJoin(schema.deal, eq(schema.deal.id, schema.milestone.dealId))
    .where(inArray(schema.milestone.state, ["held", "in_progress", "changes_requested"]));
  let count = 0;
  for (const { milestone: ms, workspaceId } of rows) {
    if (!repositoryAllowed(workspaceId, repository.full_name)) continue;
    const checks = ms.criteria.checks.filter(
      (c) => c.kind === "pr_merged" || c.kind === "ci_green",
    );
    if (
      !checks.length ||
      checks.some(
        (c) =>
          c.repo.toLowerCase() !== repository.full_name.toLowerCase() ||
          (c.kind === "pr_merged" && c.base !== pull.base.ref),
      )
    )
      continue;
    const urls = [
      ...new Set(ms.criteria.checks.flatMap((c) => ("url" in c && c.url ? [c.url] : []))),
    ];
    const inserted = await db
      .insert(schema.inbox)
      .values({
        source: "github",
        sourceEventId: `github:${ms.id}:${ms.version}:${pull.number}:${pull.merge_commit_sha}`,
        message: {
          type: "delivery.detected",
          milestoneId: ms.id,
          source: "github",
          repo: repository.full_name,
          sha: pull.merge_commit_sha,
          prNumber: pull.number,
          urls,
        },
      })
      .onConflictDoNothing()
      .returning({ id: schema.inbox.id });
    count += inserted.length;
  }
  return count;
}
