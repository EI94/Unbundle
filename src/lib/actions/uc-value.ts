"use server";

import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import { saveCaseRoi } from "@/lib/db/queries/uc-value";
import { finishUcCommand, fromResult, openUcCase, type UcActionResult } from "./uc-action-context";

/**
 * Server action della pagina Valore (DESIGN §3.8, WP5). Come le altre action dei
 * casi d'uso: prima `requireWorkspaceAccess(workspaceId)`, poi i ruoli di caso
 * (`openUcCase`), poi il comando, che rivalida l'input e ricalcola i permessi.
 */

/**
 * Righe di costo e beneficio del conto (solo il responsabile Lateral Space). Al
 * posto di `updateRoiAction`: in più scrive i totali che legge la pagina Use
 * case e rifiuta un salvataggio fatto su un conto cambiato nel frattempo.
 */
export async function saveRoiAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ version: number; computed: boolean }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  const opened = await openUcCase({ session, access, workspaceId, caseId, allow: ["ls_lead"] });
  if (!opened.ok) return opened.result;
  const result = await saveCaseRoi(opened.value.executor, opened.value.ctx, input);
  if (result.ok) finishUcCommand({ workspaceId, caseId: opened.value.ctx.caseId });
  return fromResult(result, (v) => ({ version: v.version, computed: v.totals.implementationCost !== null }));
}
