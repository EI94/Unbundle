import "server-only";
import { unstable_rethrow } from "next/navigation";
import { auth } from "@/lib/auth";
import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import { viewerFromSession } from "@/lib/db/queries/use-case-hub";
import { sameSiteRequest } from "@/lib/uc/export/test-cases-upload";
import { uploadStatusFor } from "@/lib/uc/files/multipart";
import type { Result } from "@/lib/uc/types";
import { abilitiesForUseCase, type UseCaseViewer } from "@/lib/use-cases/permissions";
import { referentAskEnabled } from "@/lib/use-cases/referent/availability";
import { REFERENT_PUBLIC_STATUS } from "@/lib/db/queries/use-case-referent-public";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import type { WriteContext } from "@/lib/use-cases/service";

/**
 * Guardie comuni delle rotte dei file di «Cosa serve» (`…/use-cases/[useCaseId]/allegati/**`, SPEC
 * §2.5): funzione accesa, per le scritture la stessa origine (i cookie di sessione partono anche da
 * un'altra pagina), sessione, accesso al workspace, poi `canEditNeeds` per scrivere e `canSeeNeeds`
 * per leggere (altrimenti 404). I servizi ricontrollano ruolo e «Lateral Space».
 *
 * Risposte JSON `{ ok, data }` oppure `{ ok: false, code, message }`, sempre `no-store` e `nosniff`.
 */

export const REFERENT_FILE_HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function referentFileFail(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, code, message }, { status, headers: REFERENT_FILE_HEADERS });
}

/** Esito di un comando sui file → risposta. Un file rifiutato è un esito (200) con il suo messaggio. */
export function referentFileResult(result: Result<object>): Response {
  if (result.ok) return Response.json({ ok: true, data: result.value }, { status: 200, headers: REFERENT_FILE_HEADERS });
  return referentFileFail(REFERENT_PUBLIC_STATUS[result.code] ?? uploadStatusFor(result.code), result.code, result.message);
}

export type ReferentFileRoute =
  | { ok: true; ctx: WriteContext; viewer: UseCaseViewer; userId: string; useCaseId: string }
  | { ok: false; response: Response };

export async function openReferentFileRoute(request: Request, workspaceId: string, useCaseId: string, opts: { write: boolean }): Promise<ReferentFileRoute> {
  const notFound = { ok: false as const, response: referentFileFail(404, "file_non_trovato", "File non trovato.") };
  if (!UUID.test(workspaceId) || !UUID.test(useCaseId)) return notFound;
  if (!isUseCaseHubWorkspace(workspaceId) || !referentAskEnabled(workspaceId, process.env)) return notFound;
  if (opts.write && !sameSiteRequest(request.headers, process.env.NEXT_PUBLIC_APP_URL)) {
    return { ok: false, response: referentFileFail(403, "origine_non_ammessa", "Richiesta non autorizzata.") };
  }
  const session = await auth();
  if (!session?.user?.id) return { ok: false, response: referentFileFail(401, "non_autenticato", "Accedi di nuovo per continuare.") };
  let guard: Awaited<ReturnType<typeof requireWorkspaceAccess>>;
  try {
    guard = await requireWorkspaceAccess(workspaceId);
  } catch (error) {
    unstable_rethrow(error);
    return notFound;
  }
  const viewer = viewerFromSession(guard.session.user, guard.access.role);
  const abilities = abilitiesForUseCase(viewer);
  if (opts.write ? !abilities.canEditNeeds : !abilities.canSeeNeeds) return notFound;
  return {
    ok: true,
    viewer,
    userId: guard.session.user.id,
    useCaseId: useCaseId.toLowerCase(),
    ctx: {
      workspaceId,
      actor: { userId: guard.session.user.id, role: guard.access.role, isLateralSpace: viewer.isLateralSpace, kind: "persona" },
      channel: "pagina",
    },
  };
}
