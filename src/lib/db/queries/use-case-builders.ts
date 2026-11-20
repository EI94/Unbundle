/**
 * Chi costruisce i casi di un cliente da fuori Lateral Space (rilascio 8.0c «Esterni al 100%»,
 * docs/rilascio-8/RILASCIO-8.0c-ESTERNI.md §2, §4 e §7): l'unico modulo che legge e scrive
 * `use_case_external_builders` (0037).
 *
 * - **Il predicato** (`externalBuilderSql`): un solo frammento SQL dice chi è sviluppatore esterno di un caso, adesso.
 *   Lo usano le porte (le scritture: `isExternalBuilderOfCase`) e gli elenchi (campanella, e-mail, barra, «Da fare per
 *   te», «passa», proposte: `builderMembersSql`, `caseRecipientsSql`). Così una persona non vede mai la voce, i «Da
 *   fare» o la campanella per poi ricevere 403, e nessuno le passa un compito che non può fare.
 *   - Una concessione per il caso (o per tutti i casi del workspace: mai un dossier senza use case);
 *   - nel caso solo la riga `osservatore` (la riga serve, ma non basta; con un altro ruolo non costruisce);
 *   - e-mail verificata, fuori dai domini di Lateral Space, con i domini configurati (`isClientUser`);
 *   - un ruolo da revisore, prima nell'organizzazione poi nel workspace (`getWorkspaceAccessForUser`,
 *     `PORTFOLIO_REVIEWER_ROLES`); **oppure** (8.0d) «Solo questo use case» (`esterno_caso`, solo nel workspace, mai
 *     un membro dell'organizzazione) con una concessione **per quel caso**: mai «tutti», nemmeno scritta a mano.
 *   Si rilegge a ogni richiesta: chi scende a Contributore o perde la verifica dell'e-mail smette di costruire subito.
 * - **Senza la 0037** il frammento vale `false`: si chiude, non si apre (`BuilderScope.externalReady`). Alle porte chi ha
 *   una concessione riceve però «riprova» (503), non «non hai un ruolo» (`externalBuilderGate`).
 *
 * Modulo senza import dell'app (`@/…`, `server-only`), come `uc-cases.ts`: lo usano anche i comandi dei casi, le
 * notifiche dei compiti e il cron. I domini di Lateral Space li passa chi chiama.
 */
import { EXTERNAL_BUILDERS_PROBE_SQL, EXTERNAL_BUILDERS_TABLE } from "../use-case-hub-builders-ddl.ts";
import { CASE_ONLY_PROBE_SQL } from "../use-case-hub-case-only-ddl.ts";
import { cast, raw, ref, toStatement, ucSql, type SqlFragment, type UcStatement } from "../../uc/sql/statement.ts";
import { EXTERNAL_BUILDER_ROLE, FACTORY_BUILDER_ROLES, type ExternalBuilderBlock, type FactoryRole } from "../../use-cases/factory/builders.ts";
import { CLIENT_CASE_ROLES } from "../../uc/vocab.ts";
import { PORTFOLIO_REVIEWER_ROLES } from "../../workspace-permissions.ts";
import type { UcExecutor } from "../uc-executor.ts";

// ─── Sonda e ambito ──────────────────────────────────────────────────

/**
 * La 0037 (la stessa sonda di `ensureDbSchema`): `pronta` (tabella, chiave e indici unici), `assente` (la sonda è falsa),
 * `guasta` (la sonda non risponde). Finché non è pronta nessuno costruisce da fuori: si chiude, non si apre.
 */
export type ExternalBuildersProbe = "pronta" | "assente" | "guasta";

export async function probeExternalBuilders(executor: UcExecutor): Promise<ExternalBuildersProbe> {
  try {
    const [rows] = await executor.batch([toStatement(ucSql`SELECT ${raw(EXTERNAL_BUILDERS_PROBE_SQL)} AS ready`)]);
    return rows[0]?.ready === true ? "pronta" : "assente";
  } catch {
    return "guasta";
  }
}

