import { actorFailure, json, notFoundJson, notReadyJson } from "@/components/context/routes/respond";
import { contextActorFromSession } from "@/lib/context/server/actor";
import { contextAbilities } from "@/lib/context/visibility";
import { getContextSource } from "@/lib/db/queries/context-sources";
import { contextStoreReady } from "@/lib/db/queries/context-store";

/**
 * Il pannello di un appunto o di un documento nella vista «Appunti» (rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §3.5,
 * §7.5): il testo (o niente dopo i 12 mesi), «Con chi», il link, chi l'ha aggiunto. Solo Lateral Space: al cliente 404.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(_request: Request, ctx: { params: Promise<{ workspaceId: string; sourceId: string }> }): Promise<Response> {
  const { workspaceId, sourceId } = await ctx.params;
  const who = await contextActorFromSession(workspaceId);
  if (!who.ok) return actorFailure(who.status);
  const actor = who.actor;
  if (!contextAbilities(actor).seesLateralSpace) return notFoundJson();
  if (!(await contextStoreReady())) return notReadyJson();
  const detail = await getContextSource(actor, sourceId);
  if (!detail) return notFoundJson();
  return json(detail);
}
