import { uploadFromReferent } from "@/lib/db/queries/uc-files";
import { readUploadForm, uploadStatusFor } from "@/lib/uc/files/multipart";
import { publicError } from "@/lib/uc/http";
import { handlePublic } from "../handler";
import { uploadResponse } from "../upload-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/r/[token]/upload` (modalità server, ≤ 4 MB, multipart: `file`,
 * `itemId`, `declaration=true`): allegato del referente a una sua domanda.
 * La riga nasce in quarantena, i byte si controllano subito (tipo dal
 * contenuto, intestazioni, testo sanitario): un file con «visita medica» viene
 * cancellato e l'evento lo registra senza contenuto. Obbligatoria per la zona
 * personale (cifratura prima della scrittura). 10 caricamenti all'ora per link.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handlePublic(request, token, { write: true, rate: "upload", body: "raw" }, async ({ executor, link, request: req, opts }) => {
    const form = await readUploadForm(req);
    if (!form.ok) return publicError(form.code, { message: form.message, status: uploadStatusFor(form.code) });
    const result = await uploadFromReferent(
      executor,
      link,
      { itemId: form.value.fields.itemId ?? "", fileName: form.value.file.name, declaration: form.value.fields.declaration === "true", bytes: form.value.file.bytes },
      { ipHash: opts.ipHash ?? null, userAgent: opts.userAgent ?? null },
      process.env,
    );
    return uploadResponse(result);
  });
}