/** Vero se la 0037 è applicata. Una sonda che non risponde vale «no». */
export async function externalBuildersReady(executor: UcExecutor): Promise<boolean> {
  return (await probeExternalBuilders(executor)) === "pronta";
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

/**
 * La concessione `g` (una riga di `use_case_external_builders`) copre il caso `c` (una riga di `uc_cases`): lo stesso
 * workspace, e lo use case del caso oppure «tutti i casi». Solo un dossier di uno use case: la fabbrica lavora per use
 * case, e un dossier senza use case non entra mai, nemmeno con «tutti».
 */
function grantCoversSql(c: SqlFragment, g: SqlFragment): SqlFragment {
  return ucSql`${g}.workspace_id = ${c}.workspace_id AND ${c}.portfolio_use_case_id IS NOT NULL
      AND (${g}.use_case_id IS NULL OR ${g}.use_case_id = ${c}.portfolio_use_case_id)`;
}

/**
 * (8.0d) `user` è «Solo questo use case» nel workspace: la riga del workspace con il ruolo `esterno_caso` (come testo), e
 * nessuna riga nell'organizzazione (un membro dell'organizzazione non è mai «Solo questo use case»).
 */
function caseOnlyMemberSql(workspace: SqlFragment, user: SqlFragment): SqlFragment {
  return ucSql`(EXISTS (SELECT 1 FROM workspace_memberships xb_cw WHERE xb_cw.workspace_id = ${workspace} AND xb_cw.user_id = ${user} AND xb_cw.role::text = 'esterno_caso')
    AND NOT EXISTS (SELECT 1 FROM memberships xb_co JOIN workspaces xb_cow ON xb_cow.organization_id = xb_co.organization_id
      WHERE xb_cow.id = ${workspace} AND xb_co.user_id = ${user}))`;
}

/** Il ruolo nel workspace di `u`, come `getWorkspaceAccessForUser`: prima l'organizzazione, poi il workspace. */
function workspaceRoleSql(workspace: SqlFragment, user: SqlFragment): SqlFragment {
  return ucSql`coalesce(
    (SELECT xb_om.role::text FROM memberships xb_om JOIN workspaces xb_ow ON xb_ow.organization_id = xb_om.organization_id
      WHERE xb_ow.id = ${workspace} AND xb_om.user_id = ${user} LIMIT 1),
    (SELECT xb_wm.role::text FROM workspace_memberships xb_wm WHERE xb_wm.workspace_id = ${workspace} AND xb_wm.user_id = ${user} LIMIT 1))`;
}

/**
 * Chi è sviluppatore esterno del caso `c` (una riga di `uc_cases`), per la persona `u` (una riga di `users`), adesso.
 * Senza la 0037, o senza domini di Lateral Space, vale `false`. `anyWorkspaceRole`: tutto il predicato tranne il ruolo
 * da revisore nel workspace, solo per dire alle porte perché una persona scesa a Contributore non costruisce più.
 *
 * (8.0d) Due strade, con la riga `osservatore`, nessun altro ruolo nel caso, l'e-mail verificata fuori da Lateral Space:
 * - un ruolo da revisore nel workspace e una concessione che copre il caso (per caso o «tutti»), come nella 8.0c;
 * - «Solo questo use case» (`esterno_caso` nel workspace, mai nell'organizzazione) e una concessione **per questo
 *   caso**: una riga «tutti» non conta mai, nemmeno scritta a mano.
 */
export function externalBuilderSql(scope: BuilderScope, aliases: { c?: string; u?: string } = {}, opts: { anyWorkspaceRole?: boolean } = {}): SqlFragment {
  if (!scope.externalReady || scope.lsDomains.length === 0) return raw("false");
  const caseAlias = aliases.c ?? "c";
  const userAlias = aliases.u ?? "u";
  const c = ref(caseAlias);
  const u = ref(userAlias);
  const domains = cast([...scope.lsDomains], "text[]");
  const workspace = ref(`${caseAlias}.workspace_id`);
  const user = ref(`${userAlias}.id`);
  const reviewer = ucSql`(EXISTS (SELECT 1 FROM use_case_external_builders xb_g WHERE ${grantCoversSql(c, ref("xb_g"))} AND xb_g.user_id = ${u}.id)
    AND ${opts.anyWorkspaceRole ? raw("true") : ucSql`${workspaceRoleSql(workspace, user)} IN (${REVIEWER_ROLES_SQL})`})`;
  const caseOnly = ucSql`(EXISTS (SELECT 1 FROM use_case_external_builders xb_gc WHERE xb_gc.workspace_id = ${c}.workspace_id AND xb_gc.user_id = ${u}.id
      AND ${c}.portfolio_use_case_id IS NOT NULL AND xb_gc.use_case_id = ${c}.portfolio_use_case_id)
    AND ${caseOnlyMemberSql(workspace, user)})`;
  return ucSql`(EXISTS (SELECT 1 FROM uc_case_members xb_m WHERE xb_m.case_id = ${c}.id AND xb_m.user_id = ${u}.id AND xb_m.role = 'osservatore')
  AND NOT EXISTS (SELECT 1 FROM uc_case_members xb_m WHERE xb_m.case_id = ${c}.id AND xb_m.user_id = ${u}.id AND xb_m.role <> 'osservatore')
  AND ${u}.email_verified IS NOT NULL
  AND cardinality(${domains}) > 0
  AND coalesce(lower(substring(btrim(${u}.email) FROM '@([^@]*)$')), '') <> ALL (${domains})
  AND (${reviewer} OR ${caseOnly}))`;
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

/**
 * Per la coda delle e-mail (`loadDeliveryFacts`), con una sonda sola: la persona costruisce il caso adesso (il predicato;
 * falso senza caso) e ha una concessione nel workspace. `null` quando la 0037 non è pronta (la tabella non c'è ancora, o
 * la sonda non risponde): non si sa, e la coda tiene l'e-mail per il prossimo giro invece di leggerlo come «no».
 */
export async function externalBuilderMailFacts(
  executor: UcExecutor,
  i: { workspaceId: string; caseId: string | null; userId: string; lsDomains: readonly string[] },
): Promise<{ buildsCase: boolean; grant: boolean } | null> {
  if ((await probeExternalBuilders(executor)) !== "pronta") return null;
  if (!UUID_RE.test(i.workspaceId) || !UUID_RE.test(i.userId)) return { buildsCase: false, grant: false };
  const scope: BuilderScope = { lsDomains: [...i.lsDomains], externalReady: true };
  const user = cast(i.userId, "uuid");
  const builds =
    i.caseId && UUID_RE.test(i.caseId)
      ? ucSql`coalesce((SELECT ${externalBuilderSql(scope)} FROM uc_cases c JOIN users u ON u.id = ${user} WHERE c.id = ${cast(i.caseId, "uuid")}), false)`
      : raw("false");
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT ${builds} AS builds,
  EXISTS (SELECT 1 FROM use_case_external_builders xb_w WHERE xb_w.workspace_id = ${cast(i.workspaceId, "uuid")} AND xb_w.user_id = ${user}) AS granted`),
  ]);
  return { buildsCase: rows[0]?.builds === true, grant: rows[0]?.granted === true };
}

/**
 * Per le porte (`loadFactoryAccess`): costruisce il caso da fuori adesso (il predicato), e se no, perché, quando le porte
 * lo devono dire (`ExternalBuilderBlock`). Con la 0037 non pronta nessuno costruisce da fuori, ma a chi ha una concessione
 * che copre il caso, o se non si riesce a saperlo, la risposta è «riprova» (`non_disponibile`), non «non hai un ruolo».
 */
export async function externalBuilderGate(
  executor: UcExecutor,
  i: { caseId: string; userId: string; lsDomains: readonly string[] },
): Promise<{ builds: boolean; blocked: ExternalBuilderBlock | null }> {
  if (i.lsDomains.length === 0 || !UUID_RE.test(i.caseId) || !UUID_RE.test(i.userId)) return { builds: false, blocked: null };
  if ((await probeExternalBuilders(executor)) !== "pronta") {
    return { builds: false, blocked: (await grantMaybeHeld(executor, i)) ? "non_disponibile" : null };
  }
  const scope: BuilderScope = { lsDomains: [...i.lsDomains], externalReady: true };
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT ${externalBuilderSql(scope)} AS ok, ${externalBuilderSql(scope, {}, { anyWorkspaceRole: true })} AS but_role
FROM uc_cases c JOIN users u ON u.id = ${cast(i.userId, "uuid")} WHERE c.id = ${cast(i.caseId, "uuid")}`),
  ]);
  if (rows[0]?.ok === true) return { builds: true, blocked: null };
  // Tutto vero tranne il ruolo nel workspace: le porte dicono che si cambia da Impostazioni › Persone.
  return { builds: false, blocked: rows[0]?.but_role === true ? "ruolo_workspace" : null };
}

