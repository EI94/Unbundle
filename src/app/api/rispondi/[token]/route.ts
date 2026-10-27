import { loadReferentAskView } from "@/lib/db/queries/use-case-referent-public";
import { publicData } from "@/lib/uc/http";
import { handleReferentPublic } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/rispondi/[token]`: la vista della richiesta (`ReferentAskView`), per ricaricare la pagina
 * dopo un invio. Solo lettura: nessuna scrittura, nessun contatore dei limiti.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handleReferentPublic(request, token, { write: false, rate: null }, async ({ link, now }) => publicData(await loadReferentAskView(link, { env: process.env, now })));
}
