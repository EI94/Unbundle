import { completeReferentUpload } from "@/lib/db/queries/uc-files";
import { handlePublic } from "../handler";
import { uploadResponse } from "../upload-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/r/[token]/upload-complete` `{ fileId }`: fine del caricamento
 * diretto. Accetta solo un `fileId` emesso per questa richiesta e questo
 * referente, ancora in quarantena; controlla con `head()` che l'oggetto esista
 * proprio al percorso della riga e stia nel limite, poi avvia la pipeline di
 * quarantena. Nessun altro percorso di Blob può entrare.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handlePublic(request, token, { write: true, rate: "invio" }, async ({ executor, link, body, opts }) =>
    uploadResponse(await completeReferentUpload(executor, link, body, { ipHash: opts.ipHash ?? null, userAgent: opts.userAgent ?? null }, process.env)),
  );
}
