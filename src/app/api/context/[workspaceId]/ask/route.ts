import { actorFailure, badBodyJson, failJson, json, notFoundJson, notReadyJson, readJsonObject, serviceFailure, textField } from "@/components/context/routes/respond";
import { contextActorFromSession } from "@/lib/context/server/actor";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { contextAbilities } from "@/lib/context/visibility";
import { askContext } from "@/lib/db/queries/context-ask";
import { contextStoreReady } from "@/lib/db/queries/context-store";

/**
 * «Chiedi al contesto» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §3.5, §4.4): una domanda, una risposta
 * breve con le fonti, solo da quello che chi chiede può vedere. Per chi apre la pagina.
 *
 * `{ question }` → 200 `AskAnswer`. Troppe domande: 429 `{ error: "limite", message }` con `Retry-After`. Una domanda
 * troppo corta, troppo lunga o con dati sanitari: 422. Il modello non risponde (rifiuto, tempo, errore): 503.
 * La chiamata al modello ha 40 secondi, dentro i 60 della rotta.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, ctx: { params: Promise<{ workspaceId: string }> }): Promise<Response> {
  const { workspaceId } = await ctx.params;
  const who = await contextActorFromSession(workspaceId);
  if (!who.ok) return actorFailure(who.status);
  const actor = who.actor;
  if (!contextAbilities(actor).canAsk) return notFoundJson();
  if (!(await contextStoreReady())) return notReadyJson();
  const body = await readJsonObject(request);
  if (!body) return badBodyJson();
  const result = await askContext(actor, textField(body, "question") ?? "");
  if (!result.ok) return serviceFailure(result);
  const answer = result.value;
  if (answer.status === "limite") {
    const seconds = Math.max(1, Math.ceil(Number.isFinite(answer.retryAfterSeconds) ? answer.retryAfterSeconds : 60));
    return failJson(429, "limite", CONTEXT_TEXT.ask.limit, undefined, { "Retry-After": String(seconds) });
  }
  return json(answer);
}
