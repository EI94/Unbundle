import "server-only";
import { cache } from "react";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { caseAccessRowSql, toCaseAccessRow, type CaseAccessRow } from "@/lib/db/queries/uc-dossier-base";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { ensureUcSchema } from "@/lib/db/ensure-schema";
import { canManageWorkspaceSettings } from "@/lib/workspace-permissions";
import { caseRoleAllowedFor, parseLsDomains, userContextFrom } from "@/lib/uc/lateral-space";
import { timeUc } from "@/lib/uc/log";
import { rolloutEnv, ucOnForEveryWorkspace } from "@/lib/uc/platform";
import { isUcWorkspaceEnabled } from "@/lib/uc/rollout";
import type { UserContext } from "@/lib/uc/types";
import { CASE_ROLES, CASE_STATUSES, isVocab, type CaseRole, type CaseStatus } from "@/lib/uc/vocab";
import { UUID } from "@/lib/uc/ids";

/**
 * Accesso alla sezione «Casi d'uso» (PIANO §3.3, §5.1; DESIGN §7.1 P0-1, P0-5c).
 *
 * - Flag `UC_ENABLED`: senza, pagine e azioni rispondono 404.
 * - Accensione per workspace `UC_WORKSPACE_IDS` (`isUcWorkspaceEnabled`): un
 *   workspace fuori elenco vede la sezione spenta, come con il flag spento. Qui
 *   la applicano `caseAccessPrecheck` (pagine del caso, con `requireDossierRole`
 *   di `components/uc/shell/case-data.ts`), `resolveCaseAccess` (azioni e rotte
 *   del caso) e `ucSectionAvailable` (azioni senza caso). Le
 *   chiamate di `ensureUcAvailable()` senza workspace controllano solo il flag:
 *   chi le usa controlla il workspace dopo (MCP, cron) oppure non lo fa ancora
 *   (lista e «Nuovo caso» di C10, `/r` di WP8: vedi RUNBOOK §5).
 * - Chi è Lateral Space: email verificata in un dominio di `UC_LS_EMAIL_DOMAINS`,
 *   ricalcolato a ogni richiesta dalla tabella `users`.
 * - I ruoli di caso si aggiungono ai ruoli del workspace: ogni pagina chiama prima
 *   `requireWorkspacePage(` e poi `requireDossierRole(` (o `loadCaseHead`); ogni
 *   azione `requireWorkspaceAccess(` e poi `assertCaseRole(`.
 * - Utente, caso e ruoli si leggono in una sola query, in `cache()` di React:
 *   layout, pagina e componenti della stessa richiesta la fanno una volta.
 */

export function isUcEnabled(): boolean {
  return process.env.UC_ENABLED === "true";
}

/** Sezione accesa per questo workspace: `UC_ENABLED` e il workspace in `UC_WORKSPACE_IDS`. */
export function isUcEnabledFor(workspaceId: string | null | undefined): boolean {
  return isUcEnabled() && isUcWorkspaceEnabled(workspaceId, rolloutEnv(process.env));
}

/** Sezione accesa per ogni workspace (`*` fuori produzione): l'unico caso in cui vale senza sapere il workspace. */
export function isUcEnabledForEveryWorkspace(): boolean {
  return isUcEnabled() && ucOnForEveryWorkspace(process.env);
}

/** Domini email di Lateral Space, dalla variabile `UC_LS_EMAIL_DOMAINS`. */
export function ucLsDomains(): string[] {
  return parseLsDomains(process.env.UC_LS_EMAIL_DOMAINS);
}

/** Senza domini configurati nessun ruolo `ls_*` vale e la sezione è in sola lettura. */
export function isUcLsConfigured(): boolean {
  return ucLsDomains().length > 0;
}

export type UcAccessErrorCode = "disattivata" | "non_disponibile" | "non_trovato";

export class UcAccessError extends Error {
  readonly code: UcAccessErrorCode;
  constructor(code: UcAccessErrorCode, message: string) {
    super(message);
    this.name = "UcAccessError";
    this.code = code;
  }
}

/**
 * Flag acceso e tabelle uc pronte; altrimenti `UcAccessError` (le route lo
 * rendono 404 o 503). Con `workspaceId` anche il workspace deve essere in
 * `UC_WORKSPACE_IDS`, altrimenti `disattivata` (404). Senza, solo il flag: il
 * chiamante deve controllare il workspace appena lo conosce.
 */
export async function ensureUcAvailable(workspaceId?: string): Promise<void> {
  if (!isUcEnabled()) throw new UcAccessError("disattivata", "Sezione non disponibile.");
  if (workspaceId !== undefined && !isUcEnabledFor(workspaceId)) throw new UcAccessError("disattivata", "Sezione non disponibile.");
  try {
    await ensureUcSchema();
  } catch {
    throw new UcAccessError("non_disponibile", "Sezione non disponibile. Riprova tra poco.");
  }
}

/** Contesto dell'utente, con «è Lateral Space» ricalcolato adesso (una lettura per richiesta). */
export const getUcUserContext = cache(async function getUcUserContext(userId: string): Promise<UserContext | null> {
  if (!UUID.test(userId)) return null;
  const result = await db.execute(sql`SELECT id, email, email_verified AS "emailVerified" FROM users WHERE id = ${userId}::uuid`);
  const row = result.rows[0] as { id: string; email: string | null; emailVerified: Date | string | null } | undefined;
  return row ? userContextFrom(row, ucLsDomains()) : null;
});

