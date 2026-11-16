import { contextActorFromSession } from "@/lib/context/server/actor";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { contextAbilities } from "@/lib/context/visibility";
import { granolaAvailable, syncGranolaForUser } from "@/lib/db/queries/context-granola";
import { contextStoreReady } from "@/lib/db/queries/context-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const NO_STORE = { "Cache-Control": "no-store" } as const;
/** Il giro sta dentro i 120 secondi della funzione, con il tempo per chiudere. */
const SYNC_BUDGET_MS = 90_000;

function errorResponse(status: 401 | 404 | 503): Response {
  const E = CONTEXT_TEXT.errors;
  const body =
    status === 401 ? { error: "permesso_mancante", message: E.denied } : status === 404 ? { error: "non_trovato", message: E.notFound } : { error: "area_spenta", message: E.notReady };
  return Response.json(body, { status, headers: NO_STORE });
}

/**
 * «Aggiorna da Granola» e il giro quando una persona di Lateral Space apre «Contesto» (rilascio 9a,
 * docs/contesto/RILASCIO-9a-COSTRUZIONE.md §8.7): `POST { force?: boolean }` → `GranolaSyncResult`. Con `force` falso
 * il giro parte solo se l'ultimo ha più di 30 minuti. Solo Lateral Space, solo con Granola attivo: agli altri 404
 * (non si dice che la rotta c'è). Il giro non legge con il modello: gli appunti entrano da leggere.
 */
export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string }> }): Promise<Response> {
  const { workspaceId } = await params;
  const who = await contextActorFromSession(workspaceId);
  if (!who.ok) return errorResponse(who.status);
  if (!contextAbilities(who.actor).canUseGranola || !granolaAvailable()) return errorResponse(404);
  if (!(await contextStoreReady())) return errorResponse(503);
  let force = false;
  if ((request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    try {
      const body = (await request.json()) as { force?: unknown } | null;
      force = body?.force === true;
    } catch {
      // Un corpo vuoto o rotto vale `force: false`.
    }
  }
  const result = await syncGranolaForUser(who.actor.userId, { force, budgetMs: SYNC_BUDGET_MS });
  return Response.json(result, { headers: NO_STORE });
}
