import "server-only";
import { UcAccessError, ensureUcAvailable, getUcUserContext, isUcEnabledFor } from "@/lib/db/queries/uc-access";
import { readStartContext, type StartContext } from "@/lib/db/queries/uc-realization";
import { listTemplatesForWorkspace } from "@/lib/db/queries/uc-templates";
import { realizationPrefillOf } from "@/lib/db/queries/use-case-dossiers";
import { getAppUcExecutor, type UcExecutor } from "@/lib/db/uc-executor";
import { checkCaseCreator } from "@/lib/uc/permissions";
import { startDefaults } from "@/lib/uc/views/realization";
import type { PrefillRow } from "@/lib/use-cases/realization-prefill";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";

/** Uno schema di partenza, come lo mostrano il dialogo e la pagina di ripiego. */
export interface StartTemplate {
  id: string;
  name: string;
  questions: number;
  /** Riservato a questo workspace: viene prima nell'elenco. */
  restricted: boolean;
}

/** Quello che serve per avviare la realizzazione da uno use case (dialogo e pagina di ripiego `/casi-duso/nuovo`). */
export interface StartFormData {
  useCase: { id: string; code: string | null; title: string };
  /** Il nome è il titolo dello use case (F-020); «In una frase» arriva già compilata (F-021). */
  defaults: { title: string; oneLiner: string };
  /** Riservati al workspace per primi, poi per nome. */
  templates: StartTemplate[];
  /** Il workspace non ha ancora un prefisso per i codici (F-023): si imposta in Impostazioni. */
  codeMissing: boolean;
  /** «Dati raccolti da Claude» di una scheda arrivata dal connettore (F-022), in sola lettura. */
  prefillRows: PrefillRow[];
}

/**
 * Schemi, testi di partenza e dati raccolti da Claude per un contesto di avvio già controllato. Lo usano il dialogo
 * «Avvia la realizzazione» della scheda e la pagina di ripiego, con le stesse letture di prima.
 */
export async function startFormData(executor: UcExecutor, workspaceId: string, context: StartContext): Promise<StartFormData> {
  const codeMissing = context.hasCodeColumn && !context.code;
  const [templates, prefill] = await Promise.all([codeMissing ? Promise.resolve([]) : listTemplatesForWorkspace(executor, workspaceId), realizationPrefillOf(workspaceId, context.useCaseId)]);
  const defaults = prefill ? { ...startDefaults(context.texts), oneLiner: prefill.oneLiner } : startDefaults(context.texts);
  return {
    useCase: { id: context.useCaseId, code: context.code, title: context.title },
    defaults,
    templates: [...templates]
      .sort((a, b) => Number(b.restricted) - Number(a.restricted) || a.name.localeCompare(b.name, "it"))
      .map((t) => ({ id: t.id, name: t.name, questions: t.questions, restricted: t.restricted })),
    codeMissing,
    prefillRows: codeMissing || !prefill ? [] : prefill.rows,
  };
}

/**
 * (Rilascio 10, §3.5, F-019…F-024) Il dialogo «Avvia la realizzazione» della scheda dello use case: i suoi dati, solo
 * quando chi guarda può avviare adesso, con le stesse regole della pagina `/casi-duso/nuovo` (sezione accesa per il
 * workspace, Lateral Space con il ruolo da revisore, use case «Da costruire» approvato e senza realizzazione). null
 * altrimenti, anche se una lettura non riesce: allora il pulsante porta alla pagina di ripiego, che lo dice.
 */
export async function loadStartDialog(i: { workspaceId: string; useCaseId: string; userId: string; role: string }): Promise<StartFormData | null> {
  if (!isUcEnabledFor(i.workspaceId) || !canReviewWorkspacePortfolio(i.role)) return null;
  try {
    await ensureUcAvailable(i.workspaceId);
    const executor = await getAppUcExecutor();
    const [context, user] = await Promise.all([readStartContext(executor, { workspaceId: i.workspaceId, useCaseId: i.useCaseId, userId: i.userId }), getUcUserContext(i.userId)]);
    if (!context || context.existingCaseId || context.kind !== "use_case_ai" || context.status !== "accepted") return null;
    if (!user || !checkCaseCreator({ user, canReviewWorkspacePortfolio: true }).ok) return null;
    return await startFormData(executor, i.workspaceId, context);
  } catch (error) {
    if (!(error instanceof UcAccessError)) console.error("[avvia-realizzazione] start_dialog_failed", { error: { name: error instanceof Error ? error.name : "Error" } });
    return null;
  }
}
