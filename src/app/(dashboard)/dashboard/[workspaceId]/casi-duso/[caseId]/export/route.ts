import { unstable_rethrow } from "next/navigation";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import { openUcCase } from "@/lib/actions/uc-action-context";
import { isUcEnabled } from "@/lib/db/queries/uc-access";
import { loadExportSnapshot, recordCatalogExport } from "@/lib/db/queries/uc-export";
import { isPrefetchRequest } from "@/lib/http/prefetch";
import { renderClientCatalogExport } from "@/lib/uc/export/client-catalog";
import { attachmentDisposition, clientDraftBeforeVia, exportAllowed, exportFormatAllowed, parseExportQuery } from "@/lib/uc/export/request";
import { encodeForTransfer, renderCatalogExport } from "@/lib/uc/export/render";
import { snapshotForViewer } from "@/lib/uc/snapshot";
import { isLsViewer } from "@/lib/uc/views/status-groups";

/**
 * Export del catalogo di un caso (PIANO §5.9):
 * `GET …/casi-duso/[caseId]/export?format=json|md|xlsx&version=N|bozza`.
 *
 * - Di default l'ultima versione congelata; `bozza` per Lateral Space e, solo
 *   prima del via allo sviluppo (nessuna versione congelata, controllato nello
 *   stesso giro delle voci), per il responsabile del cliente (DESIGN §3.13.1),
 *   con «non validata» su ogni voce non a posto; ls_sviluppatore solo versioni
 *   congelate (`exportAllowed`).
 * - Valori secondo la visibilità del ruolo (`snapshotForViewer`), mai personali
 *   né sanitari.
 * - Il cliente scarica solo Excel, con il suo foglio (`renderClientCatalogExport`):
 *   della risposta solo il valore, mai autore, data, provenienza o «Non lo so»
 *   (DESIGN §3.6.8, art. 15.4).
 * - Un evento `catalogo.esportato` per ogni download, scritto prima di servire il
 *   file: senza audit niente file. Un prefetch non genera né file né evento.
 * - Si apre solo da un `<a download>` nativo, mai da un `<Link>` di Next.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;
const NOT_AVAILABLE = "Catalogo non disponibile.";

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" } });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ workspaceId: string; caseId: string }> }) {
  // Difesa in profondità: un prefetch del browser o del router non scarica e non scrive audit.
  if (isPrefetchRequest(request)) return new Response(null, { status: 204, headers: NO_STORE });
  if (!isUcEnabled()) return text(404, "Pagina non trovata.");
  const { workspaceId, caseId } = await params;

  const session = await auth();
  if (!session?.user?.id) return text(401, "Accedi di nuovo per scaricare il catalogo.");
  let access: Awaited<ReturnType<typeof requireWorkspaceAccess>>;
  try {
    access = await requireWorkspaceAccess(workspaceId);
  } catch (error) {
    unstable_rethrow(error);
    return text(404, NOT_AVAILABLE);
  }

  const query = parseExportQuery(request.nextUrl.searchParams);
  if (!query.ok) return text(400, query.message);

  let file: ReturnType<typeof renderCatalogExport>;
  try {
    const opened = await openUcCase({ session: access.session, access: access.access, workspaceId, caseId, write: false });
    if (!opened.ok) {
      const code = opened.result.ok ? "non_trovato" : opened.result.code;
      return code === "non_disponibile" ? text(503, "Sezione non disponibile. Riprova tra poco.") : text(404, NOT_AVAILABLE);
    }
    const { executor, caseAccess } = opened.value;
    const roles = caseAccess.roles;
    const format = exportFormatAllowed(roles, query.value.format);
    if (!format.ok) return text(403, format.message);
    // La bozza del responsabile del cliente vale solo prima del via: lo ricontrolla la lettura, nello stesso giro delle voci.
    const beforeVia = clientDraftBeforeVia(roles, query.value.version);
    const allowed = exportAllowed(roles, query.value.version, beforeVia ? 0 : undefined);
    if (!allowed.ok) return text(403, allowed.message);

    const loaded = await loadExportSnapshot(executor, { workspaceId, caseId: caseAccess.caseId, version: query.value.version, requireBeforeVia: beforeVia });
    if (!loaded.ok) {
      if (loaded.code === "bozza_non_ammessa") return text(403, loaded.message);
      const status = loaded.code === "nessuna_versione" || loaded.code === "versione_assente" || loaded.code === "non_trovato" ? 404 : 500;
      return text(status, loaded.message);
    }
    const snapshot = snapshotForViewer(loaded.value, { roles });
    file = isLsViewer(roles) ? renderCatalogExport(snapshot, query.value.format) : renderClientCatalogExport(snapshot);

    // Senza audit niente file: l'evento si scrive prima di servire il download.
    await recordCatalogExport(executor, {
      workspaceId,
      caseId: caseAccess.caseId,
      actor: { type: "utente", userId: caseAccess.user.userId },
      format: query.value.format,
      version: snapshot.version,
    });
  } catch (error) {
    unstable_rethrow(error);
    console.error("[uc-export] export non riuscito", error instanceof Error ? error.message : "errore");
    return text(503, "Export non riuscito. Riprova tra poco.");
  }

  // Un catalogo grande in JSON supera i 4,5 MB di una risposta Vercel: compresso no.
  const sent = encodeForTransfer(file, request.headers.get("accept-encoding"));
  return new Response(sent.body as BodyInit, {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": file.contentType,
      "Content-Length": String(sent.body.byteLength),
      "Content-Disposition": attachmentDisposition(file.fileName),
      Vary: "Accept-Encoding",
      ...(sent.contentEncoding ? { "Content-Encoding": sent.contentEncoding } : {}),
    },
  });
}
