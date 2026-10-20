import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { CASE_LAYOUT_PATH } from "@/lib/actions/uc-action-context";
import { uploadFromUser } from "@/lib/db/queries/uc-files";
import { readUploadForm, uploadStatusFor } from "@/lib/uc/files/multipart";
import { fileRouteFail, fileRouteResult, openFileRoute } from "../route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST …/casi-duso/[caseId]/files/upload` (modalità server, ≤ 4 MB,
 * multipart: `file`, `itemId` facoltativo, `declaration=true`): caricamento di
 * Lateral Space (o dell'Owner del cliente per i documenti del caso). Riga in
 * quarantena, controllo dei byte, poi zona standard o personale cifrata.
 * Obbligatoria per la zona personale; l'unica modalità sul harness.
 */
export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string; caseId: string }> }) {
  const { workspaceId, caseId } = await params;
  try {
    const opened = await openFileRoute(request, workspaceId, caseId, { write: true });
    if (!opened.ok) return opened.response;
    const form = await readUploadForm(request);
    if (!form.ok) return fileRouteFail(uploadStatusFor(form.code), form.code, form.message);
    const result = await uploadFromUser(
      opened.opened.executor,
      opened.uploader,
      { itemId: form.value.fields.itemId || null, fileName: form.value.file.name, declaration: form.value.fields.declaration === "true", bytes: form.value.file.bytes },
      process.env,
    );
    if (result.ok) revalidatePath(CASE_LAYOUT_PATH, "layout");
    return fileRouteResult(result);
  } catch (error) {
    unstable_rethrow(error);
    console.error("[uc-files] caricamento non riuscito", error instanceof Error ? error.name : "errore");
    return fileRouteFail(503, "errore_tecnico", "Caricamento non riuscito. Riprova tra poco.");
  }
}
