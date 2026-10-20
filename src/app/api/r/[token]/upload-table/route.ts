import { tableFromReferentFile } from "@/lib/db/queries/uc-public";
import { readUploadForm, uploadStatusFor } from "@/lib/uc/files/multipart";
import { publicError } from "@/lib/uc/http";
import { handlePublic } from "../handler";
import { uploadResponse } from "../upload-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/r/[token]/upload-table` (multipart: `file`, `itemId`,
 * `declaration=true`, ≤ 4 MB): «Carica un Excel» su una domanda tabella
 * (DESIGN §4.3 R2c). Il file si carica e si controlla come in `…/upload` e
 * resta allegato; se è pulito tornano anche le sue righe, che la pagina mette
 * nella tabella da controllare. Conta come un caricamento nel limite del link.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handlePublic(request, token, { write: true, rate: "upload", body: "raw" }, async ({ executor, link, request: req, opts }) => {
    const form = await readUploadForm(req);
    if (!form.ok) return publicError(form.code, { message: form.message, status: uploadStatusFor(form.code) });
    const result = await tableFromReferentFile(
      executor,
      link,
      { itemId: form.value.fields.itemId ?? "", fileName: form.value.file.name, declaration: form.value.fields.declaration === "true", bytes: form.value.file.bytes },
      { ipHash: opts.ipHash ?? null, userAgent: opts.userAgent ?? null },
      process.env,
      opts,
    );
    return uploadResponse(result);
  });
}
