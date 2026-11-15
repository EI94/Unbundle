/**
 * Chi costruisce i casi di un cliente da fuori Lateral Space (rilascio 8.0c «Esterni al 100%»,
 * docs/rilascio-8/RILASCIO-8.0c-ESTERNI.md §2, §4 e §7): l'unico modulo che legge e scrive
 * `use_case_external_builders` (0037).
 *
 * - **Il predicato** (`externalBuilderSql`): un solo frammento SQL dice chi è sviluppatore esterno di un caso, adesso.
 *   Lo usano le porte (le scritture: `isExternalBuilderOfCase`) e gli elenchi (campanella, e-mail, barra, «Da fare per
 *   te», «passa», proposte: `builderMembersSql`, `caseRecipientsSql`). Così una persona non vede mai la voce, i «Da
 *   fare» o la campanella per poi ricevere 403, e nessuno le passa un compito che non può fare.
 *   - Una concessione per il caso (o per tutti i casi del workspace);
 *   - nel caso solo la riga `osservatore` (la riga serve, ma non basta; con un altro ruolo non costruisce);
 *   - e-mail verificata, fuori dai domini di Lateral Space, con i domini configurati (`isClientUser`);
 *   - un ruolo da revisore, prima nell'organizzazione poi nel workspace (`getWorkspaceAccessForUser`,
 *     `PORTFOLIO_REVIEWER_ROLES`).
 *   Si rilegge a ogni richiesta: chi scende a Contributore o perde la verifica dell'e-mail smette di costruire subito.
 * - **Senza la 0037** il frammento vale `false`: si chiude, non si apre (`BuilderScope.externalReady`).
 *
 * Modulo senza import dell'app (`@/…`, `server-only`), come `uc-cases.ts`: lo usano anche i comandi dei casi, le
 * notifiche dei compiti e il cron. I domini di Lateral Space li passa chi chiama.
 */
import { EXTERNAL_BUILDERS_PROBE_SQL } from "../use-case-hub-builders-ddl.ts";
import { cast, raw, ref, toStatement, ucSql, type SqlFragment } from "../../uc/sql/statement.ts";
import { EXTERNAL_BUILDER_ROLE, FACTORY_BUILDER_ROLES, type FactoryRole } from "../../use-cases/factory/builders.ts";
import { PORTFOLIO_REVIEWER_ROLES } from "../../workspace-permissions.ts";
import type { UcExecutor } from "../uc-executor.ts";

// ─── Sonda e ambito ──────────────────────────────────────────────────

/** Vero se la 0037 è applicata (la stessa sonda di `ensureDbSchema`). */
export async function externalBuildersReady(executor: UcExecutor): Promise<boolean> {
  try {
    const [rows] = await executor.batch([toStatement(ucSql`SELECT ${raw(EXTERNAL_BUILDERS_PROBE_SQL)} AS ready`)]);
    return rows[0]?.ready === true;
  } catch {
    return false;
  }
}

/**
 * Quello che serve agli elenchi per dire chi costruisce: i domini di Lateral Space (`UC_LS_EMAIL_DOMAINS`) e se la 0037
 * c'è. Si legge una volta per comando, prima di costruire le istruzioni.
 */
export interface BuilderScope {
  lsDomains: readonly string[];
  externalReady: boolean;
}

export async function loadBuilderScope(executor: UcExecutor, lsDomains: readonly string[]): Promise<BuilderScope> {
  return { lsDomains: [...lsDomains], externalReady: lsDomains.length > 0 && (await externalBuildersReady(executor)) };
}

/** Un ambito senza esterni: la 0037 manca, o l'elenco li esclude. */
export const NO_EXTERNAL_BUILDERS: BuilderScope = Object.freeze({ lsDomains: [], externalReady: false });

// ─── Il predicato ────────────────────────────────────────────────────

const REVIEWER_ROLES_SQL = raw(PORTFOLIO_REVIEWER_ROLES.map((r) => `'${r}'`).join(", "));

/** Il ruolo nel workspace di `u`, come `getWorkspaceAccessForUser`: prima l'organizzazione, poi il workspace. */
function workspaceRoleSql(workspace: SqlFragment, user: SqlFragment): SqlFragment {
  return ucSql`coalesce(
    (SELECT xb_om.role::text FROM memberships xb_om JOIN workspaces xb_ow ON xb_ow.organization_id = xb_om.organization_id
      WHERE xb_ow.id = ${workspace} AND xb_om.user_id = ${user} LIMIT 1),
    (SELECT xb_wm.role::text FROM workspace_memberships xb_wm WHERE xb_wm.workspace_id = ${workspace} AND xb_wm.user_id = ${user} LIMIT 1))`;
}

