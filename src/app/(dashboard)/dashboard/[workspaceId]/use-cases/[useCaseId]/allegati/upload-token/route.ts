import { unstable_rethrow } from "next/navigation";
import { beginReviewerClientUpload } from "@/lib/db/queries/use-case-referent-files";
import { readPublicJson } from "@/lib/uc/http";
import { openReferentFileRoute, referentFileFail, referentFileResult } from "../route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST …/allegati/upload-token` `{ needId, fileName, size, declaration, validate? }` (caricamento
 * diretto, ≤ 20 MB): prima la riga in quarantena con il percorso esatto, poi il token per quel solo
 * percorso. Senza archivio diretto: `modalita_non_disponibile`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string; useCaseId: string }> }) {
  const { workspaceId, useCaseId } = await params;
  try {
    const opened = await openReferentFileRoute(request, workspaceId, useCaseId, { write: true });
    if (!opened.ok) return opened.response;
    const body = await readPublicJson(request);
    if (!body.ok) return referentFileFail(422, body.code, "Dati non validi. Aggiorna la pagina e riprova.");
    return referentFileResult(await beginReviewerClientUpload(opened.ctx, opened.useCaseId, body.value, process.env));
  } catch (error) {
    unstable_rethrow(error);
    console.error("[use-case-files] token di caricamento non emesso", error instanceof Error ? error.name : "errore");
    return referentFileFail(503, "errore_tecnico", "Caricamento non disponibile. Riprova tra poco.");
  }
}
