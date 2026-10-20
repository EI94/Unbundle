import "server-only";
import { unstable_rethrow } from "next/navigation";
import { auth } from "@/lib/auth";
import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import { openUcCase, type OpenedUcCase } from "@/lib/actions/uc-action-context";
import { isUcEnabled } from "@/lib/db/queries/uc-access";
import { userUploader, type UploadResult, type UserUploader } from "@/lib/db/queries/uc-files";
import { sameSiteRequest } from "@/lib/uc/export/test-cases-upload";
import { uploadStatusFor } from "@/lib/uc/files/multipart";
import type { Result } from "@/lib/uc/types";

/**
 * Guardie comuni delle route dei file del caso (`…/casi-duso/[caseId]/files/**`,
 * PIANO §5.1, §6.2, §6.7): flag `UC_ENABLED`, per le scritture la stessa
 * origine (difesa CSRF: i cookie di sessione partono anche da un'altra
 * pagina), sessione, `requireWorkspaceAccess(workspaceId)`, ruoli di caso che
 * valgono adesso (`openUcCase`, con la sola lettura). I ruoli per ogni
 * operazione li ricontrollano i comandi di `queries/uc-files.ts`.
 *
 * Risposte JSON `{ ok, data }` oppure `{ ok: false, code, message }`, sempre
 * `no-store` e `nosniff`.
 */

export const FILE_ROUTE_HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;

export function fileRouteFail(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, code, message }, { status, headers: FILE_ROUTE_HEADERS });
}

export function fileRouteData(data: unknown): Response {
  return Response.json({ ok: true, data }, { status: 200, headers: FILE_ROUTE_HEADERS });
}

/** Esito di un comando sui file → risposta. Un file rifiutato è un esito (200) con il suo messaggio. */
export function fileRouteResult(result: Result<UploadResult | object>): Response {
  if (result.ok) return fileRouteData(result.value);
  return fileRouteFail(uploadStatusFor(result.code), result.code, result.message);
}

const OPEN_STATUS: Readonly<Record<string, number>> = {
  disattivata: 404,
  non_trovato: 404,
  non_disponibile: 503,
  sola_lettura: 403,
  configurazione_incompleta: 403,
};

export type FileRouteContext = { ok: true; opened: OpenedUcCase; uploader: UserUploader } | { ok: false; response: Response };

/** Apre il caso per una route dei file, oppure la risposta di errore da restituire. */
export async function openFileRoute(request: Request, workspaceId: string, caseId: string, opts: { write: boolean }): Promise<FileRouteContext> {
  const notFound = { ok: false as const, response: fileRouteFail(404, "non_trovato", "Pagina non trovata.") };
  if (!isUcEnabled()) return notFound;
  if (opts.write && !sameSiteRequest(request.headers, process.env.NEXT_PUBLIC_APP_URL)) {
    return { ok: false, response: fileRouteFail(403, "origine_non_ammessa", "Richiesta non autorizzata.") };
  }
  const session = await auth();
  if (!session?.user?.id) return { ok: false, response: fileRouteFail(401, "non_autenticato", "Accedi di nuovo per continuare.") };
  let guard: Awaited<ReturnType<typeof requireWorkspaceAccess>>;
  try {
    guard = await requireWorkspaceAccess(workspaceId);
  } catch (error) {
    unstable_rethrow(error);
    return notFound;
  }
  const opened = await openUcCase({ session: guard.session, access: guard.access, workspaceId, caseId, write: opts.write });
  if (!opened.ok) {
    const failure = opened.result.ok ? { code: "non_trovato", message: "Caso non trovato o non accessibile." } : opened.result;
    return { ok: false, response: fileRouteFail(OPEN_STATUS[failure.code] ?? 404, failure.code, failure.message) };
  }
  const uploader = userUploader(opened.value.ctx);
  if (!uploader.ok) return { ok: false, response: fileRouteFail(403, uploader.code, uploader.message) };
  return { ok: true, opened: opened.value, uploader: uploader.value };
}
