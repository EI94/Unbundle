import { unstable_rethrow } from "next/navigation";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import { openUcCase } from "@/lib/actions/uc-action-context";
import { isUcEnabled, ucLsDomains } from "@/lib/db/queries/uc-access";
import { loadActivityExport } from "@/lib/db/queries/uc-events";
import { recordAuditExport } from "@/lib/db/queries/uc-shell";
import { isPrefetchRequest } from "@/lib/http/prefetch";
import { attachmentDisposition } from "@/lib/uc/export/request";
import { auditCsv, parseAuditFilter } from "@/lib/uc/views/audit";
import { UC_SHELL_PAGE_ROLES, seesFilteredAudit } from "@/lib/uc/views/case-shell";

/**
 * CSV di Attività (DESIGN §3.12, PIANO §7.2): `GET …/casi-duso/[caseId]/attivita/csv`
 * con gli stessi filtri della pagina (`tipo`, `chi`, `attore`, `dal`, `al`).
 *
 * - Lo scaricano il responsabile Lateral Space (attività completa) e i ruoli
 *   del cliente con l'attività filtrata: per loro il filtro dell'art. 15.4 è
 *   nella query, e le risposte dei referenti escono solo contate per giorno
 *   (n ≥ 5).
 * - Ogni cella passa da `csvCell` (niente formule eseguite da Excel).
 * - Un evento `registro.esportato` per ogni download, scritto prima di servire
 *   il file; un prefetch non scarica e non scrive niente.
 * - Si apre solo da un `<a download>` nativo, mai da un `<Link>` di Next.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;
const NOT_AVAILABLE = "Attività non disponibile.";

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" } });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ workspaceId: string; caseId: string }> }) {
  if (isPrefetchRequest(request)) return new Response(null, { status: 204, headers: NO_STORE });
  if (!isUcEnabled()) return text(404, "Pagina non trovata.");
  const { workspaceId, caseId } = await params;

  const session = await auth();
  if (!session?.user?.id) return text(401, "Accedi di nuovo per scaricare l'attività.");
  let access: Awaited<ReturnType<typeof requireWorkspaceAccess>>;
  try {
    access = await requireWorkspaceAccess(workspaceId);
  } catch (error) {
    unstable_rethrow(error);
    return text(404, NOT_AVAILABLE);
  }

  let csv: string;
  let code: string;
  try {
    const opened = await openUcCase({ session: access.session, access: access.access, workspaceId, caseId, allow: UC_SHELL_PAGE_ROLES.registro, write: false });
    if (!opened.ok) {
      const failure = opened.result.ok ? "non_trovato" : opened.result.code;
      return failure === "non_disponibile" ? text(503, "Sezione non disponibile. Riprova tra poco.") : text(404, NOT_AVAILABLE);
    }
    const { executor, caseAccess } = opened.value;
    const clientView = seesFilteredAudit(caseAccess.roles);
    const filter = parseAuditFilter(request.nextUrl.searchParams, clientView);
    const data = await loadActivityExport(executor, { workspaceId, caseId: caseAccess.caseId, filter, clientView, lsDomains: ucLsDomains() });
    csv = auditCsv(data.rows, data.daily ?? undefined);
    code = caseAccess.code;
    // Senza traccia niente file: l'evento si scrive prima di servire il download.
    await recordAuditExport(executor, { workspaceId, caseId: caseAccess.caseId, userId: caseAccess.user.userId, rows: data.rows.length });
  } catch (error) {
    unstable_rethrow(error);
    console.error("[uc-attivita] export non riuscito", error instanceof Error ? error.message : "errore");
    return text(503, "Download non riuscito. Riprova tra poco.");
  }

  const body = new TextEncoder().encode(csv);
  return new Response(body, {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Length": String(body.byteLength),
      "Content-Disposition": attachmentDisposition(`attivita-${code}.csv`),
    },
  });
}
