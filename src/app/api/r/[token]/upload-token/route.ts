import { beginReferentUpload } from "@/lib/db/queries/uc-files";
import { handlePublic } from "../handler";
import { uploadResponse } from "../upload-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/r/[token]/upload-token` `{ itemId, fileName, size, declaration }`
 * (modalità client-Blob, zona standard, ≤ 20 MB): crea **prima** la riga
 * `uc_files` in quarantena con il percorso esatto `uc/q/<ws>/<caso>/<fileId>`,
 * poi un token Vercel Blob valido 10 minuti solo per quel percorso (privato,
 * senza suffisso, tipi ammessi, dimensione massima). Restituisce `fileId`,
 * `pathname` e il token. Senza Blob configurato (harness): `modalita_non_disponibile`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handlePublic(request, token, { write: true, rate: "upload" }, async ({ executor, link, body }) => uploadResponse(await beginReferentUpload(executor, link, body, process.env)));
}
