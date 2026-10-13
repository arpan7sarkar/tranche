import "server-only";
import { schema } from "@tranche/db";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isUuid } from "@/lib/uuid";
import { auth } from "./auth";
import { getDb } from "./db";

export type Member = { userId: string; name: string; workspaceId: string; workspaceName: string };

export type DealAccess =
  | { ok: true; userId: string; workspaceId: string }
  | { ok: false; response: Response };

async function memberFor(h: Headers): Promise<Member | null> {
  const session = await auth.api.getSession({ headers: h });
  if (!session) return null;
  const [row] = await getDb()
    .select({ workspaceId: schema.workspace.id, workspaceName: schema.workspace.name })
    .from(schema.workspaceMember)
    .innerJoin(schema.workspace, eq(schema.workspace.id, schema.workspaceMember.workspaceId))
    .where(eq(schema.workspaceMember.userId, session.user.id))
    .limit(1);
  return row ? { userId: session.user.id, name: session.user.name, ...row } : null;
}

export async function getMember(): Promise<Member | null> {
  return memberFor(await headers());
}

export async function requireMember(): Promise<Member> {
  const member = await getMember();
  if (!member) redirect("/sign-in");
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
