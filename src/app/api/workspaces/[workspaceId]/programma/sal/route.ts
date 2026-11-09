import { auth } from "@/lib/auth";
import { loadProgramPage } from "@/lib/db/queries/use-case-program";
import { contentDisposition } from "@/lib/learning/material-access";
import { logSafeError } from "@/lib/log/safe-error";
import { salFileName, salPdf } from "@/lib/programma/sal-pdf";
import { sameSiteRequest } from "@/lib/uc/export/test-cases-upload";
import { getCollaboratorAccess } from "@/lib/workspace-access";

/**
 * «Esporta il SAL» della pagina «Programma» (rilascio 7c): il PDF della prima vista. Solo POST (un
 * export non parte mai da un prefetch), dalla stessa origine, per chi vede la pagina (i revisori, con
 * l'area accesa e la 0029). Nessuna scrittura, nessuna persona nel file.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(status: number, code: string): Response {
  return Response.json({ ok: false, code }, { status, headers: HEADERS });
}

export async function POST(request: Request, ctx: { params: Promise<{ workspaceId: string }> }): Promise<Response> {
  const { workspaceId } = await ctx.params;
  if (!sameSiteRequest(request.headers, process.env.NEXT_PUBLIC_APP_URL ?? null)) return fail(403, "origine");
  const session = await auth();
  if (!session?.user?.id) return fail(401, "non_autenticato");
  if (!UUID.test(workspaceId)) return fail(404, "non_trovato");
  try {
    const access = await getCollaboratorAccess(session.user.id, workspaceId);
    if (!access) return fail(404, "non_trovato");
    const read = await loadProgramPage({ workspace: access.workspace, user: session.user, role: access.role });
    if (read.status === "nessuno") return fail(404, "non_trovato");
    if (read.status === "non_pronto") return fail(503, "non_pronto");
    const file = salPdf(read.view);
    return new Response(new Uint8Array(file), {
      headers: {
        ...HEADERS,
        "Content-Type": "application/pdf",
        "Content-Length": String(file.byteLength),
        "Content-Disposition": contentDisposition(salFileName(read.view)),
      },
    });
  } catch (error) {
    logSafeError("programma", "sal_pdf_failed", error, { workspaceId });
    return fail(503, "riprova");
  }
}
