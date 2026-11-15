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

/** Vero se `user` ha nel caso `c` un ruolo di Lateral Space salvato (`uc_case_members`). */
export function lsStoredBuilderSql(user: SqlFragment, caseAlias = "c"): SqlFragment {
  return ucSql`EXISTS (SELECT 1 FROM uc_case_members xb_l WHERE xb_l.case_id = ${ref(caseAlias)}.id AND xb_l.user_id = ${user}
    AND xb_l.role = ANY (${cast(FACTORY_BUILDER_ROLES.filter((r) => r !== EXTERNAL_BUILDER_ROLE), "text[]")}))`;
}

/** Vero se `user` costruisce il caso `c` adesso (ruolo di Lateral Space salvato, o il predicato). */
export function buildsCaseSql(scope: BuilderScope, user: SqlFragment, caseAlias = "c"): SqlFragment {
  return ucSql`${user} IN ${builderMembersSql(scope, caseAlias)}`;
}

// ─── Le concessioni («Chi costruisce») ───────────────────────────────

/** Dove costruisce: in tutti i casi del workspace, anche in quelli che si apriranno, o in alcuni use case. */
export type BuilderWhere = { all: true } | { all: false; useCaseIds: string[] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Le concessioni del workspace, per persona: «tutti» oppure gli use case. Vuoto senza la 0037. */
export async function listExternalGrants(executor: UcExecutor, workspaceId: string): Promise<Map<string, BuilderWhere>> {
  const out = new Map<string, BuilderWhere>();
  if (!(await externalBuildersReady(executor))) return out;
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT user_id, use_case_id FROM use_case_external_builders WHERE workspace_id = ${cast(workspaceId, "uuid")} ORDER BY user_id, use_case_id NULLS FIRST`),
  ]);
  for (const r of rows) {
    const userId = String(r.user_id);
    const current = out.get(userId);
    if (r.use_case_id === null || r.use_case_id === undefined) out.set(userId, { all: true });
    else if (!current) out.set(userId, { all: false, useCaseIds: [String(r.use_case_id)] });
    else if (!current.all) current.useCaseIds.push(String(r.use_case_id));
  }
  return out;
}

/** Le concessioni di una persona nel workspace, o null se non ne ha. */
export async function readExternalGrant(executor: UcExecutor, workspaceId: string, userId: string): Promise<BuilderWhere | null> {
  if (!UUID_RE.test(userId)) return null;
  return (await listExternalGrants(executor, workspaceId)).get(userId.toLowerCase()) ?? null;
}

/** In fila per persona e workspace: due «Aggiungi» insieme non mescolano due «Dove». */
function grantLockSql(workspaceId: string, userId: string) {
  return toStatement(ucSql`SELECT pg_advisory_xact_lock(hashtext('unbundle:external-builders:' || ${cast(workspaceId, "text")} || ':' || ${cast(userId, "text")}))`);
}

/**
 * Le istruzioni che portano le concessioni di una persona al «Dove» nuovo, in una transazione sola: una riga «tutti»
 * oppure righe per caso, mai le due insieme. Gli use case sono quelli del workspace (gli altri non entrano).
 */
export function writeGrantStatements(i: { workspaceId: string; userId: string; where: BuilderWhere; actorUserId: string }) {
  const ws = cast(i.workspaceId, "uuid");
  const user = cast(i.userId, "uuid");
  const actor = cast(i.actorUserId, "uuid");
  if (i.where.all) {
    return [
      grantLockSql(i.workspaceId, i.userId),
      toStatement(ucSql`DELETE FROM use_case_external_builders WHERE workspace_id = ${ws} AND user_id = ${user} AND use_case_id IS NOT NULL`),
      toStatement(ucSql`INSERT INTO use_case_external_builders (workspace_id, user_id, use_case_id, added_by_user_id) VALUES (${ws}, ${user}, NULL, ${actor}) ON CONFLICT DO NOTHING`),
    ];
  }
  const ids = cast(i.where.useCaseIds, "uuid[]");
  return [
    grantLockSql(i.workspaceId, i.userId),
    toStatement(ucSql`DELETE FROM use_case_external_builders WHERE workspace_id = ${ws} AND user_id = ${user} AND (use_case_id IS NULL OR use_case_id <> ALL (${ids}))`),
    toStatement(ucSql`INSERT INTO use_case_external_builders (workspace_id, user_id, use_case_id, added_by_user_id)
SELECT ${ws}, ${user}, u.id, ${actor} FROM use_cases u WHERE u.workspace_id = ${ws} AND u.id = ANY (${ids})
ON CONFLICT DO NOTHING`),
  ];
}

/** Toglie tutte le concessioni della persona nel workspace (in fila con le altre scritture della persona). */
export function deleteGrantsStatements(workspaceId: string, userId: string) {
  return [
    grantLockSql(workspaceId, userId),
    toStatement(ucSql`DELETE FROM use_case_external_builders WHERE workspace_id = ${cast(workspaceId, "uuid")} AND user_id = ${cast(userId, "uuid")}`),
  ];
}

/** Gli use case del workspace tra quelli scelti (gli altri si scartano), in ordine di codice. */
export async function workspaceUseCaseIds(executor: UcExecutor, workspaceId: string, ids: readonly string[]): Promise<string[]> {
  const valid = ids.filter((id) => UUID_RE.test(id));
  if (!valid.length) return [];
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT id FROM use_cases WHERE workspace_id = ${cast(workspaceId, "uuid")} AND id = ANY (${cast(valid, "uuid[]")}) ORDER BY code NULLS LAST, id`),
  ]);
  return rows.map((r) => String(r.id));
}

