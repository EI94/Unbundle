import { confirmReferentFile } from "@/lib/db/queries/use-case-referent-public";
import { handleReferentPublic, outcomeResponse } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/rispondi/[token]/file-confirm` `{ fileId }`: «Servono, lo lascio» del rilascio 5 su un
 * file in cui abbiamo trovato nomi, email o telefoni. (Rilascio 5.1) La pagina non lo chiede più e
 * l'invio non lo aspetta: resta solo per una pagina aperta prima del rilascio.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handleReferentPublic(request, token, { write: true, rate: "bozza" }, async ({ link, body }) => outcomeResponse(await confirmReferentFile(link, body)));
}
