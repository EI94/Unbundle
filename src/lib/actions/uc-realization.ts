"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import { getUcUserContext } from "@/lib/db/queries/uc-access";
import { startRealization } from "@/lib/db/queries/uc-realization";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { ucLogError } from "@/lib/uc/log";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";
import { finishUcCommand, fromResult, ucFailure, ucSectionAvailable, type UcActionResult } from "./uc-action-context";

/**
 * «Avvia la realizzazione» (DESIGN §3.2): un dossier in bozza da uno use case
 * «Da costruire» approvato, solo per Lateral Space. Il modulo manda use case,
 * schema, nome e frase; codice e testi li prende il server dallo use case.
 *
 * Prima `requireWorkspaceAccess(workspaceId)`, poi la sezione accesa per il
 * workspace (`UC_ENABLED` e `UC_WORKSPACE_IDS`, P0-1), poi il comando, che
 * ricontrolla chi avvia e lo use case. Non esiste via MCP. La riga di Storia
 * «Realizzazione avviata» la aggiunge la pagina Use case (H6a).
 */
export async function startRealizationAction(workspaceId: string, input: unknown): Promise<UcActionResult<{ caseId: string; code: string }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  const available = await ucSectionAvailable(workspaceId);
  if (!available.ok) return available;
  const user = await getUcUserContext(session.user.id);
  if (!user) return ucFailure("utente_non_trovato", "Utente non trovato.");
  const executor = await getAppUcExecutor();
  let result: Awaited<ReturnType<typeof startRealization>>;
  try {
    result = await startRealization(executor, { workspaceId, user, canReviewWorkspacePortfolio: canReviewWorkspacePortfolio(access.role), input });
  } catch (error) {
    ucLogError({ area: "uc", op: "avvia_realizzazione", workspaceId }, error);
    return ucFailure("non_riuscito", "Non sono riuscito ad avviare la realizzazione. Riprova tra poco.");
  }
  if (!result.ok) return ucFailure(result.code, result.message);
  const { caseId, code, useCaseId } = result.value;
  finishUcCommand({ workspaceId, caseId });
  revalidatePath(`/dashboard/${workspaceId}/use-cases/${useCaseId}`);
  revalidatePath(`/dashboard/${workspaceId}/use-cases`);
  return fromResult({ ok: true, value: { caseId, code } }, undefined, `Dossier ${code} avviato in bozza.`);
}
