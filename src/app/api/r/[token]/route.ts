import { loadReferentView } from "@/lib/db/queries/uc-public";
import { publicData } from "@/lib/uc/http";
import { handlePublic } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/r/[token]`: le voci del referente (raggruppate per modulo), lo stato,
 * la scadenza del link; nel link di approvazione le firme in attesa. Solo
 * lettura: nessun evento, nessun `first_opened_at` (si registra con `POST …/opened`).
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handlePublic(request, token, { write: false, rate: null }, async ({ executor, link, opts }) => publicData(await loadReferentView(executor, link, opts)));
}
