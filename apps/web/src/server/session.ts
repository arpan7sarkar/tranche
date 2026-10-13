import "server-only";
import { schema } from "@tranche/db";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PATH_HEADER } from "@/lib/request-path";
import { safeNextPath } from "@/lib/safe-next";
import { isUuid } from "@/lib/uuid";
import { auth } from "./auth";
import { getDb } from "./db";
import { createWorkspaceFor } from "./workspaces";

export type Member = { userId: string; name: string; workspaceId: string; workspaceName: string };

export type DealAccess =
  | { ok: true; userId: string; workspaceId: string }
  | { ok: false; response: Response };

async function workspaceOf(userId: string) {
  const [row] = await getDb()
    .select({ workspaceId: schema.workspace.id, workspaceName: schema.workspace.name })
    .from(schema.workspaceMember)
    .innerJoin(schema.workspace, eq(schema.workspace.id, schema.workspaceMember.workspaceId))
    .where(eq(schema.workspaceMember.userId, userId))
    .limit(1);
  return row;
}

async function memberFor(h: Headers): Promise<Member | null> {
  const session = await auth.api.getSession({ headers: h });
  if (!session) return null;
  const { id, name } = session.user;
  let row = await workspaceOf(id);
  if (!row) {
    await createWorkspaceFor(getDb(), { id, name });
    row = await workspaceOf(id);
  }
  return row ? { userId: id, name, ...row } : null;
}

export async function getMember(): Promise<Member | null> {
  return memberFor(await headers());
}

export async function requireMember(): Promise<Member> {
  const member = await getMember();
  if (!member) {
    const next = safeNextPath((await headers()).get(PATH_HEADER), "");
    redirect(next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in");
  }
  return member;
}

export function memberOrNull(request: Request): Promise<Member | null> {
  return memberFor(request.headers);
}

export async function requireDealAccess(dealId: string): Promise<DealAccess> {
  const member = await getMember();
  if (!member)
    return { ok: false, response: Response.json({ error: "unauthorized" }, { status: 401 }) };
  const notFound = {
    ok: false,
    response: Response.json({ error: "not_found" }, { status: 404 }),
  } as const;
  if (!isUuid(dealId)) return notFound;
  const [deal] = await getDb()
    .select({ id: schema.deal.id })
    .from(schema.deal)
    .where(and(eq(schema.deal.id, dealId), eq(schema.deal.workspaceId, member.workspaceId)));
  if (!deal) return notFound;
  return { ok: true, userId: member.userId, workspaceId: member.workspaceId };
}
