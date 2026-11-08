import { editReferentAnswer, scheduleReferentDispatch } from "@/lib/db/queries/use-case-referent-public";
import { handleReferentPublic, outcomeResponse } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * (Rilascio 6) `POST /api/rispondi/[token]/edit` `{ needId, text }`: la modifica di una risposta già inviata, finché
 * il team non segna l'informazione «A posto» (decisione 3 del titolare); dopo `risposta_chiusa`. Gli avvisi
 * partono dopo la risposta.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handleReferentPublic(request, token, { write: true, rate: "invio" }, async ({ link, body, now }) => {
    const outcome = await editReferentAnswer(link, body, now);
    if (outcome.ok) scheduleReferentDispatch(link.requestId);
    return outcomeResponse(outcome);
  });
}