/**
 * Con la 0037 non pronta: la persona può avere una concessione che copre il caso? Senza la tabella no (nessuno ne ha);
 * con la tabella, la si legge; se la lettura non riesce, sì: meglio «riprova» che «non hai un ruolo».
 */
async function grantMaybeHeld(executor: UcExecutor, i: { caseId: string; userId: string }): Promise<boolean> {
  try {
    const [table] = await executor.batch([toStatement(ucSql`SELECT to_regclass(${cast(`public.${EXTERNAL_BUILDERS_TABLE}`, "text")}) IS NOT NULL AS present`)]);
    if (table[0]?.present !== true) return false;
    const [rows] = await executor.batch([
      toStatement(ucSql`SELECT ${grantCoversCaseSql(cast(i.userId, "uuid"))} AS held FROM uc_cases c WHERE c.id = ${cast(i.caseId, "uuid")}`),
    ]);
    return rows[0]?.held === true;
  } catch {
    return true;
  }
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

/**
 * In fila per persona e workspace: due «Aggiungi» insieme non mescolano due «Dove», e la riga `osservatore` di un dossier
 * nuovo non entra mentre «Togli» toglie le concessioni (`grantGuardStatements`).
 */
function grantLockSql(workspaceId: string, userId: string) {
  return toStatement(
    ucSql`SELECT pg_advisory_xact_lock(hashtext('unbundle:external-builders:' || ${cast(workspaceId.toLowerCase(), "text")} || ':' || ${cast(userId.toLowerCase(), "text")}))`,
  );
}

/**
 * Le istruzioni che portano le concessioni di una persona al «Dove» nuovo, in una transazione sola: una riga «tutti»
 * oppure righe per caso, mai le due insieme. Gli use case sono quelli del workspace (gli altri non entrano).
 *
 * I dossier aperti che le concessioni coprivano si leggono qui, dopo il lock della persona (il risultato `casesAt`, con
 * `id`, `code`, `use_case_id`), come fa «Togli»: così tra i casi da cui esce c'è anche il dossier dove la riga
 * `osservatore` è entrata un attimo prima, e dopo, lì, non ne entra più nessuna (`grantGuardStatements`).
 */
export function writeGrantStatements(i: { workspaceId: string; userId: string; where: BuilderWhere; actorUserId: string }): { statements: UcStatement[]; casesAt: number } {
  const ws = cast(i.workspaceId, "uuid");
  const user = cast(i.userId, "uuid");
  const actor = cast(i.actorUserId, "uuid");
  const head = [grantLockSql(i.workspaceId, i.userId), grantedOpenCasesSql(i.workspaceId, i.userId)];
  if (i.where.all) {
    return {
      statements: [
        ...head,
        toStatement(ucSql`DELETE FROM use_case_external_builders WHERE workspace_id = ${ws} AND user_id = ${user} AND use_case_id IS NOT NULL`),
        toStatement(ucSql`INSERT INTO use_case_external_builders (workspace_id, user_id, use_case_id, added_by_user_id) VALUES (${ws}, ${user}, NULL, ${actor}) ON CONFLICT DO NOTHING`),
      ],
      casesAt: 1,
    };
  }
  const ids = cast(i.where.useCaseIds, "uuid[]");
  return {
    statements: [
      ...head,
      toStatement(ucSql`DELETE FROM use_case_external_builders WHERE workspace_id = ${ws} AND user_id = ${user} AND (use_case_id IS NULL OR use_case_id <> ALL (${ids}))`),
      toStatement(ucSql`INSERT INTO use_case_external_builders (workspace_id, user_id, use_case_id, added_by_user_id)
SELECT ${ws}, ${user}, u.id, ${actor} FROM use_cases u WHERE u.workspace_id = ${ws} AND u.id = ANY (${ids})
ON CONFLICT DO NOTHING`),
    ],
    casesAt: 1,
  };
}

const deleteGrantsSql = (workspaceId: string, userId: string) =>
  toStatement(ucSql`DELETE FROM use_case_external_builders WHERE workspace_id = ${cast(workspaceId, "uuid")} AND user_id = ${cast(userId, "uuid")}`);

/** Toglie tutte le concessioni della persona nel workspace (in fila con le altre scritture della persona). */
export function deleteGrantsStatements(workspaceId: string, userId: string) {
  return [grantLockSql(workspaceId, userId), deleteGrantsSql(workspaceId, userId)];
}

/**
 * «Togli», in fila con le altre scritture della persona: i dossier aperti che le concessioni coprono, letti dopo il lock
 * (così c'è anche quello dove una riga `osservatore` è entrata un attimo prima), poi le concessioni tolte. Le righe del
 * primo risultato hanno `id`, `code`, `use_case_id`.
 */
export function removeGrantsStatements(workspaceId: string, userId: string): { statements: UcStatement[]; casesAt: number } {
  return { statements: [grantLockSql(workspaceId, userId), grantedOpenCasesSql(workspaceId, userId), deleteGrantsSql(workspaceId, userId)], casesAt: 1 };
}

/**
 * Prima della riga `osservatore` di chi costruisce da fuori, nella stessa transazione: in fila con «Togli» (lo stesso
 * lock della persona) e solo se una concessione copre ancora il caso, altrimenti niente riga (`concessione_tolta`).
 * Così un «Avvia la realizzazione» che ha letto le concessioni prima di «Togli» non rimette dentro chi è stato tolto.
 */
export function grantGuardStatements(workspaceId: string, userId: string, caseId: string): UcStatement[] {
  return [
    grantLockSql(workspaceId, userId),
    toStatement(
      ucSql`SELECT uc_require(EXISTS (SELECT 1 FROM uc_cases c WHERE c.id = ${cast(caseId, "uuid")} AND ${grantCoversCaseSql(cast(userId, "uuid"))}), 'concessione_tolta') AS ok`,
    ),
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
  return ucSql`EXISTS (SELECT 1 FROM use_case_external_builders xb_c WHERE ${grantCoversSql(ref(caseAlias), ref("xb_c"))} AND xb_c.user_id = ${user})`;
}

/**
 * Vero se la persona `user` ha nel caso `c` un ruolo del cliente: lì firma o approva per il cliente e non costruisce.
 * «Aggiungi» salta quel caso (`ruolo_cliente`), e la concessione lì non toglie niente al cliente.
 */
function clientRoleInCaseSql(user: SqlFragment, caseAlias = "c"): SqlFragment {
  return ucSql`EXISTS (SELECT 1 FROM uc_case_members xb_k WHERE xb_k.case_id = ${ref(caseAlias)}.id AND xb_k.user_id = ${user}
    AND xb_k.role = ANY (${cast([...CLIENT_CASE_ROLES], "text[]")}))`;
}

/**
 * Costruisce il caso per la concessione (anche prima della riga `osservatore`): una concessione che lo copre, e lì nessun
 * ruolo del cliente, come lo salta «Aggiungi». Una persona così non ha ruoli del cliente nel caso (`addCaseMember`,
 * `conflitto_ruoli`); chi lì ha già un ruolo del cliente resta del cliente. Falso senza la 0037.
 */
function grantBuildsCaseSql(user: SqlFragment, caseAlias = "c"): SqlFragment {
  return ucSql`(${grantCoversCaseSql(user, caseAlias)} AND NOT ${clientRoleInCaseSql(user, caseAlias)})`;
}

/**
 * Le concessioni per i tre controlli che un guasto non deve aprire: il firmatario del cliente (`firmatario_costruttore`),
 * il referente (`referente_costruttore`) e il ruolo del cliente nel dossier (`conflitto_ruoli`). Una firma o un ruolo
 * del cliente dati a chi costruisce non si tolgono facilmente; un nuovo tentativo non costa niente.
 * - `pronta`: la 0037 c'è e le concessioni si leggono.
 * - `assente`: la tabella della 0037 non c'è ancora (prima del self-heal): nessuna concessione, nessuno costruisce da
 *   fuori, e il controllo permette come prima.
 * - `illeggibile`: la sonda non risponde, oppure la tabella c'è ma la 0037 non è intera: non si sa chi costruisce, e il
 *   controllo rifiuta con `non_disponibile` («riprova tra poco»). Lo stesso se poi la lettura delle concessioni non riesce.
 */
async function grantsForChecks(executor: UcExecutor): Promise<"pronta" | "assente" | "illeggibile"> {
  const probe = await probeExternalBuilders(executor);
  if (probe === "pronta") return "pronta";
  if (probe === "guasta") return "illeggibile";
  try {
    const [rows] = await executor.batch([toStatement(ucSql`SELECT to_regclass(${cast(`public.${EXTERNAL_BUILDERS_TABLE}`, "text")}) IS NOT NULL AS present`)]);
    return rows[0]?.present === false ? "assente" : "illeggibile";
  } catch {
    return "illeggibile";
  }
}

/**
 * Costruisce il caso per la concessione (`grantBuildsCaseSql`): niente ruoli del cliente lì. Falso senza la tabella della
 * 0037; null quando le concessioni non si leggono (`grantsForChecks`): chi chiama rifiuta.
 */
export async function hasGrantForCase(executor: UcExecutor, i: { caseId: string; userId: string }): Promise<boolean | null> {
  if (!UUID_RE.test(i.caseId) || !UUID_RE.test(i.userId)) return false;
  const state = await grantsForChecks(executor);
  if (state !== "pronta") return state === "assente" ? false : null;
  try {
    const [rows] = await executor.batch([toStatement(ucSql`SELECT ${grantBuildsCaseSql(cast(i.userId, "uuid"))} AS ok FROM uc_cases c WHERE c.id = ${cast(i.caseId, "uuid")}`)]);
    return rows[0]?.ok === true;
  } catch {
    return null;
  }
}

/**
 * Le e-mail (in minuscolo) di chi costruisce il caso per la concessione (`grantBuildsCaseSql`): non firma per il cliente
 * lì (`firmatario_costruttore`) e non fa il referente (`referente_costruttore`). Chi nel caso ha un ruolo del cliente
 * (il caso che «Aggiungi» ha saltato) firma come prima. Vuoto senza la tabella della 0037; null quando le concessioni
 * non si leggono (`grantsForChecks`): i controlli rifiutano.
 */
export async function caseBuilderEmails(executor: UcExecutor, caseId: string): Promise<string[] | null> {
  if (!UUID_RE.test(caseId)) return [];
  const state = await grantsForChecks(executor);
  if (state !== "pronta") return state === "assente" ? [] : null;
  try {
    const [rows] = await executor.batch([
      toStatement(ucSql`SELECT DISTINCT lower(u.email) AS email FROM uc_cases c JOIN use_case_external_builders g ON ${grantCoversSql(ref("c"), ref("g"))}
JOIN users u ON u.id = g.user_id
WHERE c.id = ${cast(caseId, "uuid")} AND u.email IS NOT NULL AND NOT ${clientRoleInCaseSql(raw("u.id"))}`),
    ]);
    return rows.map((r) => String(r.email));
  } catch {
    return null;
  }
}

/**
 * Le e-mail (in minuscolo) di chi costruisce i casi del workspace da fuori: non fa il referente del cliente. Vuoto senza
 * la tabella della 0037; null quando le concessioni non si leggono (`grantsForChecks`): i controlli rifiutano.
 */
export async function workspaceBuilderEmails(executor: UcExecutor, workspaceId: string): Promise<string[] | null> {
  if (!UUID_RE.test(workspaceId)) return [];
  const state = await grantsForChecks(executor);
  if (state !== "pronta") return state === "assente" ? [] : null;
  try {
    const [rows] = await executor.batch([
      toStatement(ucSql`SELECT DISTINCT lower(u.email) AS email FROM use_case_external_builders g JOIN users u ON u.id = g.user_id
WHERE g.workspace_id = ${cast(workspaceId, "uuid")} AND u.email IS NOT NULL`),
    ]);
    return rows.map((r) => String(r.email));
  } catch {
    return null;
  }
}

/** I casi che la persona costruisce o costruiva, per «Togli»: i dossier aperti coperti dalle sue concessioni. */
export function grantedOpenCasesSql(workspaceId: string, userId: string) {
  return toStatement(ucSql`SELECT c.id, coalesce(u.code, c.code) AS code, c.portfolio_use_case_id AS use_case_id FROM uc_cases c LEFT JOIN use_cases u ON u.id = c.portfolio_use_case_id
WHERE c.workspace_id = ${cast(workspaceId, "uuid")} AND c.status <> 'chiuso' AND c.setup_completed_at IS NOT NULL AND ${grantCoversCaseSql(cast(userId, "uuid"))}
ORDER BY coalesce(u.code, c.code)`);
}

/**
 * (8.0d) La concessione di un invito «Solo questo use case», dentro l'istruzione unica dell'accettazione
 * (`acceptWorkspaceInvitation`, src/lib/db/queries/workspace-collaboration.ts): una CTE `granted` che legge le CTE
 * `valid` (l'invito, con `id`, `workspace_id`, `role`, `created_by_user_id`) e `member` (la membership scritta, con
 * `user_id`). Per caso, mai «tutti»: lo use case dell'invito (`use_case_builder_invites`), se è ancora del workspace.
 * Così membership e concessione nascono insieme o per niente, e questo resta l'unico modulo che scrive le concessioni.
 * Testo fisso, senza valori: i valori stanno nelle CTE di chi la usa.
 */
export const CASE_ONLY_INVITE_GRANT_CTE = `granted AS (
      INSERT INTO use_case_external_builders (workspace_id, user_id, use_case_id, added_by_user_id)
      SELECT v.workspace_id, m.user_id, bi.use_case_id, v.created_by_user_id
      FROM valid v
      JOIN use_case_builder_invites bi ON bi.invitation_id = v.id
      JOIN use_cases xb_uc ON xb_uc.id = bi.use_case_id AND xb_uc.workspace_id = v.workspace_id
      JOIN member m ON true
      WHERE v.role::text = 'esterno_caso'
      ON CONFLICT DO NOTHING
      RETURNING id
    )`;

/**
 * (8.0d) Il dossier aperto dello use case di una concessione per caso (mai «tutti»), e chi l'ha data se ne è ancora
 * responsabile (`ls_lead` salvato): l'attore della riga `osservatore` dopo l'accettazione di un invito «Solo questo use
 * case». null senza la concessione per quel caso o senza un dossier aperto; `actorUserId` null se chi ha invitato non è
 * più responsabile (allora la riga la aggiunge il responsabile di adesso).
 */
export async function caseOnlyDossierTarget(
  executor: UcExecutor,
  i: { workspaceId: string; userId: string; useCaseId: string },
): Promise<{ caseId: string; actorUserId: string | null } | null> {
  if (!UUID_RE.test(i.workspaceId) || !UUID_RE.test(i.userId) || !UUID_RE.test(i.useCaseId)) return null;
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT c.id AS case_id,
  (SELECT g.added_by_user_id FROM use_case_external_builders g
    WHERE g.workspace_id = c.workspace_id AND g.user_id = ${cast(i.userId, "uuid")} AND g.use_case_id = c.portfolio_use_case_id
      AND EXISTS (SELECT 1 FROM uc_case_members l WHERE l.case_id = c.id AND l.user_id = g.added_by_user_id AND l.role = 'ls_lead')
    LIMIT 1) AS actor
FROM uc_cases c
WHERE c.workspace_id = ${cast(i.workspaceId, "uuid")} AND c.portfolio_use_case_id = ${cast(i.useCaseId, "uuid")}
  AND c.status <> 'chiuso' AND c.setup_completed_at IS NOT NULL
  AND EXISTS (SELECT 1 FROM use_case_external_builders h WHERE h.workspace_id = c.workspace_id AND h.user_id = ${cast(i.userId, "uuid")}
    AND h.use_case_id = c.portfolio_use_case_id)
ORDER BY c.created_at LIMIT 1`),
  ]);
  if (!rows[0]?.case_id) return null;
  return { caseId: String(rows[0].case_id), actorUserId: rows[0].actor ? String(rows[0].actor) : null };
}

/**
 * (8.0d) Gli use case che la persona costruisce da fuori adesso nel workspace (il predicato, dossier aperti): per la
 * campanella e l'Agent Factory di «Solo questo use case», che vedono solo i loro casi. Vuoto senza la 0037 o senza domini
 * di Lateral Space.
 */
export async function builtUseCaseIds(executor: UcExecutor, i: { workspaceId: string; userId: string; lsDomains: readonly string[] }): Promise<string[]> {
  if (!UUID_RE.test(i.workspaceId) || !UUID_RE.test(i.userId)) return [];
  const scope = await loadBuilderScope(executor, i.lsDomains);
  if (!scope.externalReady) return [];
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT DISTINCT c.portfolio_use_case_id AS use_case_id FROM uc_cases c JOIN users u ON u.id = ${cast(i.userId, "uuid")}
WHERE c.workspace_id = ${cast(i.workspaceId, "uuid")} AND c.portfolio_use_case_id IS NOT NULL AND c.setup_completed_at IS NOT NULL
  AND ${externalBuilderSql(scope)}`),
  ]);
  return rows.map((r) => String(r.use_case_id).toLowerCase());
}

