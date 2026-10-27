import { completeReferentClientUpload } from "@/lib/db/queries/use-case-referent-public";
import { handleReferentPublic, uploadOutcomeResponse } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/rispondi/[token]/upload-complete` `{ fileId }`: fine del caricamento diretto. Accetta solo
 * un file nato per questa richiesta e ancora in quarantena, poi avvia i controlli.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handleReferentPublic(request, token, { write: true, rate: "invio" }, async ({ link, body }) => uploadOutcomeResponse(await completeReferentClientUpload(link, body, process.env)));
}
