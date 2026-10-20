import { markLinkOpened } from "@/lib/db/queries/uc-public";
import { handlePublic, outcomeResponse } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/r/[token]/opened`, mandato dalla pagina dopo l'idratazione (mai su
 * GET, così scanner e prefetch non contano): `first_opened_at` una volta,
 * `inviata → aperta`, evento `link.aperto` al massimo una volta al giorno.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handlePublic(request, token, { write: true, rate: "apertura" }, async ({ executor, link, opts }) => outcomeResponse(await markLinkOpened(executor, link, opts)));
}
