import { uploadReferentFileServer } from "@/lib/db/queries/use-case-referent-public";
import { readUploadForm, uploadStatusFor } from "@/lib/uc/files/multipart";
import { publicError } from "@/lib/uc/http";
import { handleReferentPublic, uploadOutcomeResponse } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/rispondi/[token]/upload` (fino a 4 MB, multipart: `file`, `needId`, `declaration=true`):
 * un file per una domanda aperta. Nasce in quarantena e si controlla subito (tipo dal contenuto,
 * intestazioni, testo sanitario); un PDF con poco testo resta da controllare a Lateral Space.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handleReferentPublic(request, token, { write: true, rate: "upload", body: "raw" }, async ({ link, request: req }) => {
    const form = await readUploadForm(req);
    if (!form.ok) return publicError(form.code, { message: form.message, status: uploadStatusFor(form.code) });
    const result = await uploadReferentFileServer(
      link,
      { needId: form.value.fields.needId ?? "", fileName: form.value.file.name, declaration: form.value.fields.declaration === "true", bytes: form.value.file.bytes },
      process.env,
    );
    return uploadOutcomeResponse(result);
  });
}
