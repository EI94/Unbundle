import { unstable_rethrow } from "next/navigation";
import { openReviewerFileDownload } from "@/lib/db/queries/use-case-referent-files";
import { isPrefetchRequest } from "@/lib/http/prefetch";
import { attachmentHeader, servedMime } from "@/lib/uc/files/upload";
import { openReferentFileRoute, REFERENT_FILE_HEADERS } from "../route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = "File non trovato.";

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { ...REFERENT_FILE_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
}

/**
 * `GET …/use-cases/[useCaseId]/allegati/[fileId]`: il download di un file di «Cosa serve» per chi
 * vede la scheda. Un 404 identico per ogni rifiuto, un contributore compreso; un PDF in revisione si
 * apre solo per un'altra persona di Lateral Space. Un prefetch non scarica niente.
 */
export async function GET(request: Request, { params }: { params: Promise<{ workspaceId: string; useCaseId: string; fileId: string }> }) {
  if (isPrefetchRequest(request)) return new Response(null, { status: 204, headers: REFERENT_FILE_HEADERS });
  const { workspaceId, useCaseId, fileId } = await params;
  try {
    const opened = await openReferentFileRoute(request, workspaceId, useCaseId, { write: false });
    if (!opened.ok) return opened.response.status === 401 ? text(401, "Accedi di nuovo per scaricare il file.") : text(404, NOT_FOUND);
    const file = await openReviewerFileDownload({ workspaceId, useCaseId: opened.useCaseId, fileId, viewer: opened.viewer, userId: opened.userId }, process.env);
    if (!file.ok) return text(404, NOT_FOUND);
    const headers: Record<string, string> = {
      ...REFERENT_FILE_HEADERS,
      "Content-Type": servedMime(file.value.mime),
      "Content-Disposition": attachmentHeader(file.value.fileName),
      "Content-Security-Policy": "sandbox; default-src 'none'",
    };
    if (file.value.size !== null) headers["Content-Length"] = String(file.value.size);
    return new Response(file.value.body, { status: 200, headers });
  } catch (error) {
    unstable_rethrow(error);
    console.error("[use-case-files] download non riuscito", error instanceof Error ? error.name : "errore");
    return text(503, "Download non disponibile. Riprova tra poco.");
  }
}
