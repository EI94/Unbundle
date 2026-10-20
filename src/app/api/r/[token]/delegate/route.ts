import { delegateItems } from "@/lib/db/queries/uc-public";
import { handlePublic, outcomeResponse } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/r/[token]/delegate` `{ nome, email, messaggio?, voci: [itemId] }`:
 * «Chiedi a un collega». Profondità ≤ 2, ≤ 5 deleghe al giorno; un dominio nuovo
 * per il caso aspetta l'approvazione di Lateral Space. Senza email configurata il
 * link del collega torna una volta (`link`).
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handlePublic(request, token, { write: true, rate: "invio", refresh: true }, async ({ executor, link, body, opts }) =>
    outcomeResponse(await delegateItems(executor, link, body, opts)),
  );
}