/**
 * (8.0d, D4) Chi dice se uno use case lo costruisce (o lo costruirà) «Solo questo use case»: una concessione per quello use
 * case di una persona che nel workspace è `esterno_caso` (come testo), oppure, con la 0043, un suo invito ancora valido.
 * Un caso così sta in un repository suo: `registerCaseRepo` non lo mette in un repository con altri casi, e non aggiunge
 * altri casi al suo. Senza la 0037 vale `false` per ogni use case.
 */
export async function caseOnlyUseCaseFragment(executor: UcExecutor): Promise<(useCase: SqlFragment) => SqlFragment> {
  if (!(await externalBuildersReady(executor))) return () => raw("false");
  let invites = false;
  try {
    const [rows] = await executor.batch([toStatement(ucSql`SELECT ${raw(CASE_ONLY_PROBE_SQL)} AS ready`)]);
    invites = rows[0]?.ready === true;
  } catch {
    invites = false;
  }
  return (useCase) => ucSql`(EXISTS (SELECT 1 FROM use_case_external_builders xb_co
      JOIN workspace_memberships xb_cow ON xb_cow.workspace_id = xb_co.workspace_id AND xb_cow.user_id = xb_co.user_id AND xb_cow.role::text = 'esterno_caso'
      WHERE xb_co.use_case_id = ${useCase})${
    invites
      ? ucSql`
    OR EXISTS (SELECT 1 FROM use_case_builder_invites xb_bi JOIN workspace_invitations xb_i ON xb_i.id = xb_bi.invitation_id
      WHERE xb_bi.use_case_id = ${useCase} AND xb_i.revoked_at IS NULL AND xb_i.expires_at > now() AND xb_i.used_count < xb_i.max_uses)`
      : raw("")
  })`;
}

