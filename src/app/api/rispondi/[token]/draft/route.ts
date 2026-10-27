import { saveReferentDraft } from "@/lib/db/queries/use-case-referent-public";
import { handleReferentPublic, outcomeResponse } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/rispondi/[token]/draft` `{ needId, text, dontKnow }`: la bozza di una domanda. Il testo
 * passa dal controllo (nomi, email, telefoni, dati sanitari): un blocco non salva niente.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handleReferentPublic(request, token, { write: true, rate: "bozza" }, async ({ link, body, now }) => outcomeResponse(await saveReferentDraft(link, body, now)));
}
