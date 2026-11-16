import { actorFailure, badBodyJson, json, notFoundJson, notReadyJson, readJsonObject, serviceFailure, textField } from "@/components/context/routes/respond";
import { contextActorFromSession } from "@/lib/context/server/actor";
import { contextAbilities } from "@/lib/context/visibility";
import { addContextNote } from "@/lib/db/queries/context-sources";
import { contextStoreReady } from "@/lib/db/queries/context-store";

/**
 * «Aggiungi appunti» dal web (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §3.5, §7.3): salva gli appunti di
 * una call. Solo Lateral Space. Non legge: la lettura è `POST …/sources/<id>/read`, chiamata subito dopo dalla pagina.
 *
 * `{ title, occurredOn, body, participants?, link? }` → 200 `AddedSource` (`created: false` se lo stesso testo c'è già);
 * 422 con `fieldErrors` per i dati non validi, e con il messaggio della parola trovata per un testo fermato dal controllo.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request, ctx: { params: Promise<{ workspaceId: string }> }): Promise<Response> {
  const { workspaceId } = await ctx.params;
  const who = await contextActorFromSession(workspaceId);
  if (!who.ok) return actorFailure(who.status);
  const actor = who.actor;
  if (!contextAbilities(actor).canAddNotes) return notFoundJson();
  if (!(await contextStoreReady())) return notReadyJson();
  const body = await readJsonObject(request);
  if (!body) return badBodyJson();
  const result = await addContextNote(actor, {
    title: textField(body, "title") ?? "",
    occurredOn: textField(body, "occurredOn") ?? "",
    body: textField(body, "body") ?? "",
    participants: textField(body, "participants"),
    link: textField(body, "link"),
    origin: "web",
  });
  if (!result.ok) return serviceFailure(result);
  return json(result.value);
}
