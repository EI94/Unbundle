import { unstable_rethrow } from "next/navigation";
import { openFileDownload } from "@/lib/db/queries/uc-files";
import { isPrefetchRequest } from "@/lib/http/prefetch";
import { attachmentHeader, servedMime } from "@/lib/uc/files/upload";
import { FILE_ROUTE_HEADERS, openFileRoute } from "../route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = "File non trovato.";

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { ...FILE_ROUTE_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
}

/**
 * `GET …/casi-duso/[caseId]/files/[fileId]` (PIANO §6.7): download di un file
 * del caso. 404 identico per «assente», «non tuo» e «non utilizzabile»; un
 * PDF in revisione si apre solo per un'altra persona di Lateral Space. La zona
 * personale si decifra sul server, solo con l'accesso firmato e la zona
 * aperta. L'evento `file.scaricato` si scrive prima di servire il file; un
 * prefetch non scarica e non scrive nulla.
 */
export async function GET(request: Request, { params }: { params: Promise<{ workspaceId: string; caseId: string; fileId: string }> }) {
  if (isPrefetchRequest(request)) return new Response(null, { status: 204, headers: FILE_ROUTE_HEADERS });
  const { workspaceId, caseId, fileId } = await params;
  try {
    const opened = await openFileRoute(request, workspaceId, caseId, { write: false });
    if (!opened.ok) return opened.response.status === 401 ? text(401, "Accedi di nuovo per scaricare il file.") : text(404, NOT_FOUND);
    const file = await openFileDownload(opened.opened.executor, opened.uploader, fileId, process.env);
    if (!file.ok) return text(404, NOT_FOUND);
    const headers: Record<string, string> = {
      ...FILE_ROUTE_HEADERS,
      "Content-Type": servedMime(file.value.mime),
      "Content-Disposition": attachmentHeader(file.value.fileName),
      "Content-Security-Policy": "sandbox; default-src 'none'",
    };
    if (file.value.size !== null) headers["Content-Length"] = String(file.value.size);
    return new Response(file.value.body, { status: 200, headers });
  } catch (error) {
    unstable_rethrow(error);
    console.error("[uc-files] download non riuscito", error instanceof Error ? error.name : "errore");
    return text(503, "Download non disponibile. Riprova tra poco.");
  }
}
