import { actorFailure, json, notFoundJson, notReadyJson, serviceFailure } from "@/components/context/routes/respond";
import { contextActorFromSession } from "@/lib/context/server/actor";
import { contextAbilities } from "@/lib/context/visibility";
import { readContextSource } from "@/lib/db/queries/context-read";
import { contextStoreReady } from "@/lib/db/queries/context-store";

/**
 * «Leggi» e «Rileggi» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §3.5, §4.2): il modello legge una parte di
 * un appunto (o di un documento) contro la memoria di oggi e scrive le proposte. Solo Lateral Space.
 *
 * `{ again?: boolean }` → 200 `{ outcome: ReadOutcome }`, anche quando la lettura non riesce (rifiuto, tempo, errore,
 * manca l'ok, limite del giorno): l'esito lo dice. Finché restano parti risponde `in_corso` e chi chiama richiama:
 * una chiamata al modello per richiesta, dentro i 120 secondi della rotta (la lettura ne ha 90).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** `again` dal corpo: un corpo vuoto o non JSON vale «Leggi». */
async function readAgain(request: Request): Promise<boolean> {
  try {
    const text = await request.text();
    if (!text.trim()) return false;
    const body: unknown = JSON.parse(text);
    return body !== null && typeof body === "object" && (body as { again?: unknown }).again === true;
  } catch {
    return false;
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ workspaceId: string; sourceId: string }> }): Promise<Response> {
  const { workspaceId, sourceId } = await ctx.params;
  const who = await contextActorFromSession(workspaceId);
  if (!who.ok) return actorFailure(who.status);
  const actor = who.actor;
  if (!contextAbilities(actor).canAddNotes) return notFoundJson();
  if (!(await contextStoreReady())) return notReadyJson();
  const again = await readAgain(request);
  const result = await readContextSource(actor, sourceId, { again });
  if (!result.ok) return serviceFailure(result);
  return json({ outcome: result.value });
}
