import { replyToReferentClarification, scheduleReferentDispatch } from "@/lib/db/queries/use-case-referent-public";
import { handleReferentPublic, outcomeResponse } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * (Rilascio 6) `POST /api/rispondi/[token]/reply` `{ messageId, text }`: la risposta del referente a un chiarimento
 * del team. L'informazione torna «Da verificare»; con niente altro di aperto la richiesta torna completata. Gli
 * avvisi partono dopo la risposta.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handleReferentPublic(request, token, { write: true, rate: "invio" }, async ({ link, body, now }) => {
    const outcome = await replyToReferentClarification(link, body, now);
    if (outcome.ok) scheduleReferentDispatch(link.requestId);
    return outcomeResponse(outcome);
  });
}
