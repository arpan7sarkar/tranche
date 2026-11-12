import { decryptGmailToken, gmailConfig } from "@tranche/agents-service/gmail";
import { schema } from "@tranche/db";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { gmailOwner, gmailSameOrigin } from "@/server/gmail";

export async function POST(request: Request) {
  const owner = await gmailOwner();
  if (!owner) return Response.json({ error: "Workspace owner access required." }, { status: 403 });
  if (!gmailSameOrigin(request))
    return Response.json({ error: "Invalid request origin." }, { status: 400 });
  const [connection] = await getDb()
    .delete(schema.gmailConnection)
    .where(eq(schema.gmailConnection.workspaceId, owner.workspaceId))
    .returning();
  const config = gmailConfig();
  if (connection && config) {
    try {
      const token = decryptGmailToken(
        connection.refreshTokenCiphertext,
        owner.workspaceId,
        config.key,
      );
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      /* Local disconnection is effective even when Google is unavailable. */
    }
  }
  return Response.json({ disconnected: true });
}
