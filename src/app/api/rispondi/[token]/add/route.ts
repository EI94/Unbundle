import { addToReferentAnswer, scheduleReferentDispatch } from "@/lib/db/queries/use-case-referent-public";
import { handleReferentPublic, outcomeResponse } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * (Rilascio 6) `POST /api/rispondi/[token]/add` `{ anchor, needId?, componentKey?, text }`: «Aggiungi qualcosa» a una
 * risposta già inviata. Il team la vede «Aggiornata», di nuovo da verificare. Gli avvisi partono dopo la risposta.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handleReferentPublic(request, token, { write: true, rate: "invio" }, async ({ link, body, now }) => {
    const outcome = await addToReferentAnswer(link, body, now);
    if (outcome.ok) scheduleReferentDispatch(link.requestId);
    return outcomeResponse(outcome);
  });
}
