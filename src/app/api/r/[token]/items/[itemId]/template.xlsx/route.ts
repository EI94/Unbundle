import { referentTableTemplate } from "@/lib/db/queries/uc-files";
import { PUBLIC_HEADERS, publicError } from "@/lib/uc/http";
import { handlePublic } from "../../../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/r/[token]/items/[itemId]/template.xlsx` (PIANO §5.9): modello
 * Excel per una domanda di tipo tabella del link, con l'intestazione dalle
 * colonne del template oppure il titolo della domanda e la griglia vuota.
 * Solo lettura: nessun evento, nessun contatore (nemmeno sui prefetch).
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string; itemId: string }> }) {
  const { token, itemId } = await params;
  return handlePublic(request, token, { write: false, rate: null }, async ({ executor, link }) => {
    const file = await referentTableTemplate(executor, link, itemId);
    if (!file.ok) return publicError(file.code, { message: file.message, status: 404 });
    return new Response(new Uint8Array(file.value.bytes), {
      status: 200,
      headers: {
        ...PUBLIC_HEADERS,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${file.value.fileName}"`,
      },
    });
  });
}
