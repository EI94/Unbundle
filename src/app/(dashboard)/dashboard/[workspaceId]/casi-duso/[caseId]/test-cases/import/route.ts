import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import { CASE_LAYOUT_PATH, openUcCase } from "@/lib/actions/uc-action-context";
import { isUcEnabled } from "@/lib/db/queries/uc-access";
import { TEST_CASES_MESSAGES, importTestCases } from "@/lib/db/queries/uc-test-cases";
import { readTestCasesUpload, sameSiteRequest } from "@/lib/uc/export/test-cases-upload";

/**
 * Import dei casi di prova da file (PIANO §3.11, §5.1 «Prova sul passato»):
 * `POST …/casi-duso/[caseId]/test-cases/import`, multipart con il campo `file`
 * (JSON o CSV, al massimo 2 MB), oppure il corpo grezzo JSON o CSV.
 *
 * È una route handler e non una server action: il file può superare il limite
 * di 1 MB delle server action. Stesse difese di un'azione uc: origine della
 * richiesta, `requireWorkspaceAccess`, ruolo di caso ls_lead (`openUcCase`, con
 * il flag `UC_ENABLED` e la sola lettura), poi il comando con le guardie
 * `uc_require` e l'evento `casi_prova.importati` nello stesso batch.
 *
 * Risposte JSON `{ok, data}` oppure `{ok: false, code, message, errors?}`:
 * errori e avvisi hanno riga, campo e categoria, mai il testo dei casi.
 */
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } as const;
const MAX_ERRORS = 200;

function fail(status: number, code: string, message: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ ok: false, code, message, ...extra }, { status, headers: HEADERS });
}

const OPEN_STATUS: Readonly<Record<string, number>> = {
  disattivata: 404,
  non_trovato: 404,
  non_disponibile: 503,
  sola_lettura: 403,
  configurazione_incompleta: 403,
};

const COMMAND_STATUS: Readonly<Record<string, number>> = {
  non_trovato: 404,
  attore_non_ammesso: 403,
  caso_chiuso: 409,
  a8_non_sciolto: 409,
  conflitto: 409,
  casi_prova_non_validi: 422,
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ workspaceId: string; caseId: string }> }) {
  if (!isUcEnabled()) return fail(404, "non_trovato", "Pagina non trovata.");
  if (!sameSiteRequest(request.headers, process.env.NEXT_PUBLIC_APP_URL)) {
    return fail(403, "origine_non_ammessa", "Richiesta non autorizzata.");
  }
  const { workspaceId, caseId } = await params;

  const session = await auth();
  if (!session?.user?.id) return fail(401, "non_autenticato", "Accedi di nuovo per importare i casi di prova.");
  let access: Awaited<ReturnType<typeof requireWorkspaceAccess>>;
  try {
    access = await requireWorkspaceAccess(workspaceId);
  } catch (error) {
    unstable_rethrow(error);
    return fail(404, "non_trovato", "Caso non trovato o non accessibile.");
  }

  let result: Awaited<ReturnType<typeof importTestCases>>;
  try {
    const opened = await openUcCase({ session: access.session, access: access.access, workspaceId, caseId, write: true });
    if (!opened.ok) {
      const failure = opened.result.ok ? { code: "non_trovato", message: "Caso non trovato o non accessibile." } : opened.result;
      return fail(OPEN_STATUS[failure.code] ?? 404, failure.code, failure.message);
    }
    const { executor, ctx, caseAccess } = opened.value;
    // Prima del corpo: chi non è Responsabile del caso non carica nulla.
    if (!caseAccess.roles.includes("ls_lead")) return fail(403, "attore_non_ammesso", TEST_CASES_MESSAGES.attore_non_ammesso);

    const upload = await readTestCasesUpload(request);
    if (!upload.ok) {
      const status = upload.code === "file_troppo_grande" ? 413 : upload.code === "formato_non_supportato" ? 415 : 422;
      return fail(status, upload.code, upload.message);
    }
    result = await importTestCases(executor, ctx, upload.value);
  } catch (error) {
    unstable_rethrow(error);
    console.error("[uc-test-cases] import non riuscito", error instanceof Error ? error.message : "errore");
    return fail(503, "errore_tecnico", "Import non confermato. Riprova tra poco.");
  }
  if (!result.ok) {
    return fail(COMMAND_STATUS[result.code] ?? 422, result.code, result.message, result.errors ? { errors: result.errors.slice(0, MAX_ERRORS) } : {});
  }

  revalidatePath(CASE_LAYOUT_PATH, "layout");
  const { total, inserted, updated, unchanged, warnings } = result.value;
  return Response.json(
    { ok: true, data: { total, inserted, updated, unchanged, warnings: warnings.slice(0, MAX_ERRORS) } },
    { status: 200, headers: HEADERS },
  );
}
