import { actorFailure, json, notFoundJson, notReadyJson } from "@/components/context/routes/respond";
import { contextActorFromSession } from "@/lib/context/server/actor";
import { contextAbilities } from "@/lib/context/visibility";
import { getFactDetail } from "@/lib/db/queries/context-memory";
import { contextStoreReady } from "@/lib/db/queries/context-store";

/**
 * Il pannello di un fatto (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §3.5, §7.2): per chi apre la pagina la
 * fonte, l'ultima conferma e gli use case; per Lateral Space anche citazione, storia e chi ha confermato. Un fatto
 * «Solo Lateral Space» per il cliente non c'è: 404.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(_request: Request, ctx: { params: Promise<{ workspaceId: string; factId: string }> }): Promise<Response> {
  const { workspaceId, factId } = await ctx.params;
  const who = await contextActorFromSession(workspaceId);
  if (!who.ok) return actorFailure(who.status);
  const actor = who.actor;
  if (!contextAbilities(actor).canOpen) return notFoundJson();
  if (!(await contextStoreReady())) return notReadyJson();
  const detail = await getFactDetail(actor, factId);
  if (!detail) return notFoundJson();
  return json(detail);
}
