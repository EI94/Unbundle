import { submitReferentAnswer } from "@/lib/db/queries/uc-public";
import { handlePublic, outcomeResponse } from "../../../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/r/[token]/items/[itemId]/answer`
 * `{ kind, payload, confidence | estimate, source_basis, valid_from, note, file_ids, partial, supersedes_answer_id?, who_might_know?, reason? }`:
 * valore, conferma o correzione del valore già noto, «Non lo so», «Non si
 * applica», risposta a un chiarimento. Normalizzazione stretta e scansione
 * bloccante; risposta nuova e transizione della voce nello stesso batch.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string; itemId: string }> }) {
  const { token, itemId } = await params;
  return handlePublic(request, token, { write: true, rate: "invio", refresh: true }, async ({ executor, link, body, opts }) =>
    outcomeResponse(await submitReferentAnswer(executor, link, itemId, body, opts)),
  );
}
