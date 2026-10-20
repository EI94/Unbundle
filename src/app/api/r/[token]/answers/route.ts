import { submitReferentAnswers } from "@/lib/db/queries/uc-public";
import { PUBLIC_BATCH_BODY_MAX_BYTES } from "@/lib/uc/http";
import { handlePublic, outcomeResponse } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/r/[token]/answers` `{ answers: [{ item_id, kind, payload, … }] }`
 * (DESIGN §4.2, §7.1 P0-11): l'invio del riepilogo di un argomento, al
 * massimo 50 risposte, con una sola unità del limite degli invii e un esito
 * per ogni risposta (`{ sent, failed, results }`). Ogni risposta ha le regole
 * di `POST …/items/[itemId]/answer`; dati personali e risposte a un
 * chiarimento non entrano qui: partono da sole.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handlePublic(request, token, { write: true, rate: "invio", refresh: true, maxBytes: PUBLIC_BATCH_BODY_MAX_BYTES }, async ({ executor, link, body, opts }) =>
    outcomeResponse(await submitReferentAnswers(executor, link, body, opts)),
  );
}
