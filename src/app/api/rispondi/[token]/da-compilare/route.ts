import { openReferentTemplateDownload } from "@/lib/db/queries/use-case-referent-public";
import { publicAttachmentResponse } from "@/lib/uc/http";
import { handleReferentPublic } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * («File da compilare») `GET /api/rispondi/[token]/da-compilare?file=<id>`: il file da compilare di una domanda,
 * sempre come allegato. Solo un file pulito che la pagina di questo link offre adesso, con l'informativa letta; ogni
 * altro caso (link scaduto o revocato, file tolto o sostituito, un'altra richiesta, workspace o scheda, un file da
 * controllare) è lo stesso 404 del link non valido. Conta nei limiti per IP e del link («apertura»); la GET, mai una
 * HEAD, registra il primo download di questa versione nella Storia.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handleReferentPublic(request, token, { write: false, rate: "apertura" }, async ({ link, request: req, now }) => {
    const fileId = new URL(req.url).searchParams.get("file");
    return publicAttachmentResponse(await openReferentTemplateDownload(link, fileId, { env: process.env, now, record: req.method === "GET" }));
  });
}
