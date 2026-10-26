import "server-only";
import { Id } from "@tranche/contracts";
import { schema } from "@tranche/db";
import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import type { DealScope } from "./deals";

export async function evidenceImageResponse(id: string, scope: DealScope, dealId?: string) {
  if (!Id.safeParse(id).success) return new Response(null, { status: 404 });
  const [image] = await getDb()
    .select({ base64: schema.evidenceImage.base64 })
    .from(schema.evidenceImage)
    .innerJoin(schema.evidence, eq(schema.evidence.id, schema.evidenceImage.evidenceId))
    .innerJoin(schema.milestone, eq(schema.milestone.id, schema.evidence.milestoneId))
    .innerJoin(schema.deal, eq(schema.deal.id, schema.milestone.dealId))
    .where(
      and(
        eq(schema.evidenceImage.evidenceId, id),
        dealId ? eq(schema.deal.id, dealId) : undefined,
        "workspaceId" in scope
          ? eq(schema.deal.workspaceId, scope.workspaceId)
          : eq(schema.deal.clientId, scope.clientId),
      ),
    );
  if (!image) return new Response(null, { status: 404 });
  return new Response(Buffer.from(image.base64, "base64"), {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
    },
  });
}
