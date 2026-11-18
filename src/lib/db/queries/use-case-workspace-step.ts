import "server-only";
/**
 * Le due letture del prossimo passo del workspace (rilascio 10, decisione D3; `workspaceSteps` di
 * src/lib/use-cases/panoramica.ts) che le schede e le esigenze non danno: l'ok sui fornitori e l'ultimo SAL. Le usano
 * la Home (src/lib/db/queries/use-case-home.ts) e la Panoramica di «Use case» (src/components/use-cases/hub.tsx), così
 * il passo è lo stesso nei due posti. Ogni lettura che non riesce lascia fuori la sua regola, mai la pagina.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { programSettings } from "@/lib/db/schema";
import { loadAiConsentNotice } from "@/lib/db/queries/context-consent";
import { canEditProgram, programStoreReady } from "@/lib/db/queries/use-case-program";
import { logSafeError } from "@/lib/log/safe-error";
import type { WorkspaceStepInput } from "@/lib/use-cases/panoramica";
import { referentAskEnabled } from "@/lib/use-cases/referent/availability";

const LOG_SCOPE = "passo-del-workspace";

/**
 * L'ok sui fornitori per la regola 1 di D3, solo dove «Chiedi al referente» è acceso (senza l'ok le sue domande non
 * partono): `authorized` se l'ok c'è, `canAuthorize` se chi guarda lo può dare (`subprocessorDeclarerOf`). null:
 * funzione spenta o lettura non riuscita.
 */
export async function supplierState(i: { workspaceId: string; userId: string; role: string }): Promise<WorkspaceStepInput["suppliers"]> {
  if (!referentAskEnabled(i.workspaceId, process.env)) return null;
  try {
    const notice = await loadAiConsentNotice({ workspaceId: i.workspaceId, userId: i.userId, role: i.role });
    return notice === null ? { authorized: true, canAuthorize: false } : { authorized: false, canAuthorize: notice.declarer !== null };
  } catch (error) {
    logSafeError(LOG_SCOPE, "fornitori_non_letti", error, { workspaceId: i.workspaceId });
    return null;
  }
}

/** L'ultimo SAL chiuso (null: nessuno); undefined senza Programma (la 0029 manca) o se la lettura non riesce. */
async function lastSalOn(workspaceId: string): Promise<string | null | undefined> {
  if (!(await programStoreReady())) return undefined;
  try {
    const [row] = await db.select({ lastSalOn: programSettings.lastSalOn }).from(programSettings).where(eq(programSettings.workspaceId, workspaceId)).limit(1);
    return row?.lastSalOn ?? null;
  } catch (error) {
    logSafeError(LOG_SCOPE, "sal_non_letto", error, { workspaceId });
    return undefined;
  }
}

/**
 * Le letture in più del passo del workspace per la Panoramica di «Use case», che le esigenze le legge già: l'ok sui
 * fornitori e l'ultimo SAL, con chi lo può chiudere (Lateral Space e chi gestisce il workspace). Solo per un revisore.
 */
export async function loadWorkspaceStepFacts(i: { workspaceId: string; userId: string; role: string; isLateralSpace: boolean }): Promise<Pick<WorkspaceStepInput, "suppliers" | "sal">> {
  const [suppliers, lastOn] = await Promise.all([supplierState(i), lastSalOn(i.workspaceId)]);
  return { suppliers, sal: lastOn === undefined ? null : { lastOn, canClose: canEditProgram({ role: i.role, isLateralSpace: i.isLateralSpace }) } };
}
