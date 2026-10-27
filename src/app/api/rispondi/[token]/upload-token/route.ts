import { beginReferentClientUpload } from "@/lib/db/queries/use-case-referent-public";
import { handleReferentPublic, uploadOutcomeResponse } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/rispondi/[token]/upload-token` `{ needId, fileName, size, declaration }` (caricamento
 * diretto, fino a 20 MB): prima la riga in quarantena con il suo percorso, poi un permesso di Vercel
 * Blob privato valido solo per quel percorso. Senza caricamento diretto: `modalita_non_disponibile`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handleReferentPublic(request, token, { write: true, rate: "upload" }, async ({ link, body }) => uploadOutcomeResponse(await beginReferentClientUpload(link, body, process.env)));
}