/**
 * (8.0d) La persona è «Solo questo use case» nel workspace del caso e ha una concessione **per questo caso** (mai
 * «tutti»): la sola strada perché la sua riga `osservatore` entri nel team del dossier (`addCaseMember`). Falso senza la
 * 0037 o se la lettura non riesce (si chiude, non si apre).
 */
export async function caseOnlyGranteeOfCase(executor: UcExecutor, i: { caseId: string; userId: string }): Promise<boolean> {
  if (!UUID_RE.test(i.caseId) || !UUID_RE.test(i.userId)) return false;
  try {
    if (!(await externalBuildersReady(executor))) return false;
    const user = cast(i.userId, "uuid");
    const [rows] = await executor.batch([
      toStatement(ucSql`SELECT (${caseOnlyMemberSql(raw("c.workspace_id"), user)}
  AND EXISTS (SELECT 1 FROM use_case_external_builders g WHERE g.workspace_id = c.workspace_id AND g.user_id = ${user}
    AND c.portfolio_use_case_id IS NOT NULL AND g.use_case_id = c.portfolio_use_case_id)) AS ok
FROM uc_cases c WHERE c.id = ${cast(i.caseId, "uuid")}`),
    ]);
    return rows[0]?.ok === true;
  } catch {
    return false;
  }
}

