"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import { getUcUserContext } from "@/lib/db/queries/uc-access";
import { startRealization } from "@/lib/db/queries/uc-realization";
import { realizationPrefillOf } from "@/lib/db/queries/use-case-dossiers";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { UUID } from "@/lib/uc/ids";
import { ucLogError } from "@/lib/uc/log";
import { recordRealizationStarted } from "@/lib/use-cases/service";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";
import { finishUcCommand, fromResult, ucFailure, ucSectionAvailable, type UcActionResult } from "./uc-action-context";

/**
 * «Avvia la realizzazione» (DESIGN §3.2): un dossier in bozza da uno use case
 * «Da costruire» approvato, solo per Lateral Space. Il modulo manda use case,
 * schema, nome e frase; codice e testi li prende il server dallo use case.
 *
 * Prima `requireWorkspaceAccess(workspaceId)`, poi la sezione accesa per il
 * workspace (`UC_ENABLED` e `UC_WORKSPACE_IDS`, P0-1), poi il comando, che
 * ricontrolla chi avvia e lo use case. Non esiste via MCP.
 *
 * Pagina Use case (H6a, `docs/use-case/DESIGN.md` §6.5):
 * - una scheda arrivata dal connettore (`intake.contractVersion = 2`) porta nel
 *   dossier, in sola lettura, problema, soluzione, area e strumenti raccolti da
 *   Claude (decisione del 19/10/2026): il blocco lo legge il server dalla scheda,
 *   mai dal modulo;
 * - dopo la creazione, con l'area accesa, una chiamata a
 *   `recordRealizationStarted` scrive la riga di Storia «Realizzazione avviata».
 *   Se non riesce il dossier resta: la riga manca e il log lo dice.
 */
export async function startRealizationAction(workspaceId: string, input: unknown): Promise<UcActionResult<{ caseId: string; code: string }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  const available = await ucSectionAvailable(workspaceId);
  if (!available.ok) return available;
  const user = await getUcUserContext(session.user.id);
  if (!user) return ucFailure("utente_non_trovato", "Utente non trovato.");
  const executor = await getAppUcExecutor();
  const rawUseCaseId = input && typeof input === "object" ? (input as { useCaseId?: unknown }).useCaseId : null;
  let result: Awaited<ReturnType<typeof startRealization>>;
  try {
    const prefill = typeof rawUseCaseId === "string" && UUID.test(rawUseCaseId) ? await realizationPrefillOf(workspaceId, rawUseCaseId) : null;
    result = await startRealization(executor, {
      workspaceId,
      user,
      canReviewWorkspacePortfolio: canReviewWorkspacePortfolio(access.role),
      input,
      extraDescription: prefill?.description ?? null,
    });
  } catch (error) {
    ucLogError({ area: "uc", op: "avvia_realizzazione", workspaceId }, error);
    return ucFailure("non_riuscito", "Non sono riuscito ad avviare la realizzazione. Riprova tra poco.");
  }
  if (!result.ok) return ucFailure(result.code, result.message);
  const { caseId, code, useCaseId } = result.value;
  if (isUseCaseHubWorkspace(workspaceId)) {
    const story = await recordRealizationStarted(
      {
        workspaceId,
        // Ruolo e «Lateral Space» li rilegge il servizio: qui non danno permessi.
        actor: { userId: session.user.id, role: access.role, isLateralSpace: user.isLateralSpace, kind: "persona" },
        channel: "pagina",
      },
      useCaseId,
      caseId,
    );
    if (!story.ok) ucLogError({ area: "uc", op: "storia_realizzazione_avviata", workspaceId }, new Error(`uc:${story.error}`));
  }
  finishUcCommand({ workspaceId, caseId });
  revalidatePath(`/dashboard/${workspaceId}/use-cases/${useCaseId}`);
  revalidatePath(`/dashboard/${workspaceId}/use-cases`);
  return fromResult({ ok: true, value: { caseId, code } }, undefined, `Dossier ${code} avviato in bozza.`);
}
