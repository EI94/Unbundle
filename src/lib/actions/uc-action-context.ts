import "server-only";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import type { Session } from "@/lib/auth";
import type { WorkspaceAccess } from "@/lib/workspace-access";
import { UcAccessError, assertCaseRole, ensureUcAvailable, isUcEnabledFor, isUcEnabledForEveryWorkspace, ucLsDomains, type CaseAccess } from "@/lib/db/queries/uc-access";
import { refreshReadinessCache, type UcCommandContext } from "@/lib/db/queries/uc-cases";
import { dispatchDue } from "@/lib/db/queries/uc-notifications-dispatch";
import { getAppUcExecutor, type UcExecutor } from "@/lib/db/uc-executor";
import { ucLogError } from "@/lib/uc/log";
import type { Result } from "@/lib/uc/types";
import type { CaseRole } from "@/lib/uc/vocab";
import { UUID } from "@/lib/uc/ids";

/**
 * Aiuti comuni alle server action della sezione «Casi d'uso» (PIANO §5.3).
 *
 * Non è un file `"use server"`: non esporta azioni. Ogni azione in
 * `src/lib/actions/uc-*.ts` chiama per prima `requireWorkspaceAccess(workspaceId)`
 * (lo controlla `workspace-isolation.test.ts`), poi `openUcCase` qui sotto, che
 * aggiunge i ruoli di caso (`assertCaseRole`), il flag `UC_ENABLED`,
 * l'accensione del workspace (`UC_WORKSPACE_IDS`) e la sola lettura. Dopo un comando riuscito `finishUcCommand` invalida la testata del
 * caso e, dopo la risposta, ricalcola la cache della prontezza e invia la coda.
 */

/** Esito di un'azione: solo dati che servono all'interfaccia, mai valori personali. */
export type UcActionResult<T = null> = { ok: true; data: T; message?: string } | { ok: false; code: string; message: string };

export const CASE_LAYOUT_PATH = "/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]";
export const CASE_LIST_PATH = "/(dashboard)/dashboard/[workspaceId]/casi-duso";

export function ucFailure(code: string, message: string): UcActionResult<never> {
  return { ok: false, code, message };
}

export function fromResult<T, U = T>(r: Result<T>, map?: (value: T) => U, message?: string): UcActionResult<U> {
  if (!r.ok) return ucFailure(r.code, r.message);
  return { ok: true, data: map ? map(r.value) : (r.value as unknown as U), ...(message ? { message } : {}) };
}

const DISABLED = ucFailure("disattivata", "Sezione non disponibile.");

/**
 * La sezione è accesa per il workspace dell'azione (`UC_ENABLED` e
 * `UC_WORKSPACE_IDS`, DESIGN §7.1 P0-1) e le tabelle uc sono pronte.
 *
 * Senza `workspaceId` vale solo se la sezione è accesa per ogni workspace (`*`,
 * fuori produzione): con un elenco esplicito un'azione che non dice il suo
 * workspace è rifiutata, così non crea nulla in un workspace spento.
 */
export async function ucSectionAvailable(workspaceId?: string): Promise<UcActionResult<null>> {
  if (workspaceId === undefined ? !isUcEnabledForEveryWorkspace() : !isUcEnabledFor(workspaceId)) return DISABLED;
  try {
    await ensureUcAvailable(workspaceId);
    return { ok: true, data: null };
  } catch (error) {
    if (error instanceof UcAccessError) return ucFailure(error.code, error.message);
    throw error;
  }
}

export interface OpenedUcCase {
  executor: UcExecutor;
  ctx: UcCommandContext;
  caseAccess: CaseAccess;
}

/**
 * Accesso al caso per un'azione: flag, caso del workspace, ruoli che valgono
 * adesso (`allow`), e per le scritture niente sola lettura (osservatori, domini
 * di Lateral Space non configurati).
 */
export async function openUcCase(i: {
  session: Session;
  access: WorkspaceAccess;
  workspaceId: string;
  caseId: unknown;
  allow?: readonly CaseRole[];
  write?: boolean;
}): Promise<{ ok: true; value: OpenedUcCase } | { ok: false; result: UcActionResult<never> }> {
  // Flag generale e accensione del workspace (P0-1): fuori elenco come a sezione spenta.
  if (!isUcEnabledFor(i.workspaceId)) return { ok: false, result: DISABLED };
  if (typeof i.caseId !== "string" || !UUID.test(i.caseId)) return { ok: false, result: ucFailure("non_trovato", "Caso non trovato o non accessibile.") };
  let caseAccess: CaseAccess;
  try {
    caseAccess = await assertCaseRole({ workspaceId: i.workspaceId, caseId: i.caseId, userId: i.session.user.id, workspaceRole: i.access.role, allow: i.allow });
  } catch (error) {
    if (error instanceof UcAccessError) return { ok: false, result: ucFailure(error.code, error.message) };
    throw error;
  }
  if (i.write !== false && caseAccess.readOnly) {
    return {
      ok: false,
      result: caseAccess.lsConfigured
        ? ucFailure("sola_lettura", "Hai accesso al caso in sola lettura.")
        : ucFailure("configurazione_incompleta", "Configurazione incompleta: manca l'elenco dei domini di Lateral Space."),
    };
  }
  const executor = await getAppUcExecutor();
  return {
    ok: true,
    value: {
      executor,
      caseAccess,
      ctx: {
        workspaceId: i.workspaceId,
        caseId: i.caseId,
        actor: { type: "utente", userId: caseAccess.user.userId, roles: caseAccess.roles },
        user: caseAccess.user,
        lsDomains: ucLsDomains(),
      },
    },
  };
}

/**
 * Dopo un comando riuscito: la testata sta nel layout del caso e va invalidata
 * con lui (percorso dinamico, quindi `type` obbligatorio); dopo la risposta la
 * cache `uc_cases.readiness` si ricalcola e la coda delle notifiche parte.
 */
export function finishUcCommand(target: { workspaceId: string; caseId: string | null }): void {
  const { workspaceId, caseId } = target;
  revalidatePath(CASE_LIST_PATH, "page");
  if (!caseId) return;
  revalidatePath(CASE_LAYOUT_PATH, "layout");
  after(async () => {
    try {
      const executor = await getAppUcExecutor();
      await refreshReadinessCache(executor, workspaceId, caseId);
      await dispatchDue({ caseId });
    } catch (error) {
      ucLogError({ area: "uc", op: "dopo_il_comando", workspaceId, caseId }, error);
    }
  });
}