/**
 * (8.0d) Il responsabile toglie la riga `osservatore` di «Solo questo use case» dal team del dossier: esce da quel caso
 * (la concessione per il suo use case) e, senza altri casi, anche dal workspace (i token della CLI revocati, la membership
 * `esterno_caso` cancellata). Le istruzioni vanno nella transazione della riga tolta (`removeCaseMember`, `after`): o tutto
 * o niente. Per chi non è `esterno_caso` non fanno niente (la concessione della 8.0c resta, come prima). `cliProvider`: il
 * provider dei token della CLI.
 */
export function caseOnlyLeaveCaseStatements(i: { workspaceId: string; caseId: string; userId: string; cliProvider: string }): UcStatement[] {
  const ws = cast(i.workspaceId, "uuid");
  const user = cast(i.userId, "uuid");
  const isCaseOnly = ucSql`EXISTS (SELECT 1 FROM workspace_memberships xb_lw WHERE xb_lw.workspace_id = ${ws} AND xb_lw.user_id = ${user} AND xb_lw.role::text = 'esterno_caso')`;
  const noGrantLeft = ucSql`NOT EXISTS (SELECT 1 FROM use_case_external_builders xb_lg WHERE xb_lg.workspace_id = ${ws} AND xb_lg.user_id = ${user})`;
  return [
    grantLockSql(i.workspaceId, i.userId),
    toStatement(ucSql`DELETE FROM use_case_external_builders g USING uc_cases c
WHERE c.id = ${cast(i.caseId, "uuid")} AND c.workspace_id = ${ws} AND g.workspace_id = ${ws} AND g.user_id = ${user}
  AND c.portfolio_use_case_id IS NOT NULL AND g.use_case_id = c.portfolio_use_case_id AND ${isCaseOnly}
RETURNING g.id`),
    toStatement(ucSql`UPDATE workspace_integration_tokens SET revoked_at = now(), updated_at = now()
WHERE workspace_id = ${ws} AND owner_user_id = ${user} AND provider = ${cast(i.cliProvider, "text")} AND revoked_at IS NULL AND ${isCaseOnly} AND ${noGrantLeft}
RETURNING id`),
    toStatement(ucSql`DELETE FROM workspace_memberships WHERE workspace_id = ${ws} AND user_id = ${user} AND role::text = 'esterno_caso' AND ${noGrantLeft}
RETURNING id`),
  ];
}

