import "server-only";
import { UcAccessError, ensureUcAvailable, getUcUserContext, isUcEnabledFor } from "@/lib/db/queries/uc-access";
import { readStartContext, type StartContext } from "@/lib/db/queries/uc-realization";
import { countFromUseCaseQuestions, ensureFromUseCaseTemplate, listTemplatesForWorkspace } from "@/lib/db/queries/uc-templates";
import { realizationPrefillOf } from "@/lib/db/queries/use-case-dossiers";
import { getAppUcExecutor, type UcExecutor } from "@/lib/db/uc-executor";
import { errorCodeOf, ucLog } from "@/lib/uc/log";
import { checkCaseCreator } from "@/lib/uc/permissions";
import { isFromUseCaseTemplateKey } from "@/lib/uc/template/from-use-case";
import { startDefaults } from "@/lib/uc/views/realization";
import { startTemplateOptions, type StartTemplateOption } from "@/lib/uc/views/start-templates";
import type { PrefillRow } from "@/lib/use-cases/realization-prefill";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";

/**
 * Uno schema di partenza tra cui scegliere, come lo mostrano il dialogo e la pagina di ripiego: nome, riga «per che
 * tipo di caso · N domande» (`startTemplateOptions`), se è riservato al workspace e se è «Dal caso d'uso».
 */
export type StartTemplate = StartTemplateOption;

/** Quello che serve per avviare la realizzazione da uno use case (dialogo e pagina di ripiego `/casi-duso/nuovo`). */
export interface StartFormData {
  useCase: { id: string; code: string | null; title: string };
  /** Il nome è il titolo dello use case (F-020); «In una frase» arriva già compilata (F-021). */
  defaults: { title: string; oneLiner: string };
  /**
   * (R2 di `docs/dossier/SCHEMA-DI-PARTENZA.md`) Gli schemi proposti, già in ordine: «Dal caso d'uso» per primo, poi
   * gli schemi di settore che combaciano con lo use case.
   */
  templates: StartTemplate[];
  /** Gli schemi che non combaciano con lo use case: si vedono solo a richiesta («Mostra anche gli altri schemi»). */
  otherTemplates: StartTemplate[];
  /** Lo schema scelto all'apertura: «Dal caso d'uso», mai uno riservato; null = nessuno. */
  preselectedId: string | null;
  /** Il workspace non ha ancora un prefisso per i codici (F-023): si imposta in Impostazioni. */
  codeMissing: boolean;
  /** «Dati raccolti da Claude» di una scheda arrivata dal connettore (F-022), in sola lettura. */
  prefillRows: PrefillRow[];
}

/**
 * Schemi, testi di partenza e dati raccolti da Claude per un contesto di avvio già controllato. Lo usano il dialogo
 * «Avvia la realizzazione» della scheda e la pagina di ripiego, con le stesse letture.
 *
 * Lo schema di partenza (R2 di `docs/dossier/SCHEMA-DI-PARTENZA.md`): «Dal caso d'uso» c'è in ogni workspace (la riga
 * si crea alla prima apertura, sempre la stessa) e le sue domande sono le voci di «Cosa serve» dello use case; gli
 * schemi di settore si propongono solo se combaciano con lo use case (`startTemplateOptions`), gli altri restano a
 * richiesta.
 */
export async function startFormData(executor: UcExecutor, workspaceId: string, context: StartContext): Promise<StartFormData> {
  const codeMissing = context.hasCodeColumn && !context.code;
  const [templates, prefill, fromUseCaseQuestions] = await Promise.all([
    codeMissing ? Promise.resolve([]) : readStartTemplates(executor, workspaceId),
    realizationPrefillOf(workspaceId, context.useCaseId),
    codeMissing ? Promise.resolve(0) : readFromUseCaseQuestions(executor, workspaceId, context.useCaseId),
  ]);
  const choice = startTemplateOptions(
    templates.map((t) => ({
      id: t.id,
      key: t.key,
      name: t.name,
      archetype: t.archetype,
      industry: t.industry,
      functionArea: t.functionArea,
      restricted: t.restricted,
      questions: t.questions,
      fromUseCase: isFromUseCaseTemplateKey(t.key),
    })),
    { fromUseCaseQuestions, useCase: { title: context.title, problem: context.texts.problem, flow: context.texts.flow } },
  );
  const defaults = prefill ? { ...startDefaults(context.texts), oneLiner: prefill.oneLiner } : startDefaults(context.texts);
  return {
    useCase: { id: context.useCaseId, code: context.code, title: context.title },
    defaults,
    templates: choice.proposed,
    otherTemplates: choice.others,
    preselectedId: choice.preselectedId,
    codeMissing,
    prefillRows: codeMissing || !prefill ? [] : prefill.rows,
  };
}

/**
 * Gli schemi visibili al workspace, con «Dal caso d'uso»: la riga si crea qui la
 * prima volta (idempotente). Se non riesce si va avanti con gli altri schemi,
 * nessuno scelto all'apertura.
 */
async function readStartTemplates(executor: UcExecutor, workspaceId: string) {
  try {
    const ensured = await ensureFromUseCaseTemplate(executor);
    if (!ensured.ok) ucLog({ level: "warn", area: "uc", op: "start.dal_caso", code: ensured.code, workspaceId });
  } catch (error) {
    ucLog({ level: "warn", area: "uc", op: "start.dal_caso", code: errorCodeOf(error), workspaceId });
  }
  return listTemplatesForWorkspace(executor, workspaceId);
}

/** Le domande di «Dal caso d'uso»: le voci di «Cosa serve» dello use case. Senza lettura, 0 (il dossier le rilegge). */
async function readFromUseCaseQuestions(executor: UcExecutor, workspaceId: string, useCaseId: string): Promise<number> {
  try {
    return await countFromUseCaseQuestions(executor, workspaceId, useCaseId);
  } catch (error) {
    ucLog({ level: "warn", area: "uc", op: "start.dal_caso_count", code: errorCodeOf(error), workspaceId });
    return 0;
  }
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