/**
 * Chi è sviluppatore esterno del caso `c` (una riga di `uc_cases`), per la persona `u` (una riga di `users`), adesso.
 * Senza la 0037, o senza domini di Lateral Space, vale `false`.
 */
export function externalBuilderSql(scope: BuilderScope, aliases: { c?: string; u?: string } = {}): SqlFragment {
  if (!scope.externalReady || scope.lsDomains.length === 0) return raw("false");
  const caseAlias = aliases.c ?? "c";
  const userAlias = aliases.u ?? "u";
  const c = ref(caseAlias);
  const u = ref(userAlias);
  const domains = cast([...scope.lsDomains], "text[]");
  return ucSql`(EXISTS (SELECT 1 FROM use_case_external_builders xb_g
    WHERE xb_g.workspace_id = ${c}.workspace_id AND xb_g.user_id = ${u}.id
      AND (xb_g.use_case_id IS NULL OR xb_g.use_case_id = ${c}.portfolio_use_case_id))
  AND EXISTS (SELECT 1 FROM uc_case_members xb_m WHERE xb_m.case_id = ${c}.id AND xb_m.user_id = ${u}.id AND xb_m.role = 'osservatore')
  AND NOT EXISTS (SELECT 1 FROM uc_case_members xb_m WHERE xb_m.case_id = ${c}.id AND xb_m.user_id = ${u}.id AND xb_m.role <> 'osservatore')
  AND ${u}.email_verified IS NOT NULL
  AND cardinality(${domains}) > 0
  AND coalesce(lower(substring(btrim(${u}.email) FROM '@([^@]*)$')), '') <> ALL (${domains})
  AND ${workspaceRoleSql(ref(`${caseAlias}.workspace_id`), ref(`${userAlias}.id`))} IN (${REVIEWER_ROLES_SQL}))`;
}

/** È sviluppatore esterno di questo caso, adesso? Falso senza la 0037 o senza domini di Lateral Space. */
export async function isExternalBuilderOfCase(executor: UcExecutor, i: { caseId: string; userId: string; lsDomains: readonly string[] }): Promise<boolean> {
  const scope = await loadBuilderScope(executor, i.lsDomains);
  if (!scope.externalReady) return false;
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT ${externalBuilderSql(scope)} AS ok FROM uc_cases c JOIN users u ON u.id = ${cast(i.userId, "uuid")} WHERE c.id = ${cast(i.caseId, "uuid")}`),
  ]);
  return rows[0]?.ok === true;
}

// ─── I destinatari ───────────────────────────────────────────────────

/**
 * Chi nel caso `c` ha uno dei ruoli (una colonna `user_id`): i ruoli salvati in `uc_case_members` e, con
 * `builder_esterno` nell'elenco, chi costruisce il caso da fuori adesso (il predicato).
 */
export function caseRecipientsSql(roles: readonly FactoryRole[], scope: BuilderScope, caseAlias = "c"): SqlFragment {
  const c = ref(caseAlias);
  const caseRoles = roles.filter((r) => r !== EXTERNAL_BUILDER_ROLE);
  const stored = ucSql`SELECT xb_r.user_id FROM uc_case_members xb_r WHERE xb_r.case_id = ${c}.id AND xb_r.role = ANY (${cast(caseRoles, "text[]")})`;
  if (!roles.includes(EXTERNAL_BUILDER_ROLE) || !scope.externalReady) return ucSql`(${stored})`;
  return ucSql`(${stored}
  UNION
  SELECT xb_u.id AS user_id FROM uc_case_members xb_o JOIN users xb_u ON xb_u.id = xb_o.user_id
  WHERE xb_o.case_id = ${c}.id AND xb_o.role = 'osservatore' AND ${externalBuilderSql(scope, { c: caseAlias, u: "xb_u" })})`;
}

/** Chi costruisce il caso `c` adesso: i ruoli di Lateral Space salvati più chi costruisce da fuori. */
export function builderMembersSql(scope: BuilderScope, caseAlias = "c"): SqlFragment {
  return caseRecipientsSql(FACTORY_BUILDER_ROLES, scope, caseAlias);
}

/** Vero se `user` costruisce il caso `c` adesso (ruolo di Lateral Space salvato, o il predicato). */
export function buildsCaseSql(scope: BuilderScope, user: SqlFragment, caseAlias = "c"): SqlFragment {
  return ucSql`${user} IN ${builderMembersSql(scope, caseAlias)}`;
}
