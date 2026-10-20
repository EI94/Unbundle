import { saveReferentDraft } from "@/lib/db/queries/uc-public";
import { handlePublic, outcomeResponse } from "../../../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `PUT /api/r/[token]/items/[itemId]/draft` `{ kind?, payload, note?, … }`:
 * salvataggio automatico. Normalizzazione non stretta e scansione: dati
 * sanitari o discriminatori non si salvano; gli altri problemi tornano come
 * `errors` da correggere prima dell'invio. Mai per le voci personali.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ token: string; itemId: string }> }) {
  const { token, itemId } = await params;
  return handlePublic(request, token, { write: true, rate: "bozza" }, async ({ executor, link, body, opts }) =>
    outcomeResponse(await saveReferentDraft(executor, link, itemId, body, opts)),
  );
}
