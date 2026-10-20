import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import type { Session } from "@/lib/auth";
import { UcAccessError, caseAccessFromRow, caseAccessPrecheck, isUcEnabledFor, ucLsDomains, type CaseAccess } from "@/lib/db/queries/uc-access";
import type { UcCommandContext } from "@/lib/db/queries/uc-cases";
import { loadDossierBaseRows } from "@/lib/db/queries/uc-dossier-base";
import { caseHeaderFromRows, type CaseHeaderData } from "@/lib/db/queries/uc-header";
import { getAppUcExecutor, type UcExecutor, type UcRow } from "@/lib/db/uc-executor";
import { timeUc } from "@/lib/uc/log";
import type { CaseRole } from "@/lib/uc/vocab";
import { UC_SHELL_PAGE_ROLES, type UcShellPage } from "@/lib/uc/views/case-shell";
import type { WorkspaceAccess } from "@/lib/workspace-access";

/**
 * Accesso e dati comuni del guscio del dossier, dopo `requireWorkspacePage(`
 * che layout e pagine chiamano da sé: flag `UC_ENABLED`, caso del workspace,
 * ruoli di caso che valgono adesso. Altrimenti 404.
 */

export interface OpenedShell {
  caseAccess: CaseAccess;
  executor: UcExecutor;
  /** Contesto di lettura: l'utente con i ruoli che valgono adesso. */
  ctx: UcCommandContext;
}

function contextFor(workspaceId: string, caseId: string, caseAccess: CaseAccess): UcCommandContext {
  return {
    workspaceId,
    caseId,
    actor: { type: "utente", userId: caseAccess.user.userId, roles: caseAccess.roles },
    user: caseAccess.user,
    lsDomains: ucLsDomains(),
  };
}

interface DossierBase {
  caseAccess: CaseAccess;
  executor: UcExecutor;
  /** Le righe della testata, lette nello stesso giro dell'accesso. */
  headerRows: UcRow[][];
}

/**
 * Accesso al caso e righe della testata in un solo giro (DESIGN §7.1 P0-5c e
 * P0-5e, `uc-dossier-base.ts`), una volta per richiesta: lo chiedono il layout,
 * la testata (`loadCaseHead`) e le pagine (`requireDossierRole`). 404 con la
 * sezione spenta, un id non valido, un caso di un altro workspace o nessun
 * ruolo (`caseAccessPrecheck`, `caseAccessFromRow`); «Sezione non disponibile»
 * (`UcAccessError`) se le tabelle non sono pronte. Gli id arrivano in
 * minuscolo, così `cache()` riconosce le chiamate uguali.
 */
const readDossierBase = cache(async function readDossierBase(workspaceId: string, caseId: string, userId: string, workspaceRole: string): Promise<DossierBase | null> {
  const input = { workspaceId, caseId, userId, workspaceRole };
  if (!isUcEnabledFor(workspaceId)) return null;
  try {
    if (!(await caseAccessPrecheck(input))) return null;
  } catch (error) {
    if (error instanceof UcAccessError && error.code === "disattivata") return null;
    throw error;
  }
  const executor = await getAppUcExecutor();
  const rows = await timeUc({ area: "uc", op: "accesso_caso", workspaceId, caseId }, () => loadDossierBaseRows(executor, { workspaceId, caseId, userId }));
  const caseAccess = caseAccessFromRow(input, rows.access);
  return caseAccess ? { caseAccess, executor, headerRows: rows.headerRows } : null;
});

async function loadDossierBase(workspaceId: string, caseId: string, userId: string, workspaceRole: string): Promise<DossierBase> {
  const base = await readDossierBase(workspaceId, caseId, userId, workspaceRole);
  if (!base) notFound();
  return base;
}

function dossierBase(workspaceId: string, caseId: string, userId: string, workspaceRole: string): Promise<DossierBase> {
  return loadDossierBase(workspaceId.toLowerCase(), caseId.toLowerCase(), userId.toLowerCase(), workspaceRole);
}

/**
 * L'accesso al caso dalla stessa lettura, senza 404: null se chi guarda non
 * vede il caso (per i pezzi che allora non si mostrano, come il pannello di
 * caricamento). «Sezione non disponibile» resta un `UcAccessError`.
 */