/** (8.0d) Una persona «Solo questo use case» da togliere, o da aggiungere al team di un dossier («Da fare per te»). */
export interface CaseOnlyChore {
  userId: string;
  name: string;
  /** Il codice dello use case (null: lo use case non c'è più, o la persona non ne ha più nessuno). */
  code: string | null;
  caseId: string | null;
  useCaseId: string | null;
}

/**
 * (8.0d) «Da fare per te» su «Solo questo use case» (RILASCIO-8.0d-ESTERNI-FASE-2.md §2.3, §2.4, D10):
 * - `remove`, al manager di Lateral Space: chi lavorava a un caso chiuso («Togli {nome}: XX-0012 è chiuso.»), o non ha più
 *   nessuna concessione (lo use case cancellato): l'accesso non cade da solo;
 * - `add`, al responsabile del dossier (`ls_lead` salvato): chi ha la concessione per il caso ma non ancora la riga
 *   `osservatore` («Aggiungi {nome} al team di XX-0012: lo costruisce da fuori.»).
 * Vuoto senza la 0037. Nessun nome di chi invita; i nomi di chi costruisce, come nel team del caso.
 */
export async function caseOnlyChores(executor: UcExecutor, i: { workspaceId: string; viewerUserId: string; lsManager: boolean }): Promise<{ remove: CaseOnlyChore[]; add: CaseOnlyChore[] }> {
  const out: { remove: CaseOnlyChore[]; add: CaseOnlyChore[] } = { remove: [], add: [] };
  if (!UUID_RE.test(i.workspaceId) || !UUID_RE.test(i.viewerUserId) || !(await externalBuildersReady(executor))) return out;
  const ws = cast(i.workspaceId, "uuid");
  const name = raw("coalesce(nullif(btrim(p.name), ''), split_part(p.email, '@', 1))");
  const caseOnlyPeople = ucSql`SELECT wm.user_id FROM workspace_memberships wm WHERE wm.workspace_id = ${ws} AND wm.role::text = 'esterno_caso'`;
  const [removeRows, addRows] = await executor.batch([
    i.lsManager
      ? toStatement(ucSql`SELECT p.id AS user_id, ${name} AS name, u.code, c.id AS case_id, u.id AS use_case_id
FROM users p
LEFT JOIN use_case_external_builders g ON g.workspace_id = ${ws} AND g.user_id = p.id AND g.use_case_id IS NOT NULL
LEFT JOIN use_cases u ON u.id = g.use_case_id AND u.workspace_id = ${ws}
LEFT JOIN uc_cases c ON c.workspace_id = ${ws} AND c.portfolio_use_case_id = u.id AND c.setup_completed_at IS NOT NULL
WHERE p.id IN (${caseOnlyPeople}) AND (c.status = 'chiuso' OR g.id IS NULL)
ORDER BY ${name}, u.code`)
      : toStatement(ucSql`SELECT NULL::uuid AS user_id WHERE false`),
    toStatement(ucSql`SELECT p.id AS user_id, ${name} AS name, u.code, c.id AS case_id, u.id AS use_case_id
FROM use_case_external_builders g
JOIN users p ON p.id = g.user_id
JOIN use_cases u ON u.id = g.use_case_id AND u.workspace_id = g.workspace_id
JOIN uc_cases c ON c.workspace_id = g.workspace_id AND c.portfolio_use_case_id = u.id AND c.setup_completed_at IS NOT NULL AND c.status <> 'chiuso'
WHERE g.workspace_id = ${ws} AND g.user_id IN (${caseOnlyPeople})
  AND EXISTS (SELECT 1 FROM uc_case_members l WHERE l.case_id = c.id AND l.user_id = ${cast(i.viewerUserId, "uuid")} AND l.role = 'ls_lead')
  AND NOT EXISTS (SELECT 1 FROM uc_case_members o WHERE o.case_id = c.id AND o.user_id = g.user_id)
ORDER BY u.code, ${name}`),
  ]);
  const chore = (r: Record<string, unknown>): CaseOnlyChore => ({
    userId: String(r.user_id),
    name: String(r.name ?? ""),
    code: r.code ? String(r.code) : null,
    caseId: r.case_id ? String(r.case_id) : null,
    useCaseId: r.use_case_id ? String(r.use_case_id) : null,
  });
  out.remove = removeRows.filter((r) => r.user_id).map(chore);
  out.add = addRows.map(chore);
  return out;
}

