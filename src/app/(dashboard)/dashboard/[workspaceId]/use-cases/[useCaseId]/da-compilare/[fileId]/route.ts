import { unstable_rethrow } from "next/navigation";
import { openTeamTemplateDownload } from "@/lib/db/queries/use-case-template-files";
import { isPrefetchRequest } from "@/lib/http/prefetch";
import { openReferentFileRoute, REFERENT_FILE_HEADERS } from "../../allegati/route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = "File non trovato.";

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { ...REFERENT_FILE_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
}

/**
 * («File da compilare») `GET …/use-cases/[useCaseId]/da-compilare/[fileId]`: il download di un file da compilare per chi
 * vede la scheda, sempre come allegato. Un 404 identico per ogni rifiuto; un PDF da controllare si apre solo per chi
 * modifica «Cosa serve» e non l'ha caricato. Un prefetch non scarica niente.
 */
export async function GET(request: Request, { params }: { params: Promise<{ workspaceId: string; useCaseId: string; fileId: string }> }) {
  if (isPrefetchRequest(request)) return new Response(null, { status: 204, headers: REFERENT_FILE_HEADERS });
  const { workspaceId, useCaseId, fileId } = await params;
  try {
    const opened = await openReferentFileRoute(request, workspaceId, useCaseId, { write: false });
    if (!opened.ok) return opened.response.status === 401 ? text(401, "Accedi di nuovo per scaricare il file.") : text(404, NOT_FOUND);
    const file = await openTeamTemplateDownload({ workspaceId, useCaseId: opened.useCaseId, fileId, viewer: opened.viewer, userId: opened.userId }, process.env);
    if (!file.ok) return text(404, NOT_FOUND);
    const headers: Record<string, string> = {
      ...REFERENT_FILE_HEADERS,
      "Content-Type": file.value.mime,
      "Content-Disposition": file.value.disposition,
      "Content-Security-Policy": "sandbox; default-src 'none'",
    };
    if (file.value.size !== null) headers["Content-Length"] = String(file.value.size);
    return new Response(file.value.body, { status: 200, headers });
  } catch (error) {
    unstable_rethrow(error);
    console.error("[use-case-files] download del file da compilare non riuscito", error instanceof Error ? error.name : "errore");
    return text(503, "Download non disponibile. Riprova tra poco.");
  }
}