export async function findDossierAccess(i: { workspaceId: string; caseId: string; userId: string; workspaceRole: string }): Promise<CaseAccess | null> {
  const base = await readDossierBase(i.workspaceId.toLowerCase(), i.caseId.toLowerCase(), i.userId.toLowerCase(), i.workspaceRole);
  return base?.caseAccess ?? null;
}

/**
 * Accesso a una pagina del dossier, dopo `requireWorkspacePage(`: 404 se i
 * ruoli di caso che valgono adesso non sono tra quelli ammessi (`allow`). Lo
 * stesso giro della testata, già fatto dal layout nella stessa richiesta.
 */
export async function requireDossierRole(i: { workspaceId: string; caseId: string; userId: string; workspaceRole: string; allow?: readonly CaseRole[] }): Promise<{ caseAccess: CaseAccess; executor: UcExecutor }> {
  const { caseAccess, executor } = await dossierBase(i.workspaceId, i.caseId, i.userId, i.workspaceRole);
  if (i.allow && !caseAccess.roles.some((r) => i.allow!.includes(r))) notFound();
  return { caseAccess, executor };
}

/**
 * Dati della testata del dossier (DESIGN §3.3): accesso al caso, il caso, la
 * prontezza in cache, la scheda madre, il prossimo passo e le firme in attesa,
 * in un giro solo con l'accesso (`requireDossierRole`). Una volta per
 * richiesta (`cache`).
 */
export const loadCaseHead = cache(async function loadCaseHead(
  workspaceId: string,
  caseId: string,
  userId: string,
  workspaceRole: string,
): Promise<{ caseAccess: CaseAccess; executor: UcExecutor; header: CaseHeaderData }> {
  const { caseAccess, executor, headerRows } = await dossierBase(workspaceId, caseId, userId, workspaceRole);
  const header = await caseHeaderFromRows(executor, headerRows, { workspaceId, caseId, roles: caseAccess.roles });
  if (!header) notFound();
  return { caseAccess, executor, header };
});

/** Una pagina del guscio: 404 se il ruolo di caso non basta (`UC_SHELL_PAGE_ROLES`). */
export async function openShellPage(i: { workspaceId: string; caseId: string; session: Session; access: Pick<WorkspaceAccess, "role">; page: UcShellPage }): Promise<OpenedShell> {
  const { caseAccess, executor } = await requireDossierRole({
    workspaceId: i.workspaceId,
    caseId: i.caseId,
    userId: i.session.user.id,
    workspaceRole: i.access.role,
    allow: UC_SHELL_PAGE_ROLES[i.page],
  });
  return { caseAccess, executor, ctx: contextFor(i.workspaceId, i.caseId, caseAccess) };
}

/** Lateral Space vede tutto; chi ha solo ruoli del cliente vede solo stati e conteggi (art. 15.4). */
export function audienceOf(caseAccess: Pick<CaseAccess, "roles">): "lateral_space" | "cliente" {
  return caseAccess.roles.some((r) => r === "ls_lead" || r === "ls_analista" || r === "ls_sviluppatore") ? "lateral_space" : "cliente";
}

/** Il caso si può modificare da questa persona adesso (non in sola lettura, non chiuso). */
export function canWrite(caseAccess: Pick<CaseAccess, "readOnly" | "status">): boolean {
  return !caseAccess.readOnly && caseAccess.status !== "chiuso";
}

/**
 * Le email della coda partono davvero solo con Resend e il mittente configurati
 * (stessa regola delle azioni di `uc-people.ts`); altrimenti restano in coda e
 * Lateral Space copia il link a mano.
 */
export function ucEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.UC_EMAIL_FROM?.trim());
}

/**
 * La zona personale ha quello che le serve nella configurazione: la chiave e uno
 * store separato (Vercel Blob personale, oppure la cartella locale del harness
 * fuori da Vercel). Senza, resta chiusa anche dopo la scheda A.8.
 */
export function ucPersonalZoneConfigured(): boolean {
  const key = Boolean(process.env.UC_PERSONAL_ZONE_KEY?.trim());
  const store = Boolean(process.env.UC_PERSONAL_BLOB_READ_WRITE_TOKEN?.trim()) || (!process.env.VERCEL && Boolean(process.env.UC_LOCAL_STORAGE_DIR?.trim()));
  return key && store;
}
