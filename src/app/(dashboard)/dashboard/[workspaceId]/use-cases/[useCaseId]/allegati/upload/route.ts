import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { uploadReviewerFileServer } from "@/lib/db/queries/use-case-referent-files";
import { readUploadForm, uploadStatusFor } from "@/lib/uc/files/multipart";
import { openReferentFileRoute, referentFileFail, referentFileResult } from "../route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST …/use-cases/[useCaseId]/allegati/upload` (modalità server, ≤ 4 MB, multipart: `file`,
 * `needId`, `declaration=true`, `validate=true` facoltativo): «Allega un file» del team su
 * un'esigenza della scheda. Riga in quarantena, controllo dei byte, poi l'archivio privato.
 */
export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string; useCaseId: string }> }) {
  const { workspaceId, useCaseId } = await params;
  try {
    const opened = await openReferentFileRoute(request, workspaceId, useCaseId, { write: true });
    if (!opened.ok) return opened.response;
    const form = await readUploadForm(request);
    if (!form.ok) return referentFileFail(uploadStatusFor(form.code), form.code, form.message);
    const result = await uploadReviewerFileServer(
      opened.ctx,
      opened.useCaseId,
      {
        needId: form.value.fields.needId ?? "",
        fileName: form.value.file.name,
        declaration: form.value.fields.declaration === "true",
        bytes: form.value.file.bytes,
        validate: form.value.fields.validate === "true",
      },
      process.env,
    );
    if (result.ok) revalidatePath(`/dashboard/${workspaceId}/use-cases/${opened.useCaseId}`);
    return referentFileResult(result);
  } catch (error) {
    unstable_rethrow(error);
    console.error("[use-case-files] caricamento non riuscito", error instanceof Error ? error.name : "errore");
    return referentFileFail(503, "errore_tecnico", "Caricamento non riuscito. Riprova tra poco.");
  }
}