/** Vero se la persona `user` ha una concessione che copre il caso `c` (per caso o per tutti i casi del workspace). */
function grantCoversCaseSql(user: SqlFragment, caseAlias = "c"): SqlFragment {
  const c = ref(caseAlias);
  return ucSql`EXISTS (SELECT 1 FROM use_case_external_builders xb_c WHERE xb_c.workspace_id = ${c}.workspace_id AND xb_c.user_id = ${user}
    AND (xb_c.use_case_id IS NULL OR xb_c.use_case_id = ${c}.portfolio_use_case_id))`;
}

/**
 * Costruisce il caso, per la concessione (anche prima della riga `osservatore`): lì non ha ruoli del cliente
 * (`addCaseMember`, `conflitto_ruoli`). Falso senza la 0037.
 */
export async function hasGrantForCase(executor: UcExecutor, i: { caseId: string; userId: string }): Promise<boolean> {
  if (!UUID_RE.test(i.caseId) || !UUID_RE.test(i.userId) || !(await externalBuildersReady(executor))) return false;
  const [rows] = await executor.batch([toStatement(ucSql`SELECT ${grantCoversCaseSql(cast(i.userId, "uuid"))} AS ok FROM uc_cases c WHERE c.id = ${cast(i.caseId, "uuid")}`)]);
  return rows[0]?.ok === true;
}

/**
 * Le e-mail (in minuscolo) di chi ha una concessione che copre il caso: non firma per il cliente lì
 * (`firmatario_costruttore`) e non fa il referente (`referente_costruttore`). Vuoto senza la 0037.
 */
export async function caseBuilderEmails(executor: UcExecutor, caseId: string): Promise<string[]> {
  if (!UUID_RE.test(caseId) || !(await externalBuildersReady(executor))) return [];
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT DISTINCT lower(u.email) AS email FROM uc_cases c JOIN use_case_external_builders g ON g.workspace_id = c.workspace_id
  AND (g.use_case_id IS NULL OR g.use_case_id = c.portfolio_use_case_id)
JOIN users u ON u.id = g.user_id
WHERE c.id = ${cast(caseId, "uuid")} AND u.email IS NOT NULL`),
  ]);
  return rows.map((r) => String(r.email));
}

/** Le e-mail (in minuscolo) di chi costruisce i casi del workspace da fuori: non fa il referente del cliente. */
export async function workspaceBuilderEmails(executor: UcExecutor, workspaceId: string): Promise<string[]> {
  if (!UUID_RE.test(workspaceId) || !(await externalBuildersReady(executor))) return [];
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT DISTINCT lower(u.email) AS email FROM use_case_external_builders g JOIN users u ON u.id = g.user_id
WHERE g.workspace_id = ${cast(workspaceId, "uuid")} AND u.email IS NOT NULL`),
  ]);
  return rows.map((r) => String(r.email));
}

/** I casi che la persona costruisce o costruiva, per «Togli»: i dossier aperti coperti dalle sue concessioni. */
export function grantedOpenCasesSql(workspaceId: string, userId: string) {
  return toStatement(ucSql`SELECT c.id, coalesce(u.code, c.code) AS code, c.portfolio_use_case_id AS use_case_id FROM uc_cases c LEFT JOIN use_cases u ON u.id = c.portfolio_use_case_id
WHERE c.workspace_id = ${cast(workspaceId, "uuid")} AND c.status <> 'chiuso' AND c.setup_completed_at IS NOT NULL AND ${grantCoversCaseSql(cast(userId, "uuid"))}
ORDER BY coalesce(u.code, c.code)`);
}
