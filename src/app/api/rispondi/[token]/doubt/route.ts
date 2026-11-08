import { postReferentDoubt, scheduleReferentDispatch } from "@/lib/db/queries/use-case-referent-public";
import { handleReferentPublic, outcomeResponse } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * (Rilascio 6) `POST /api/rispondi/[token]/doubt` `{ anchor, needId?, componentKey?, text }`: «Ho un dubbio», una
 * domanda del referente al team su una domanda, una voce dell'impatto o in generale. La campanella e l'avviso
 * a chi ha chiesto partono dopo la risposta, mai qui dentro.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handleReferentPublic(request, token, { write: true, rate: "invio" }, async ({ link, body, now }) => {
    const outcome = await postReferentDoubt(link, body, now);
    if (outcome.ok) scheduleReferentDispatch(link.requestId);
    return outcomeResponse(outcome);
  });
}
