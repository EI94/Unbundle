import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { completeReviewerClientUpload } from "@/lib/db/queries/use-case-referent-files";
import { readPublicJson } from "@/lib/uc/http";
import { openReferentFileRoute, referentFileFail, referentFileResult } from "../route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** `POST …/allegati/upload-complete` `{ fileId, validate? }`: il controllo del file appena caricato direttamente. */
export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string; useCaseId: string }> }) {
  const { workspaceId, useCaseId } = await params;
  try {
    const opened = await openReferentFileRoute(request, workspaceId, useCaseId, { write: true });
    if (!opened.ok) return opened.response;
    const body = await readPublicJson(request);
    if (!body.ok) return referentFileFail(422, body.code, "Dati non validi. Aggiorna la pagina e riprova.");
    const result = await completeReviewerClientUpload(opened.ctx, opened.useCaseId, body.value, process.env);
    if (result.ok) revalidatePath(`/dashboard/${workspaceId}/use-cases/${opened.useCaseId}`);
    return referentFileResult(result);
  } catch (error) {
    unstable_rethrow(error);
    console.error("[use-case-files] controllo non riuscito", error instanceof Error ? error.name : "errore");
    return referentFileFail(503, "errore_tecnico", "Caricamento non riuscito. Riprova tra poco.");
  }
}
