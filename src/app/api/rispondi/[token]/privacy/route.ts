import { acceptReferentPrivacy } from "@/lib/db/queries/use-case-referent-public";
import { handleReferentPublic, outcomeResponse } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/rispondi/[token]/privacy` `{ version }`: «Ho letto, iniziamo». L'accettazione si registra
 * sulla richiesta con la versione dell'informativa; senza, il link non salva bozze, file o risposte.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handleReferentPublic(request, token, { write: true, rate: "apertura" }, async ({ link, body, now }) => outcomeResponse(await acceptReferentPrivacy(link, body, now)));
}
