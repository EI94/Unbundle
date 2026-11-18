import { auth } from "@/lib/auth";
import { logSafeError } from "@/lib/log/safe-error";
import { loadAccountSheet } from "@/lib/shell/account-data";
import type { AccountSheetResponse } from "@/lib/shell/account";
import { getCollaboratorAccess } from "@/lib/workspace-access";

/**
 * Il foglio «Il tuo account» di chi guarda (rilascio 10, PROPOSTA-10 §3.10). Solo GET, senza scrivere niente: il
 * foglio la legge quando si apre e dopo ogni sua azione (le azioni sono quelle di sempre, con i loro controlli). Come la
 * campanella, una rotta e non una server action, così non aspetta dietro le azioni della pagina.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: AccountSheetResponse, status = 200): Response {
  return Response.json(body, { status, headers: HEADERS });
}

export async function GET(_req: Request, ctx: { params: Promise<{ workspaceId: string }> }): Promise<Response> {
  const { workspaceId } = await ctx.params;
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return json({ ok: false, code: "non_autenticato" }, 401);
  if (!UUID.test(workspaceId)) return json({ ok: false, code: "non_trovato" }, 404);
  try {
    // Chi segue solo un corso non ha preferenze né accessi qui: il foglio gli mostra il solo tema.
    const access = await getCollaboratorAccess(user.id, workspaceId);
    if (!access) return json({ ok: false, code: "non_trovato" }, 404);
    const account = await loadAccountSheet({
      workspaceId,
      user: { id: user.id, email: user.email ?? null, emailVerified: user.emailVerified === true },
      role: access.role,
    });
    return json({ ok: true, account });
  } catch (error) {
    logSafeError("account", "lettura", error, { workspaceId });
    return json({ ok: false, code: "riprova" }, 503);
  }
}
