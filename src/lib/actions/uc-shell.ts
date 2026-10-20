"use server";

import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import { updateDescriptionBlock } from "@/lib/db/queries/uc-shell";
import { finishUcCommand, fromResult, openUcCase, type UcActionResult } from "./uc-action-context";

/**
 * Server action delle pagine di WP8 che non stanno nei comandi di WP6/WP7a.
 * Prima `requireWorkspaceAccess(workspaceId)`, poi il ruolo di caso, poi il
 * comando (che ricontrolla permessi e testi).
 */

/**
 * Modifica di un blocco della descrizione (Responsabile del caso). `base` è il
 * valore del blocco che l'editor ha visto: se nel frattempo è cambiato la
 * modifica si rifiuta, così nessuno sovrascrive il lavoro di un altro.
 */
export async function updateDescriptionBlockAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ blocks: string[] }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  const opened = await openUcCase({ session, access, workspaceId, caseId, allow: ["ls_lead"] });
  if (!opened.ok) return opened.result;
  const result = await updateDescriptionBlock(opened.value.executor, opened.value.ctx, input);
  if (result.ok) finishUcCommand({ workspaceId, caseId });
  return fromResult(result, undefined, result.ok ? (result.value.blocks.length > 0 ? "Descrizione aggiornata." : "Nessuna modifica da salvare.") : undefined);
}
