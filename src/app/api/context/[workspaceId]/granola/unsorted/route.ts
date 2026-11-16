import { contextActorFromSession } from "@/lib/context/server/actor";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { contextAbilities } from "@/lib/context/visibility";
import { granolaAvailable, listGranolaUnsorted } from "@/lib/db/queries/context-granola";
import { contextStoreReady } from "@/lib/db/queries/context-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" } as const;

function errorResponse(status: 401 | 404 | 503, error?: string, message?: string): Response {
  const E = CONTEXT_TEXT.errors;
  const fallback = status === 401 ? { error: "permesso_mancante", message: E.denied } : status === 404 ? { error: "non_trovato", message: E.notFound } : { error: "area_spenta", message: E.notReady };
  return Response.json(error && message ? { error, message } : fallback, { status, headers: NO_STORE });
}

/**
 * «Da smistare» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §8.7): le call di Granola che non sappiamo di
 * quale cliente sono, lette dal vivo con il token di chi guarda → `{ meetings: UnsortedMeeting[] }`. Niente si salva.
 * Solo Lateral Space con Granola collegato: agli altri 404. Granola che chiede di aspettare, o che non risponde: 503
 * con il messaggio da mostrare.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }): Promise<Response> {
  const { workspaceId } = await params;
  const who = await contextActorFromSession(workspaceId);
  if (!who.ok) return errorResponse(who.status);
  if (!contextAbilities(who.actor).canUseGranola || !granolaAvailable()) return errorResponse(404);
  if (!(await contextStoreReady())) return errorResponse(503);
  const result = await listGranolaUnsorted(who.actor);
  if (result.ok) return Response.json({ meetings: result.value }, { headers: NO_STORE });
  if (result.error === "permesso_mancante" || result.error === "non_trovato") return errorResponse(404);
  return errorResponse(503, result.error, result.message);
}
