import { markReferentMessagesSeen } from "@/lib/db/queries/use-case-referent-public";
import { handleReferentPublic, outcomeResponse } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * (Rilascio 6) `POST /api/rispondi/[token]/seen` `{ ids }`: la pagina ha mostrato queste risposte del team.
 * Solo il segno «vista» sui messaggi del team di questa richiesta: niente Storia, niente avvisi.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handleReferentPublic(request, token, { write: true, rate: "bozza" }, async ({ link, body }) => outcomeResponse(await markReferentMessagesSeen(link, body)));
}