/** I workspace dove la persona ha una concessione (per «Collega questa CLI»). Vuoto senza la 0037. */
export async function externalGrantWorkspaceIds(executor: UcExecutor, userId: string): Promise<Set<string>> {
  if (!UUID_RE.test(userId) || !(await externalBuildersReady(executor))) return new Set();
  const [rows] = await executor.batch([toStatement(ucSql`SELECT DISTINCT workspace_id FROM use_case_external_builders WHERE user_id = ${cast(userId, "uuid")}`)]);
  return new Set(rows.map((r) => String(r.workspace_id).toLowerCase()));
}

/**
 * Chi costruisce il caso per la concessione (`grantBuildsCaseSql`), per il team del dossier: «Osservatore · costruisce» e
 * niente ruoli del cliente da offrire. Vuoto senza la 0037.
 */
export async function caseGrantUserIds(executor: UcExecutor, caseId: string): Promise<string[]> {
  if (!UUID_RE.test(caseId) || !(await externalBuildersReady(executor))) return [];
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT DISTINCT g.user_id FROM uc_cases c JOIN use_case_external_builders g ON ${grantCoversSql(ref("c"), ref("g"))}
WHERE c.id = ${cast(caseId, "uuid")} AND NOT ${clientRoleInCaseSql(raw("g.user_id"))}`),
  ]);
  return rows.map((r) => String(r.user_id).toLowerCase());
}
