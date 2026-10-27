import { scheduleReferentDispatch, submitReferentAnswers } from "@/lib/db/queries/use-case-referent-public";
import { handleReferentPublic, outcomeResponse } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/rispondi/[token]/submit` `{ needIds? }`: «Invia le risposte». Tutto in una transazione,
 * oppure niente. Le email (la conferma al referente, l'avviso a chi ha chiesto) partono dopo la
 * risposta, mai qui dentro.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handleReferentPublic(request, token, { write: true, rate: "invio" }, async ({ link, body, now }) => {
    const outcome = await submitReferentAnswers(link, body, now);
    if (outcome.ok) scheduleReferentDispatch(link.requestId);
    return outcomeResponse(outcome);
  });
}
