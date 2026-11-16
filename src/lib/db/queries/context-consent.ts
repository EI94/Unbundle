import "server-only";
/**
 * L'ok ai sub-responsabili per le funzioni AI di «Contesto» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §6).
 *
 * Il modello legge appunti e documenti, risponde a «Chiedi al contesto» e scrive «In breve» solo nei workspace con
 * l'autorizzazione ai sub-responsabili per la lista di oggi (`SUBPROCESSORS_VERSION`), come le funzioni del referente.
 * Dalla 9a lo stesso controllo vale per la chat di Discovery e di mappatura, per la lettura dei PDF con il modello e
 * per la sintesi dei documenti. Si controlla sempre con `contextAiConsent(workspaceId)`, subito prima della chiamata
 * al modello.
 *
 * Si chiude, non si apre: se la tabella non c'è o la lettura non riesce, l'ok non c'è.
 */
import { cache } from "react";
import { getUcUserContext, ucLsDomains } from "@/lib/db/queries/uc-access";
import { loadSubprocessorAck } from "@/lib/db/queries/uc-subprocessors";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { logSafeError } from "@/lib/log/safe-error";
import { isUuid } from "@/lib/uc/ids";
import {
  SUBPROCESSORS,
  SUBPROCESSORS_VERSION,
  subprocessorDeclarerOf,
  subprocessorsLsButton,
  subprocessorsLsStatement,
  subprocessorsStatement,
} from "@/lib/uc/legal/subprocessors";
import { toStatement, ucSql } from "@/lib/uc/sql/statement";

const LOG_SCOPE = "context/consent";

/** `uc_subprocessor_acks` c'è: il risultato positivo si tiene per il processo (una tabella non sparisce). */
let acksTableSeen = false;

/** Vero se `uc_subprocessor_acks` esiste: allora l'ok si può dare, in ogni workspace. */
export async function subprocessorAcksReady(): Promise<boolean> {
  if (acksTableSeen) return true;
  try {
    const executor = await getAppUcExecutor();
    const [[row]] = await executor.batch([toStatement(ucSql`SELECT to_regclass('public.uc_subprocessor_acks') IS NOT NULL AS ok`)]);
    acksTableSeen = row?.ok === true;
    return acksTableSeen;
  } catch (error) {
    logSafeError(LOG_SCOPE, "sonda_non_riuscita", error);
    return false;
  }
}

async function readConsent(workspaceId: string): Promise<boolean> {
  if (!isUuid(workspaceId)) return false;
  try {
    if (!(await subprocessorAcksReady())) return false;
    return (await loadSubprocessorAck(await getAppUcExecutor(), workspaceId)) !== null;
  } catch (error) {
    logSafeError(LOG_SCOPE, "lettura_non_riuscita", error, { workspaceId });
    return false;
  }
}

/**
 * Vero se il workspace ha l'ok per la lista di oggi (`SUBPROCESSORS_VERSION`). Falso anche se la tabella non c'è o la
 * lettura non riesce (si chiude, non si apre). Una lettura per richiesta (`cache`).
 */
export const contextAiConsent = cache(readConsent);

/** Come `contextAiConsent`, ma rilegge sempre: per i giri lunghi (la notte), dove l'ok può arrivare a metà. */
export async function contextAiConsentNow(workspaceId: string): Promise<boolean> {
  return readConsent(workspaceId);
}

export interface AiConsentNoticeData {
  workspaceId: string;
  companyName: string;
  /** `subprocessorDeclarerOf` di chi guarda. */
  declarer: "lateral_space" | "cliente" | null;
  listVersion: string;
  /** Per Lateral Space `subprocessorsLsStatement`, per il cliente `subprocessorsStatement`. */
  statement: string;
  /** I nomi di `SUBPROCESSORS`. */
  suppliers: string[];
  /** Per Lateral Space `subprocessorsLsButton`. */
  buttonLabel: string | null;
  /** `/dashboard/<ws>/settings#sub-responsabili` */
  settingsHref: string;
}

/** null se l'ok c'è; altrimenti i dati dell'avviso per chi guarda. */
export async function loadAiConsentNotice(i: { workspaceId: string; userId: string; role: string | null }): Promise<AiConsentNoticeData | null> {
  if (await contextAiConsent(i.workspaceId)) return null;
  const [workspace, user, canDeclare] = await Promise.all([
    getWorkspaceById(i.workspaceId).catch(() => null),
    getUcUserContext(i.userId).catch(() => null),
    subprocessorAcksReady(),
  ]);
  const companyName = workspace?.name?.trim() || "la società";
  // Senza la tabella nessuno può dare l'ok: l'avviso resta senza azione.
  const declarer = canDeclare ? subprocessorDeclarerOf(user, i.role, ucLsDomains()) : null;
  return {
    workspaceId: i.workspaceId,
    companyName,
    declarer,
    listVersion: SUBPROCESSORS_VERSION,
    statement: declarer === "lateral_space" ? subprocessorsLsStatement(workspace?.name) : subprocessorsStatement(workspace?.name),
    suppliers: SUBPROCESSORS.map((s) => s.nome),
    buttonLabel: declarer === "lateral_space" ? subprocessorsLsButton(workspace?.name) : null,
    settingsHref: `/dashboard/${i.workspaceId}/settings#sub-responsabili`,
  };
}
