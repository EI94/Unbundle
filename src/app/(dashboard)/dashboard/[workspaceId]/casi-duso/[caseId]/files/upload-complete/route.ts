import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { CASE_LAYOUT_PATH } from "@/lib/actions/uc-action-context";
import { completeUserUpload } from "@/lib/db/queries/uc-files";
import { readPublicJson } from "@/lib/uc/http";
import { fileRouteFail, fileRouteResult, openFileRoute } from "../route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST …/casi-duso/[caseId]/files/upload-complete` `{ fileId }`: fine del
 * caricamento diretto. Solo un `fileId` emesso per lo stesso utente e ancora
 * in quarantena; l'oggetto si verifica con `head()` al percorso della riga.
 */
export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string; caseId: string }> }) {
  const { workspaceId, caseId } = await params;
  try {
    const opened = await openFileRoute(request, workspaceId, caseId, { write: true });
    if (!opened.ok) return opened.response;
    const body = await readPublicJson(request);
    if (!body.ok) return fileRouteFail(422, body.code, "Dati non validi. Aggiorna la pagina e riprova.");
    const result = await completeUserUpload(opened.opened.executor, opened.uploader, body.value, process.env);
    if (result.ok) revalidatePath(CASE_LAYOUT_PATH, "layout");
    return fileRouteResult(result);
  } catch (error) {
    unstable_rethrow(error);
    console.error("[uc-files] caricamento non concluso", error instanceof Error ? error.name : "errore");
    return fileRouteFail(503, "errore_tecnico", "Caricamento non concluso. Riprova tra poco.");
  }
}