export interface CaseAccess {
  caseId: string;
  workspaceId: string;
  code: string;
  title: string;
  status: CaseStatus;
  /** Ruoli che valgono adesso per questo utente (vedi `caseRoleAllowedFor`). */
  roles: CaseRole[];
  /** Ruoli salvati in `uc_case_members`, anche quelli che ora non valgono. */
  storedRoles: CaseRole[];
  /** Non membro, ma con `canManageWorkspaceSettings`: vede il caso come osservatore. */
  implicitObserver: boolean;
  /** Sola lettura: osservatore, oppure domini di Lateral Space non configurati. */
  readOnly: boolean;
  lsConfigured: boolean;
  user: UserContext;
}

export interface CaseAccessInput {
  workspaceId: string;
  caseId: string;
  userId: string;
  /** Ruolo del workspace da `requireWorkspacePage`/`requireWorkspaceAccess`. */
  workspaceRole: string;
}

/**
 * Utente, caso e ruoli in una sola query (P0-5c), una volta per richiesta: gli
 * argomenti sono stringhe in minuscolo, così `cache()` riconosce le chiamate
 * uguali. La durata va nel log (P0-6): una riga `info` con `durationMs`, o una
 * riga `error` con il codice. Le pagine del dossier leggono la stessa riga
 * insieme alla testata (`loadDossierBaseRows`, in `case-data.ts`); qui passano
 * le action, le route e i pezzi che non vogliono un 404.
 */
const loadCaseAccessRow = cache(async function loadCaseAccessRow(workspaceId: string, caseId: string, userId: string): Promise<CaseAccessRow | null> {
  return timeUc({ area: "uc", op: "accesso_caso", workspaceId, caseId }, async () => {
    const executor = await getAppUcExecutor();
    const [rows] = await executor.batch([caseAccessRowSql(workspaceId, caseId, userId)]);
    return toCaseAccessRow(rows[0]);
  });
});

/**
 * Prima della lettura: id validi, niente partecipanti ai corsi, sezione accesa
 * per il workspace e tabelle pronte (`ensureUcAvailable`, che lancia
 * `UcAccessError`). False se la persona non vede comunque il caso.
 */
export async function caseAccessPrecheck(input: CaseAccessInput): Promise<boolean> {
  if (!UUID.test(input.caseId) || !UUID.test(input.workspaceId) || !UUID.test(input.userId)) return false;
  if (input.workspaceRole === "learner") return false;
  await ensureUcAvailable(input.workspaceId);
  return true;
}

/**
 * Accesso dell'utente al caso, oppure null se il caso non esiste, non è di quel
 * workspace, non è pronto (`setup_completed_at`) o l'utente non lo può vedere.
 * Lancia `UcAccessError` se la sezione è spenta (anche solo per questo
 * workspace: `disattivata`) o non disponibile.
 */
export async function resolveCaseAccess(input: CaseAccessInput): Promise<CaseAccess | null> {
  if (!(await caseAccessPrecheck(input))) return null;
  const row = await loadCaseAccessRow(input.workspaceId.toLowerCase(), input.caseId.toLowerCase(), input.userId.toLowerCase());
  return caseAccessFromRow(input, row);
}

/** Dalla riga dell'accesso: i ruoli che valgono adesso, l'osservatore implicito, la sola lettura. Null se non vede il caso. */
export function caseAccessFromRow(input: CaseAccessInput, row: CaseAccessRow | null): CaseAccess | null {
  if (!row?.id || !row.status || !isVocab(CASE_STATUSES, row.status)) return null;
  const user = userContextFrom({ id: row.userId, email: row.email, emailVerified: row.emailVerified }, ucLsDomains());

  const rawRoles = Array.isArray(row.roles) ? row.roles : parsePgArray(row.roles ?? "{}");
  const storedRoles = rawRoles.filter((r): r is CaseRole => isVocab(CASE_ROLES, r));
  // Client roles need a verified email outside the Lateral Space domains (D16, D36).
  const lsDomains = ucLsDomains();
  const effective = storedRoles.filter((r) => caseRoleAllowedFor(user, r, lsDomains));
  const lsConfigured = isUcLsConfigured();

  let roles = effective;
  let implicitObserver = false;
  if (roles.length === 0) {
    // Un membro i cui ruoli ora non valgono (es. dominio tolto) e chi gestisce il
    // workspace vedono il caso in sola lettura; tutti gli altri no.
    if (storedRoles.length === 0 && !canManageWorkspaceSettings(input.workspaceRole)) return null;
    roles = ["osservatore"];
    implicitObserver = storedRoles.length === 0;
  }
  const readOnly = !lsConfigured || roles.every((r) => r === "osservatore");

  return {
    caseId: row.id,
    workspaceId: row.workspaceId ?? input.workspaceId.toLowerCase(),
    code: row.code ?? "",
    title: row.title ?? "",
    status: row.status,
    roles,
    storedRoles,
    implicitObserver,
    readOnly,
    lsConfigured,
    user,
  };
}

function parsePgArray(value: string): string[] {
  const inner = value.replace(/^\{|\}$/g, "");
  return inner ? inner.split(",").map((s) => s.replace(/^"|"$/g, "")) : [];
}

/** Per le server action e le route: 404 delle pagine come `UcAccessError`. */
export async function assertCaseRole(input: CaseAccessInput & { allow?: readonly CaseRole[] }): Promise<CaseAccess> {
  const access = await resolveCaseAccess(input);
  if (!access || (input.allow && !access.roles.some((r) => input.allow!.includes(r)))) {
    throw new UcAccessError("non_trovato", "Caso non trovato o non accessibile.");
  }
  return access;
}
