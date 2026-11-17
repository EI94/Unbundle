import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { uploadTemplateFileServer } from "@/lib/db/queries/use-case-template-files";
import { readUploadForm, uploadStatusFor } from "@/lib/uc/files/multipart";
import { openReferentFileRoute, referentFileFail, referentFileResult } from "../../allegati/route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * («File da compilare») `POST …/use-cases/[useCaseId]/da-compilare/upload` (modalità server, ≤ 4 MB, multipart: `file`
 * e `needIds.0`, `needIds.1`, … (le esigenze a cui legarlo) oppure `replacesId` («Sostituisci»)): un file che il referente scarica,
 * compila e ricarica. Riga in quarantena, controllo dei byte, poi l'archivio privato. Non è una risposta: l'esigenza
 * non cambia.
 */
export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string; useCaseId: string }> }) {
  const { workspaceId, useCaseId } = await params;
  try {
    const opened = await openReferentFileRoute(request, workspaceId, useCaseId, { write: true });
    if (!opened.ok) return opened.response;
    const form = await readUploadForm(request);
    if (!form.ok) return referentFileFail(uploadStatusFor(form.code), form.code, form.message);
    // Le esigenze come un campo ciascuna (`needIds.0`, …) oppure `replacesId`: le legge `templateTargetOf`.
    const result = await uploadTemplateFileServer(opened.ctx, opened.useCaseId, { target: form.value.fields, fileName: form.value.file.name, bytes: form.value.file.bytes }, process.env);
    if (result.ok) revalidatePath(`/dashboard/${workspaceId}/use-cases/${opened.useCaseId}`);
    return referentFileResult(result);
  } catch (error) {
    unstable_rethrow(error);
    console.error("[use-case-files] file da compilare non caricato", error instanceof Error ? error.name : "errore");
    return referentFileFail(503, "errore_tecnico", "Caricamento non riuscito. Riprova tra poco.");
  }
}
