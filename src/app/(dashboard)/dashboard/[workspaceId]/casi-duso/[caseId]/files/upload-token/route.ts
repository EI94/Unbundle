import { unstable_rethrow } from "next/navigation";
import { beginUserUpload } from "@/lib/db/queries/uc-files";
import { readPublicJson } from "@/lib/uc/http";
import { fileRouteFail, fileRouteResult, openFileRoute } from "../route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST …/casi-duso/[caseId]/files/upload-token` `{ itemId?, fileName, size, declaration }`
 * (modalità client-Blob, zona standard, ≤ 20 MB): crea prima la riga in
 * quarantena con il percorso esatto, poi il token Vercel Blob per quel solo
 * percorso. Senza Blob configurato: `modalita_non_disponibile` (si carica
 * passando dal server, fino a 4 MB).
 */
export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string; caseId: string }> }) {
  const { workspaceId, caseId } = await params;
  try {
    const opened = await openFileRoute(request, workspaceId, caseId, { write: true });
    if (!opened.ok) return opened.response;
    const body = await readPublicJson(request);
    if (!body.ok) return fileRouteFail(422, body.code, "Dati non validi. Aggiorna la pagina e riprova.");
    return fileRouteResult(await beginUserUpload(opened.opened.executor, opened.uploader, body.value, process.env));
  } catch (error) {
    unstable_rethrow(error);
    console.error("[uc-files] token di caricamento non emesso", error instanceof Error ? error.name : "errore");
    return fileRouteFail(503, "errore_tecnico", "Caricamento non disponibile. Riprova tra poco.");
  }
}
