import { contextActorFromSession } from "@/lib/context/server/actor";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { contextAbilities } from "@/lib/context/visibility";
import { loadAiConsentNotice } from "@/lib/db/queries/context-consent";

/**
 * L'ok ai sub-responsabili del workspace, per chi apre la pagina (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md
 * §3.5, §6.3): `{ ok: true }`, oppure `{ ok: false, notice }` con i dati dell'avviso per chi guarda (chi può dare l'ok,
 * con un clic o da Impostazioni). La chiede la chat di Discovery e di mappatura al montaggio: senza l'ok mostra l'avviso
 * al posto del campo per scrivere. L'ok non sta nelle tabelle della 0038: la rotta risponde anche senza.
 * Senza sessione 401; senza accesso, o per chi segue solo un corso, 404.
 */
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const who = await contextActorFromSession(workspaceId);
  if (!who.ok) {
    return who.status === 401
      ? Response.json({ error: "non_autorizzato", message: CONTEXT_TEXT.errors.denied }, { status: 401, headers: NO_STORE })
      : Response.json({ error: "non_trovato", message: CONTEXT_TEXT.errors.notFound }, { status: 404, headers: NO_STORE });
  }
  if (!contextAbilities(who.actor).canOpen) return Response.json({ error: "non_trovato", message: CONTEXT_TEXT.errors.notFound }, { status: 404, headers: NO_STORE });
  const notice = await loadAiConsentNotice({ workspaceId: who.actor.workspaceId, userId: who.actor.userId, role: who.actor.role });
  return Response.json(notice ? { ok: false, notice } : { ok: true }, { headers: NO_STORE });
}
