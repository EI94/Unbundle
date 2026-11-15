/**
 * «Chi costruisce» i casi di un cliente (rilascio 8.1b, il team di Lateral Space; 8.0c, docs/rilascio-8/RILASCIO-8.0c-ESTERNI.md
 * §4, anche da fuori Lateral Space).
 *
 * **Il team di Lateral Space** (8.1b): chi costruisce in tutti i casi di un workspace.
 * - **Aggiungere** una persona (per e-mail, con un ruolo: responsabile, analista, sviluppatore): la si ricorda per il
 *   workspace e la si aggiunge al team di ogni dossier aperto, con gli stessi comandi del dossier (`addCaseMember`:
 *   collaboratore del workspace, ruoli `ls_*` solo a Lateral Space, l'evento «membro aggiunto»). Dove ha già un ruolo
 *   di Lateral Space non si aggiunge di nuovo. Già nel team con un altro ruolo: si toglie e si riaggiunge (così il ruolo
 *   nei casi e quello della lista restano uguali).
 * - **Togliere**: esce dai dossier aperti dal ruolo del team (gli altri ruoli, dati caso per caso, restano;
 *   `removeCaseMember`: mai l'ultimo responsabile di un caso), poi non entra più nei casi nuovi. Se si ferma a metà,
 *   la riga resta e si può ripetere. (8.0c) In più i compiti che aveva nei casi dove non costruisce più tornano da prendere.
 * - Chi non è più collaboratore del workspace non compare nel team e non entra nei casi nuovi.
 *
 * **Chi costruisce da fuori** (8.0c, «Sviluppatore esterno»): la concessione sta nella tabella della 0037
 * (`use-case-builders.ts`), «in tutti i casi, anche nei nuovi» oppure «solo in alcuni casi».
 * - **Aggiungere**: prima i controlli sulla persona, in ordine (collaboratore; e-mail verificata e non di Lateral Space;
 *   ruolo da revisore nel workspace), poi la concessione, poi la riga `osservatore` in ogni dossier aperto coperto dal
 *   «Dove» (`addCaseMember`, con chi agisce: dove non è responsabile il caso si salta). Dove la persona ha un ruolo del
 *   cliente non costruisce: il caso si salta. Già presente: cambia il «Dove», entra nei casi nuovi della scelta ed esce
 *   da quelli tolti, dove i suoi compiti tornano da prendere.
 * - **Togliere**: prima i poteri, in una transazione (le concessioni, i token della CLI e dell'MCP del caso nel
 *   workspace, i compiti in corso che tornano da prendere con una nota che non nomina nessuno, «compiti pronti» a chi
 *   costruisce quei casi); poi esce dai dossier aperti coperti (`removeCaseMember`). Se si ferma dopo il primo passo, la
 *   persona già non scrive più.
 * - **Un dossier nuovo** («Avvia la realizzazione»): chi ha una concessione che lo copre entra con `osservatore`
 *   (`applyExternalBuildersToCase`), come il team di Lateral Space (`applyWorkspaceTeamToCase`).
 * - **L'uscita dal workspace** (`leaveWorkspaceFactory`): le concessioni si cancellano, i compiti tornano da prendere,
 *   i token della CLI nel workspace si revocano.
 *
 * I comandi dei casi li fa chi agisce, con i suoi ruoli in quel caso: dove non è responsabile, il caso si salta e si
 * dice quale. Chi può gestire «Chi costruisce» lo controlla chi chiama (il manager di Lateral Space).
 *
 * Modulo senza import dell'app (`@/…`, `server-only`), come `uc-cases.ts`.
 */
import { WORKSPACE_TEAM_PROBE_SQL, WORKSPACE_TEAM_ROLES, type WorkspaceTeamRole } from "../use-case-hub-team-ddl.ts";
import { addCaseMember, loadCaseRoles, loadUserContext, removeCaseMember, type UcCommandContext } from "./uc-cases.ts";
import {
  deleteGrantsStatements,
  externalBuilderSql,
  externalBuildersReady,
  grantedOpenCasesSql,
  grantGuardStatements,
  listExternalGrants,
  loadBuilderScope,
  lsStoredBuilderSql,
  readExternalGrant,
  removeGrantsStatements,
  workspaceUseCaseIds,
  writeGrantStatements,
  type BuilderWhere,
} from "./use-case-builders.ts";
import { notifyTask, tasksTablesReady } from "./use-case-tasks-notices.ts";
import { cast, jsonb, raw, ref, toStatement, ucSql, type SqlFragment, type UcStatement } from "../../uc/sql/statement.ts";
import { fail, ok, type Result } from "../../uc/types.ts";
import { CLIENT_CASE_ROLES, type CaseRole } from "../../uc/vocab.ts";
import { userContextFrom } from "../../uc/lateral-space.ts";
import { CLI_TOKEN_PROVIDER } from "../../use-cases/cli/codes.ts";
import { PORTFOLIO_REVIEWER_ROLES } from "../../workspace-permissions.ts";
import type { UcExecutor } from "../uc-executor.ts";

const LS_ROLES: readonly CaseRole[] = WORKSPACE_TEAM_ROLES;

/** Vero se la 0035 è applicata. */
export async function workspaceTeamReady(executor: UcExecutor): Promise<boolean> {
  try {
    const [rows] = await executor.batch([toStatement(ucSql`SELECT ${raw(WORKSPACE_TEAM_PROBE_SQL)} AS ready`)]);
    return rows[0]?.ready === true;
  } catch {
    return false;
  }
}

export interface WorkspaceTeamMember {
  userId: string;
  name: string;
  email: string;
  role: WorkspaceTeamRole;
}

/** Il team del workspace, per nome. */
export async function listWorkspaceTeam(executor: UcExecutor, workspaceId: string): Promise<WorkspaceTeamMember[]> {
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT t.user_id, t.role, u.email, coalesce(nullif(btrim(u.name), ''), split_part(u.email, '@', 1)) AS name
FROM use_case_workspace_team t JOIN users u ON u.id = t.user_id JOIN workspaces w ON w.id = t.workspace_id
WHERE t.workspace_id = ${cast(workspaceId, "uuid")} AND ${collaboratorOf(raw("t.user_id"))}
ORDER BY lower(coalesce(nullif(btrim(u.name), ''), u.email))`),
  ]);
  return rows.map((r) => ({ userId: String(r.user_id), name: String(r.name), email: String(r.email), role: String(r.role) as WorkspaceTeamRole }));
}

/** Collaboratore del workspace `w` (non solo partecipante ai corsi), come per i membri dei casi. */
const collaboratorOf = (user: SqlFragment) => ucSql`(
  EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = w.organization_id AND m.user_id = ${user} AND m.role::text <> 'learner')
  OR EXISTS (SELECT 1 FROM workspace_memberships wm WHERE wm.workspace_id = w.id AND wm.user_id = ${user} AND wm.role::text <> 'learner'))`;

/** I dossier aperti del workspace (non chiusi, creati per intero), con il codice. */
async function openCases(executor: UcExecutor, workspaceId: string): Promise<{ id: string; code: string }[]> {
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT c.id, coalesce(u.code, c.code) AS code FROM uc_cases c LEFT JOIN use_cases u ON u.id = c.portfolio_use_case_id
WHERE c.workspace_id = ${cast(workspaceId, "uuid")} AND c.status <> 'chiuso' AND c.setup_completed_at IS NOT NULL ORDER BY coalesce(u.code, c.code)`),
  ]);
  return rows.map((r) => ({ id: String(r.id), code: String(r.code) }));
}

/** Il contesto di un comando del caso per chi agisce, con i suoi ruoli in quel caso. */
async function contextFor(executor: UcExecutor, i: { workspaceId: string; caseId: string; actorUserId: string; lsDomains: readonly string[] }): Promise<UcCommandContext | null> {
  const user = await loadUserContext(executor, i.actorUserId, i.lsDomains);
  if (!user) return null;
  const roles = await loadCaseRoles(executor, i.caseId, user, i.lsDomains);
  return { workspaceId: i.workspaceId, caseId: i.caseId, actor: { type: "utente", userId: i.actorUserId, roles: roles.effective }, user, lsDomains: i.lsDomains };
}

export interface TeamApplyResult {
  /** I casi dove la persona è entrata (o uscita). */
  done: string[];
  /** I casi dove c'era già (o non c'era). */
  unchanged: string[];
  /** I casi saltati: chi agisce non ne è responsabile, o è l'ultimo responsabile. Codice del caso e motivo. */
  skipped: { code: string; reason: string }[];
}

const ROLE_RE = new Set<string>(WORKSPACE_TEAM_ROLES);

/**
 * Aggiunge al team del workspace una persona di Lateral Space e la mette nel team di ogni dossier aperto. La persona si
 * sceglie dall'elenco dei collaboratori (`userId`, 8.0c); con `email`, come prima, per e-mail.
 */
export async function addWorkspaceTeamMember(
  executor: UcExecutor,
  i: { workspaceId: string; actorUserId: string; email?: unknown; userId?: unknown; role: unknown; lsDomains: readonly string[] },
): Promise<Result<TeamApplyResult & { userId: string; role: WorkspaceTeamRole }>> {
  const byId = typeof i.userId === "string" && /^[0-9a-f-]{36}$/i.test(i.userId) ? i.userId.toLowerCase() : null;
  const email = typeof i.email === "string" ? i.email.trim().toLowerCase() : "";
  if (!byId && !/^[^\s@]{1,64}@[^\s@]{1,255}$/.test(email)) return fail("dati_non_validi", "Scegli la persona.");
  if (typeof i.role !== "string" || !ROLE_RE.has(i.role)) return fail("dati_non_validi", "Scegli il ruolo: responsabile, analista o sviluppatore.");
  const role = i.role as WorkspaceTeamRole;
  if (!(await workspaceTeamReady(executor))) return fail("non_disponibile", "Non ancora disponibile: riprova tra qualche minuto.");
  // Per e-mail: prima quella scritta così, poi quella verificata (due account possono differire solo per le maiuscole).
  const [people] = await executor.batch([
    byId
      ? toStatement(ucSql`SELECT u.id FROM users u JOIN workspaces w ON w.id = ${cast(i.workspaceId, "uuid")} WHERE u.id = ${cast(byId, "uuid")} AND ${collaboratorOf(raw("u.id"))}`)
      : toStatement(ucSql`SELECT u.id FROM users u JOIN workspaces w ON w.id = ${cast(i.workspaceId, "uuid")}
WHERE lower(u.email) = ${cast(email, "text")} AND ${collaboratorOf(raw("u.id"))}
ORDER BY (u.email = ${cast(email, "text")}) DESC, (u.email_verified IS NOT NULL) DESC, u.id
LIMIT 1`),
  ]);
  if (!people[0]) return fail("non_collaboratore", "Questa persona non è un collaboratore del workspace: invitala prima nel workspace, poi aggiungila qui.");
  const userId = String(people[0].id);
  const person = await loadUserContext(executor, userId, i.lsDomains);
  if (!person?.isLateralSpace) {
    // (8.0c) Chi viene da fuori costruisce come «Sviluppatore esterno»; un dominio di Lateral Space senza verifica, dopo.
    if (person && !person.emailVerified) return fail("email_non_verificata", "Prima deve confermare la sua e-mail in Unbundle.");
    return fail("ruolo_non_ammesso", "Analista e Responsabile sono ruoli di Lateral Space: per chi viene da fuori c'è Sviluppatore esterno.");
  }
  const [current] = await executor.batch([
    toStatement(ucSql`SELECT role FROM use_case_workspace_team WHERE workspace_id = ${cast(i.workspaceId, "uuid")} AND user_id = ${cast(userId, "uuid")}`),
  ]);
  if (current[0] && String(current[0].role) !== role) {
    return fail("ruolo_diverso", "È già nel team con un altro ruolo: per cambiarlo, toglila e aggiungila di nuovo con il ruolo nuovo.");
  }
  await executor.batch([
    toStatement(ucSql`INSERT INTO use_case_workspace_team (workspace_id, user_id, role) VALUES (${cast(i.workspaceId, "uuid")}, ${cast(userId, "uuid")}, ${cast(role, "text")})
ON CONFLICT (workspace_id, user_id) DO NOTHING`),
  ]);
  const out: TeamApplyResult = { done: [], unchanged: [], skipped: [] };
  for (const c of await openCases(executor, i.workspaceId)) {
    const applied = await addToCase(executor, { workspaceId: i.workspaceId, caseId: c.id, actorUserId: i.actorUserId, userId, role, lsDomains: i.lsDomains });
    if (applied === "aggiunto") out.done.push(c.code);
    else if (applied === "gia_dentro") out.unchanged.push(c.code);
    else out.skipped.push({ code: c.code, reason: applied });
  }
  return ok({ ...out, userId, role });
}

/** Una persona nel team di un caso, con i comandi del dossier; mai un secondo ruolo di Lateral Space. */
async function addToCase(
  executor: UcExecutor,
  i: { workspaceId: string; caseId: string; actorUserId: string; userId: string; role: WorkspaceTeamRole; lsDomains: readonly string[] },
): Promise<"aggiunto" | "gia_dentro" | string> {
  const target = await loadUserContext(executor, i.userId, i.lsDomains);
  if (!target) return "utente_non_trovato";
  const already = await loadCaseRoles(executor, i.caseId, target, i.lsDomains);
  if (already.stored.some((r) => LS_ROLES.includes(r))) return "gia_dentro";
  const ctx = await contextFor(executor, i);
  if (!ctx) return "utente_non_trovato";
  const added = await addCaseMember(executor, ctx, { userId: i.userId, role: i.role });
  if (added.ok) return "aggiunto";
  return added.code === "gia_membro" ? "gia_dentro" : added.code;
}

/** Toglie una persona dal team del workspace e dai dossier aperti, da ogni ruolo di Lateral Space che ha lì. */
export async function removeWorkspaceTeamMember(
  executor: UcExecutor,
  i: { workspaceId: string; actorUserId: string; userId: unknown; lsDomains: readonly string[] },
): Promise<Result<TeamApplyResult & { released: number }>> {
  if (typeof i.userId !== "string" || !/^[0-9a-f-]{36}$/i.test(i.userId)) return fail("dati_non_validi", "Persona non valida.");
  const userId = i.userId;
  if (!(await workspaceTeamReady(executor))) return fail("non_disponibile", "Non ancora disponibile: riprova tra qualche minuto.");
  const ws = cast(i.workspaceId, "uuid");
  const [rows] = await executor.batch([toStatement(ucSql`SELECT role FROM use_case_workspace_team WHERE workspace_id = ${ws} AND user_id = ${cast(userId, "uuid")}`)]);
  if (!rows[0]) return fail("non_trovato", "Questa persona non è nel team del workspace.");
  const role = String(rows[0].role) as WorkspaceTeamRole;
  const target = await loadUserContext(executor, userId, i.lsDomains);
  const out: TeamApplyResult = { done: [], unchanged: [], skipped: [] };
  // Prima i casi, poi la riga: se qualcosa si ferma a metà, la persona resta nella lista e «Togli» si può ripetere.
  for (const c of await openCases(executor, i.workspaceId)) {
    const has = target ? (await loadCaseRoles(executor, c.id, target, i.lsDomains)).stored.includes(role) : false;
    if (!has) {
      out.unchanged.push(c.code);
      continue;
    }
    const ctx = await contextFor(executor, { workspaceId: i.workspaceId, caseId: c.id, actorUserId: i.actorUserId, lsDomains: i.lsDomains });
    const removed = ctx ? await removeCaseMember(executor, ctx, { userId, role }) : fail("utente_non_trovato", "");
    if (removed.ok) out.done.push(c.code);
    else out.skipped.push({ code: c.code, reason: removed.code });
  }
  await executor.batch([toStatement(ucSql`DELETE FROM use_case_workspace_team WHERE workspace_id = ${ws} AND user_id = ${cast(userId, "uuid")}`)]);
  // (8.0c) I compiti che aveva nei casi dove non costruisce più tornano da prendere.
  const released = await releaseTasksOfFormerBuilder(executor, { workspaceId: i.workspaceId, userId, lsDomains: i.lsDomains });
  return ok({ ...out, released: released.released });
}

/**
 * Toglie chi lascia il workspace dal suo team di Lateral Space: se torna, non rientra da solo nei casi nuovi. I ruoli
 * nei casi li toglie già la rimozione dal workspace (`removeUserFromWorkspaceCases`).
 */
export async function forgetWorkspaceTeamMember(executor: UcExecutor, i: { workspaceId: string; userId: string }): Promise<void> {
  if (!(await workspaceTeamReady(executor))) return;
  await executor.batch([
    toStatement(ucSql`DELETE FROM use_case_workspace_team WHERE workspace_id = ${cast(i.workspaceId, "uuid")} AND user_id = ${cast(i.userId, "uuid")}`),
  ]);
}

/** Un dossier nuovo: chi è nel team del workspace entra nel suo team (lo aggiunge chi l'ha aperto, che ne è responsabile). */
export async function applyWorkspaceTeamToCase(
  executor: UcExecutor,
  i: { workspaceId: string; caseId: string; actorUserId: string; lsDomains: readonly string[] },
): Promise<TeamApplyResult> {
  const out: TeamApplyResult = { done: [], unchanged: [], skipped: [] };
  if (!(await workspaceTeamReady(executor))) return out;
  for (const m of await listWorkspaceTeam(executor, i.workspaceId)) {
    if (m.userId === i.actorUserId) {
      out.unchanged.push(m.userId);
      continue;
    }
    const applied = await addToCase(executor, { ...i, userId: m.userId, role: m.role });
    if (applied === "aggiunto") out.done.push(m.userId);
    else if (applied === "gia_dentro") out.unchanged.push(m.userId);
    else out.skipped.push({ code: m.userId, reason: applied });
  }
  return out;
}

// ─── Chi costruisce da fuori Lateral Space (8.0c) ────────────────────

/** I motivi per cui una persona non può costruire da fuori: i codici delle azioni e della pagina. */
export type ExternalRefusal = "non_collaboratore" | "email_non_verificata" | "di_lateral_space" | "ruolo_workspace";

interface PersonFacts {
  userId: string;
  name: string;
  email: string;
  /** Il ruolo nel workspace, come `getWorkspaceAccessForUser`: prima l'organizzazione, poi il workspace. */
  role: string | null;
  verified: boolean;
  lateralSpace: boolean;
}

/** Il ruolo nel workspace `w` di `u`, prima nell'organizzazione poi nel workspace. */
const roleSql = ucSql`coalesce(
  (SELECT m.role::text FROM memberships m WHERE m.organization_id = w.organization_id AND m.user_id = u.id LIMIT 1),
  (SELECT wm.role::text FROM workspace_memberships wm WHERE wm.workspace_id = w.id AND wm.user_id = u.id LIMIT 1))`;

async function personFacts(executor: UcExecutor, workspaceId: string, userIds: readonly string[], lsDomains: readonly string[]): Promise<Map<string, PersonFacts>> {
  const out = new Map<string, PersonFacts>();
  if (!userIds.length) return out;
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT u.id, u.email, u.email_verified, coalesce(nullif(btrim(u.name), ''), split_part(u.email, '@', 1)) AS name, ${roleSql} AS role
FROM users u JOIN workspaces w ON w.id = ${cast(workspaceId, "uuid")} WHERE u.id = ANY (${cast([...userIds], "uuid[]")})`),
  ]);
  for (const r of rows) {
    const user = userContextFrom({ id: String(r.id), email: r.email === null ? null : String(r.email), emailVerified: (r.email_verified as Date | string | null) ?? null }, lsDomains);
    out.set(String(r.id), {
      userId: String(r.id),
      name: String(r.name ?? ""),
      email: String(r.email ?? ""),
      role: r.role === null || r.role === undefined ? null : String(r.role),
      verified: user.emailVerified,
      lateralSpace: user.isLateralSpace || (user.emailDomain !== null && lsDomains.includes(user.emailDomain)),
    });
  }
  return out;
}

/** Perché la persona non può costruire da fuori, nell'ordine dei controlli; null se può. */
function externalRefusal(p: PersonFacts | undefined): ExternalRefusal | null {
  if (!p || p.role === null || p.role === "learner") return "non_collaboratore";
  if (!p.verified) return "email_non_verificata";
  if (p.lateralSpace) return "di_lateral_space";
  if (!(PORTFOLIO_REVIEWER_ROLES as readonly string[]).includes(p.role)) return "ruolo_workspace";
  return null;
}

/**
 * (8.0c) Per l'elenco di «Persona» in «Chi costruisce»: chi tra le persone da fuori oggi «Aggiungi» rifiuterebbe, e
 * perché, con gli stessi controlli (`externalRefusal`). Così non si offre una scelta per poi rifiutarla.
 */
export async function externalRefusals(executor: UcExecutor, workspaceId: string, userIds: readonly string[], lsDomains: readonly string[]): Promise<Map<string, ExternalRefusal>> {
  const facts = await personFacts(executor, workspaceId, userIds, lsDomains);
  const out = new Map<string, ExternalRefusal>();
  for (const userId of userIds) {
    const refusal = externalRefusal(facts.get(userId));
    if (refusal) out.set(userId, refusal);
  }
  return out;
}

const EXTERNAL_REFUSAL_MESSAGE: Readonly<Record<ExternalRefusal, string>> = {
  non_collaboratore: "Questa persona non fa parte del workspace: invitala prima, da Impostazioni › Persone, come Analista.",
  email_non_verificata: "Prima deve confermare la sua e-mail in Unbundle.",
  di_lateral_space: "È una persona di Lateral Space: scegli Sviluppatore, Analista o Responsabile.",
  ruolo_workspace: "Per costruire serve almeno il ruolo di Analista nel workspace: cambialo da Impostazioni › Persone.",
};

/** Il «Dove» da un modulo: `"tutti"`, oppure gli use case scelti. */
function parseWhere(where: unknown): { all: true } | { all: false; ids: string[] } | null {
  if (where === "tutti") return { all: true };
  if (!Array.isArray(where) || where.length === 0 || where.length > 500) return null;
  const ids = [...new Set(where.filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)).map((id) => id.toLowerCase()))];
  return ids.length === where.length ? { all: false, ids } : null;
}

interface OpenCase {
  id: string;
  code: string;
  useCaseId: string | null;
}

async function grantedOpenCases(executor: UcExecutor, workspaceId: string, userId: string): Promise<OpenCase[]> {
  const [rows] = await executor.batch([grantedOpenCasesSql(workspaceId, userId)]);
  return rows.map((r) => ({ id: String(r.id), code: String(r.code), useCaseId: r.use_case_id ? String(r.use_case_id) : null }));
}

/**
 * I dossier aperti coperti dalle concessioni dove la persona ha davvero la riga `osservatore`: quelli dove costruisce, o
 * da cui «Togli» la fa uscire. Una concessione «tutti» con ogni caso saltato ne conta zero.
 */
async function observedOpenCases(executor: UcExecutor, workspaceId: string, userId: string): Promise<number> {
  const cases = await grantedOpenCases(executor, workspaceId, userId);
  if (!cases.length) return 0;
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT count(DISTINCT case_id)::int AS n FROM uc_case_members
WHERE user_id = ${cast(userId, "uuid")} AND role = 'osservatore' AND case_id = ANY (${cast(cases.map((c) => c.id), "uuid[]")})`),
  ]);
  return Number(rows[0]?.n ?? 0);
}

/** I repository registrati per i casi del «Dove» (per dirle a chi aggiunge e a chi toglie: su GitHub si fa a mano). */
async function reposOf(executor: UcExecutor, workspaceId: string, where: BuilderWhere): Promise<string[]> {
  const scope = where.all ? raw("true") : ucSql`r.use_case_id = ANY (${cast(where.useCaseIds, "uuid[]")})`;
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT DISTINCT r.repo FROM use_case_repos r WHERE r.workspace_id = ${cast(workspaceId, "uuid")} AND ${scope} ORDER BY r.repo`),
  ]);
  return rows.map((r) => String(r.repo));
}

export interface ExternalApplyResult {
  userId: string;
  where: BuilderWhere;
  /** I casi dove è entrata adesso. */
  entered: string[];
  /** I casi dove c'era già. */
  already: string[];
  /** I casi da cui esce (il «Dove» è cambiato). */
  left: string[];
  /** I casi saltati: codice e motivo (`ruolo_cliente`, `attore_non_ammesso`, …). */
  skipped: { code: string; reason: string }[];
  /** I dossier aperti dove adesso ha la riga `osservatore` (entrata adesso o c'era già). */
  openCases: number;
  /** I repository dei suoi casi, a cui darle la scrittura su GitHub. */
  repos: string[];
  /** I compiti tornati da prendere (nei casi tolti dal «Dove»). */
  released: number;
  /** L'e-mail «Costruisci i casi d'uso di…» in coda (solo per chi entra adesso, non per un «Dove» che cambia). */
  noticeId: string | null;
}

/**
 * (8.0c) L'e-mail alla persona che entra tra chi costruisce o ne esce, in coda (`uc_notifications`, senza caso): una per
 * aggiunta o per uscita. La manda il motore dei dossier solo con l'ok ai sub-responsabili del cliente (`dispatch.ts`).
 */
function teamNoticeStatement(i: { workspaceId: string; userId: string; template: "team_aggiunto" | "team_tolto"; payload: Record<string, unknown> }): UcStatement {
  const template = cast(i.template, "text");
  return toStatement(ucSql`INSERT INTO uc_notifications (workspace_id, recipient_user_id, channel, template_key, payload, status, dedupe_key, scheduled_at)
VALUES (${cast(i.workspaceId, "uuid")}, ${cast(i.userId, "uuid")}, 'email', ${template}, ${jsonb(i.payload)}, 'in_coda',
  ${template} || ':' || ${cast(i.workspaceId, "text")} || ':' || ${cast(i.userId, "text")} || ':' || gen_random_uuid()::text, now())
RETURNING id`);
}

/**
 * «Aggiungi» a chi costruisce una persona che non è di Lateral Space, «Sviluppatore esterno», con il «Dove»
 * (`"tutti"` o gli use case). Già presente: cambia il «Dove».
 */
export async function addExternalBuilder(
  executor: UcExecutor,
  i: { workspaceId: string; actorUserId: string; userId: unknown; where: unknown; lsDomains: readonly string[] },
): Promise<Result<ExternalApplyResult>> {
  if (typeof i.userId !== "string" || !/^[0-9a-f-]{36}$/i.test(i.userId)) return fail("dati_non_validi", "Scegli la persona.");
  const userId = i.userId.toLowerCase();
  const asked = parseWhere(i.where);
  if (!asked) return fail("dati_non_validi", "Scegli dove costruisce: in tutti i casi, oppure almeno un caso.");
  if (!(await externalBuildersReady(executor))) return fail("non_disponibile", "Non ancora disponibile: riprova tra qualche minuto.");
  const refusal = externalRefusal((await personFacts(executor, i.workspaceId, [userId], i.lsDomains)).get(userId));
  if (refusal) return fail(refusal, EXTERNAL_REFUSAL_MESSAGE[refusal]);
  let where: BuilderWhere = { all: true };
  if (!asked.all) {
    const ids = await workspaceUseCaseIds(executor, i.workspaceId, asked.ids);
    if (ids.length !== asked.ids.length) return fail("dati_non_validi", "Uno dei casi scelti non è di questo cliente: ricarica la pagina.");
    where = { all: false, useCaseIds: ids };
  }
  const before = await grantedOpenCases(executor, i.workspaceId, userId);
  const isNew = (await readExternalGrant(executor, i.workspaceId, userId)) === null;
  const written = await executor.batch([
    ...writeGrantStatements({ workspaceId: i.workspaceId, userId, where, actorUserId: i.actorUserId }),
    // L'e-mail di benvenuto, solo a chi entra adesso: un «Dove» che cambia non la rimanda.
    ...(isNew
      ? [teamNoticeStatement({ workspaceId: i.workspaceId, userId, template: "team_aggiunto", payload: { tutti: where.all, casi: where.all ? null : where.useCaseIds.length, queuedAt: new Date().toISOString() } })]
      : []),
  ]);
  const noticeId = isNew ? (written[written.length - 1]?.[0]?.id ? String(written[written.length - 1][0].id) : null) : null;
  const after = await grantedOpenCases(executor, i.workspaceId, userId);
  // Dai casi tolti dal «Dove» esce, e i suoi compiti lì tornano da prendere.
  const released = await releaseTasksOfFormerBuilder(executor, { workspaceId: i.workspaceId, userId, lsDomains: i.lsDomains });
  const out: ExternalApplyResult = {
    userId,
    where,
    entered: [],
    already: [],
    left: [],
    skipped: [],
    openCases: 0,
    repos: await reposOf(executor, i.workspaceId, where),
    released: released.released,
    noticeId,
  };
  const target = await loadUserContext(executor, userId, i.lsDomains);
  for (const c of after) {
    const applied = target ? await observeCase(executor, { workspaceId: i.workspaceId, caseId: c.id, actorUserId: i.actorUserId, userId, lsDomains: i.lsDomains }) : "utente_non_trovato";
    if (applied === "aggiunto") out.entered.push(c.code);
    else if (applied === "gia_dentro") out.already.push(c.code);
    else out.skipped.push({ code: c.code, reason: applied });
  }
  out.openCases = out.entered.length + out.already.length;
  const kept = new Set(after.map((c) => c.id));
  for (const c of before.filter((c) => !kept.has(c.id))) {
    const left = await leaveCase(executor, { workspaceId: i.workspaceId, caseId: c.id, actorUserId: i.actorUserId, userId, lsDomains: i.lsDomains });
    if (left === "tolto") out.left.push(c.code);
    else if (left !== "non_c_era") out.skipped.push({ code: c.code, reason: left });
  }
  return ok(out);
}

/**
 * La riga `osservatore` nel caso, con i comandi del dossier; mai dove la persona ha un ruolo del cliente. La riga entra in
 * fila con «Togli» (lo stesso lock della persona) e solo se una concessione copre ancora il caso (`concessione_tolta`).
 */
async function observeCase(
  executor: UcExecutor,
  i: { workspaceId: string; caseId: string; actorUserId: string; userId: string; lsDomains: readonly string[] },
): Promise<"aggiunto" | "gia_dentro" | string> {
  const target = await loadUserContext(executor, i.userId, i.lsDomains);
  if (!target) return "utente_non_trovato";
  const roles = await loadCaseRoles(executor, i.caseId, target, i.lsDomains);
  if (roles.stored.some((r) => (CLIENT_CASE_ROLES as readonly string[]).includes(r))) return "ruolo_cliente";
  if (roles.stored.includes("osservatore")) return "gia_dentro";
  const ctx = await contextFor(executor, i);
  if (!ctx) return "utente_non_trovato";
  const added = await addCaseMember(executor, ctx, { userId: i.userId, role: "osservatore" }, { guard: grantGuardStatements(i.workspaceId, i.userId, i.caseId) });
  if (added.ok) return "aggiunto";
  return added.code === "gia_membro" ? "gia_dentro" : added.code;
}

/** Toglie la riga `osservatore` dal caso, con i comandi del dossier (dove chi agisce non è responsabile, resta). */
async function leaveCase(executor: UcExecutor, i: { workspaceId: string; caseId: string; actorUserId: string; userId: string; lsDomains: readonly string[] }): Promise<"tolto" | "non_c_era" | string> {
  const target = await loadUserContext(executor, i.userId, i.lsDomains);
  if (!target || !(await loadCaseRoles(executor, i.caseId, target, i.lsDomains)).stored.includes("osservatore")) return "non_c_era";
  const ctx = await contextFor(executor, i);
  const removed = ctx ? await removeCaseMember(executor, ctx, { userId: i.userId, role: "osservatore" }) : fail("utente_non_trovato", "");
  return removed.ok ? "tolto" : removed.code;
}

export interface ExternalRemoveResult {
  /** I casi da cui esce. */
  left: string[];
  /** I casi dove la sua riga `osservatore` resta, senza poteri: chi agisce lì non è responsabile. */
  skipped: { code: string; reason: string }[];
  /** I repository dei suoi casi: su GitHub l'accesso si toglie a mano. */
  repos: string[];
  /** I compiti tornati da prendere. */
  released: number;
  /** I token della CLI e dell'MCP del caso revocati nel workspace. */
  revokedTokens: number;
  /** L'e-mail «Non costruisci più…» in coda. */
  noticeId: string | null;
}

/** La revoca dei token della CLI della persona nel workspace (quelli di tutti i casi e quelli di un caso solo). */
export function revokeCliTokensStatement(workspaceId: string, userId: string): UcStatement {
  return toStatement(ucSql`UPDATE workspace_integration_tokens SET revoked_at = now(), updated_at = now()
WHERE workspace_id = ${cast(workspaceId, "uuid")} AND owner_user_id = ${cast(userId, "uuid")} AND provider = ${cast(CLI_TOKEN_PROVIDER, "text")} AND revoked_at IS NULL
RETURNING id`);
}

/**
 * «Togli» chi costruisce da fuori. Prima i poteri, in una transazione: le concessioni, i token della CLI e dell'MCP del
 * caso nel workspace, i compiti che tornano da prendere. Poi esce dai dossier aperti che costruiva.
 */
export async function removeExternalBuilder(
  executor: UcExecutor,
  i: { workspaceId: string; actorUserId: string; userId: unknown; lsDomains: readonly string[] },
): Promise<Result<ExternalRemoveResult>> {
  if (typeof i.userId !== "string" || !/^[0-9a-f-]{36}$/i.test(i.userId)) return fail("dati_non_validi", "Persona non valida.");
  const userId = i.userId.toLowerCase();
  if (!(await externalBuildersReady(executor))) return fail("non_disponibile", "Non ancora disponibile: riprova tra qualche minuto.");
  const grant = await readExternalGrant(executor, i.workspaceId, userId);
  if (!grant) return fail("non_trovato", "Questa persona non è tra chi costruisce.");
  const repos = await reposOf(executor, i.workspaceId, grant);
  const revoke = revokeCliTokensStatement(i.workspaceId, userId);
  // I casi si leggono dopo il lock della persona, nella transazione che toglie le concessioni: c'è anche il dossier dove
  // la riga `osservatore` è entrata un attimo prima, e dopo non ne entra più nessuna (`observeCase`).
  const removal = removeGrantsStatements(i.workspaceId, userId);
  const first = [...removal.statements, revoke];
  const released = await releaseTasksOfFormerBuilder(executor, { workspaceId: i.workspaceId, userId, lsDomains: i.lsDomains, first });
  const cases = (released.firstRows[removal.casesAt] ?? []).map((r) => ({ id: String(r.id), code: String(r.code) }));
  const out: ExternalRemoveResult = { left: [], skipped: [], repos, released: released.released, revokedTokens: released.firstRows[first.length - 1]?.length ?? 0, noticeId: null };
  for (const c of cases) {
    const left = await leaveCase(executor, { workspaceId: i.workspaceId, caseId: c.id, actorUserId: i.actorUserId, userId, lsDomains: i.lsDomains });
    if (left === "tolto") out.left.push(c.code);
    else if (left !== "non_c_era") out.skipped.push({ code: c.code, reason: left });
  }
  // L'e-mail «Non costruisci più…», dopo i poteri e i casi: se non parte, la persona comunque non costruisce più.
  const [notice] = await executor.batch([teamNoticeStatement({ workspaceId: i.workspaceId, userId, template: "team_tolto", payload: { queuedAt: new Date().toISOString() } })]);
  out.noticeId = notice[0]?.id ? String(notice[0].id) : null;
  return ok(out);
}

/**
 * Un dossier nuovo: chi ha una concessione che lo copre entra con `osservatore` (lo aggiunge chi l'ha aperto, che ne è
 * responsabile), se oggi può costruire. Come `applyWorkspaceTeamToCase`.
 */
export async function applyExternalBuildersToCase(
  executor: UcExecutor,
  i: { workspaceId: string; caseId: string; actorUserId: string; lsDomains: readonly string[] },
): Promise<TeamApplyResult> {
  const out: TeamApplyResult = { done: [], unchanged: [], skipped: [] };
  if (!(await externalBuildersReady(executor))) return out;
  const [caseRows] = await executor.batch([toStatement(ucSql`SELECT portfolio_use_case_id FROM uc_cases WHERE id = ${cast(i.caseId, "uuid")} AND workspace_id = ${cast(i.workspaceId, "uuid")}`)]);
  const useCaseId = caseRows[0]?.portfolio_use_case_id ? String(caseRows[0].portfolio_use_case_id) : null;
  const grants = await listExternalGrants(executor, i.workspaceId);
  // Un dossier senza use case non è un caso della fabbrica: nemmeno «tutti» lo copre.
  if (useCaseId === null) return out;
  const covered = [...grants.entries()].filter(([, where]) => where.all || where.useCaseIds.includes(useCaseId)).map(([userId]) => userId);
  const facts = await personFacts(executor, i.workspaceId, covered, i.lsDomains);
  for (const userId of covered) {
    if (externalRefusal(facts.get(userId))) {
      out.unchanged.push(userId);
      continue;
    }
    const applied = await observeCase(executor, { ...i, userId });
    if (applied === "aggiunto") out.done.push(userId);
    else if (applied === "gia_dentro") out.unchanged.push(userId);
    else out.skipped.push({ code: userId, reason: applied });
  }
  return out;
}

// ─── I compiti di chi non costruisce più ─────────────────────────────

/** La nota sui compiti che tornano da prendere: non nomina nessuno. */
export const RELEASED_TASK_NOTE = "Torna da prendere: chi lo aveva non costruisce più questo caso.";

/**
 * I compiti che la persona ha nel workspace (in corso o in revisione) nei casi dove non costruisce più tornano da
 * prendere, come con «lascia»: in corso → da fare; in revisione resta in revisione, senza persona. Una nota per compito,
 * senza nomi; «compiti pronti» a chi costruisce quei casi. `first`: istruzioni da fare prima, nella stessa transazione
 * (togliere le concessioni, revocare i token): così la persona non scrive più e i suoi compiti si liberano insieme.
 * `caseId`: solo i compiti di quel dossier (la riga tolta nel team del dossier).
 */
export async function releaseTasksOfFormerBuilder(
  executor: UcExecutor,
  i: { workspaceId: string; userId: string; lsDomains: readonly string[]; first?: readonly UcStatement[]; caseId?: string; now?: Date },
): Promise<{ released: number; firstRows: Record<string, unknown>[][] }> {
  const first = [...(i.first ?? [])];
  const release = await taskReleaseStatements(executor, i);
  if (!release) {
    const rows = first.length ? await executor.batch(first) : [];
    return { released: 0, firstRows: rows };
  }
  const rows = await executor.batch([...first, ...release]);
  return { released: rows[first.length]?.length ?? 0, firstRows: rows.slice(0, first.length) };
}

/**
 * Le istruzioni che liberano i compiti (`releaseTasksOfFormerBuilder`), con le letture che servono prima: la prima libera
 * i compiti e scrive le note (restituisce i compiti liberati), le altre mandano «compiti pronti». Si mettono in una
 * transazione dopo quello che fa smettere di costruire (concessioni tolte, riga tolta): «costruisce ancora» si legge lì
 * dentro. null senza le tabelle dei compiti.
 */
async function taskReleaseStatements(
  executor: UcExecutor,
  i: { workspaceId: string; userId: string; lsDomains: readonly string[]; caseId?: string; now?: Date },
): Promise<UcStatement[] | null> {
  if (!(await tasksTablesReady(executor))) return null;
  const ws = cast(i.workspaceId, "uuid");
  const user = cast(i.userId, "uuid");
  const scope = await loadBuilderScope(executor, i.lsDomains);
  const caseId = i.caseId;
  const ofCase = (column: string) =>
    caseId === undefined ? raw("true") : ucSql`${ref(column)} = (SELECT d.portfolio_use_case_id FROM uc_cases d WHERE d.id = ${cast(caseId, "uuid")} AND d.workspace_id = ${ws})`;
  const [held] = await executor.batch([
    toStatement(
      ucSql`SELECT DISTINCT use_case_id FROM use_case_tasks WHERE workspace_id = ${ws} AND holder_user_id = ${user} AND status IN ('in_corso', 'in_revisione') AND ${ofCase("use_case_id")}`,
    ),
  ]);
  // Costruisce ancora il caso del compito (dopo le istruzioni di `first`): un ruolo di Lateral Space, o da fuori.
  const stillBuilds = ucSql`EXISTS (SELECT 1 FROM uc_cases c JOIN users u ON u.id = ${user}
  WHERE c.portfolio_use_case_id = t.use_case_id AND c.workspace_id = t.workspace_id AND (${lsStoredBuilderSql(raw("u.id"))} OR ${externalBuilderSql(scope)}))`;
  const note = cast(RELEASED_TASK_NOTE, "text");
  const release = toStatement(ucSql`WITH done AS (
  UPDATE use_case_tasks t SET status = CASE WHEN t.status = 'in_revisione' THEN 'in_revisione' ELSE 'da_fare' END, holder_user_id = NULL,
    taken_at = CASE WHEN t.status = 'in_revisione' THEN t.taken_at END, stale_asked_at = NULL, stale_escalated_at = NULL, updated_at = now()
  WHERE t.workspace_id = ${ws} AND t.holder_user_id = ${user} AND t.status IN ('in_corso', 'in_revisione') AND ${ofCase("t.use_case_id")} AND NOT ${stillBuilds}
  RETURNING t.id, t.use_case_id
)
INSERT INTO use_case_task_notes (task_id, use_case_id, workspace_id, kind, body)
SELECT done.id, done.use_case_id, ${ws}, 'passaggio', ${note} FROM done
RETURNING task_id`);
  // «Ci sono compiti da prendere» a chi costruisce ognuno di quei casi, solo se un suo compito è tornato adesso.
  const now = i.now ?? new Date();
  const notices = held.flatMap((r) => {
    const uc = cast(String(r.use_case_id), "uuid");
    const releasedNow = ucSql`EXISTS (SELECT 1 FROM use_case_task_notes n WHERE n.workspace_id = ${ws} AND n.use_case_id = ${uc} AND n.kind = 'passaggio' AND n.body = ${note} AND n.created_at = now())`;
    return notifyTask({ workspaceId: i.workspaceId, useCaseId: String(r.use_case_id) }, "compiti_pronti", { builders: scope }, i.userId, now, null, releasedNow);
  });
  return [release, ...notices];
}

/**
 * (8.0c) Il responsabile toglie un ruolo dal team del dossier (`removeCaseMember`). Se era la riga `osservatore` di chi
 * costruiva il caso da fuori, da lì non costruisce più: i suoi compiti in quel caso tornano da prendere, come con «Togli»,
 * nella stessa transazione della riga tolta (o tutte e due, o niente). Chi costruisce ancora il caso (un ruolo di
 * Lateral Space) li tiene.
 */
export async function removeCaseMemberReleasingTasks(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ userId: string; role: CaseRole }>> {
  return removeCaseMember(executor, ctx, input, {
    after: async ({ userId, role }) =>
      role === "osservatore" ? ((await taskReleaseStatements(executor, { workspaceId: ctx.workspaceId, userId, lsDomains: ctx.lsDomains, caseId: ctx.caseId })) ?? []) : [],
  });
}

/**
 * Chi lascia il workspace non costruisce più: fuori dal team di Lateral Space, le concessioni cancellate, i compiti che
 * aveva tornano da prendere, i token della CLI nel workspace revocati. I ruoli nei casi li toglie già la rimozione dal
 * workspace (`removeUserFromWorkspaceCases`), prima di questa.
 */
export async function leaveWorkspaceFactory(executor: UcExecutor, i: { workspaceId: string; userId: string; lsDomains: readonly string[] }): Promise<{ released: number }> {
  await forgetWorkspaceTeamMember(executor, i);
  const first = [revokeCliTokensStatement(i.workspaceId, i.userId)];
  if (await externalBuildersReady(executor)) first.unshift(...deleteGrantsStatements(i.workspaceId, i.userId));
  const released = await releaseTasksOfFormerBuilder(executor, { ...i, first });
  return { released: released.released };
}

// ─── La lista di «Chi costruisce» ────────────────────────────────────

export interface BuilderRow {
  userId: string;
  name: string;
  email: string;
  /** Di Lateral Space (il team del workspace) o da fuori (una concessione). */
  external: boolean;
  role: WorkspaceTeamRole | "builder_esterno";
  where: BuilderWhere;
  /** I codici dei casi scelti, per «solo in alcuni casi». */
  whereCodes: string[];
  /** Ha una CLI collegata nel workspace, viva. */
  cli: boolean;
  /** Da fuori: perché oggi non costruisce (`ruolo_workspace`, `email_non_verificata`, …); null se costruisce. */
  blocked: ExternalRefusal | null;
  /** I dossier aperti dove costruisce (da fuori: quelli coperti dalla concessione dove ha la riga; di Lateral Space: dove ha il ruolo). */
  openCases: number;
  /** I repository dei suoi casi (da fuori), da togliere a mano su GitHub. */
  repos: string[];
}

/** «Chi costruisce», per nome: il team di Lateral Space e chi costruisce da fuori. */
export async function listBuilders(executor: UcExecutor, workspaceId: string, lsDomains: readonly string[]): Promise<BuilderRow[]> {
  const ws = cast(workspaceId, "uuid");
  const team = (await workspaceTeamReady(executor)) ? await listWorkspaceTeam(executor, workspaceId) : [];
  const grants = await listExternalGrants(executor, workspaceId);
  const externalIds = [...grants.keys()];
  const facts = await personFacts(executor, workspaceId, externalIds, lsDomains);
  const everyone = [...team.map((m) => m.userId), ...externalIds];
  const [cliRows, codeRows] = await executor.batch([
    toStatement(ucSql`SELECT DISTINCT owner_user_id FROM workspace_integration_tokens WHERE workspace_id = ${ws} AND provider = ${cast(CLI_TOKEN_PROVIDER, "text")}
  AND owner_user_id = ANY (${cast(everyone, "uuid[]")}) AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`),
    toStatement(ucSql`SELECT id, code FROM use_cases WHERE workspace_id = ${ws}`),
  ]);
  const withCli = new Set(cliRows.map((r) => String(r.owner_user_id)));
  const codes = new Map(codeRows.map((r) => [String(r.id), r.code ? String(r.code) : "senza codice"]));
  const rows: BuilderRow[] = [];
  for (const m of team) {
    const [open] = await executor.batch([
      toStatement(ucSql`SELECT count(*)::int AS n FROM uc_cases c JOIN uc_case_members m ON m.case_id = c.id AND m.user_id = ${cast(m.userId, "uuid")} AND m.role = ${cast(m.role, "text")}
WHERE c.workspace_id = ${ws} AND c.status <> 'chiuso' AND c.setup_completed_at IS NOT NULL`),
    ]);
    rows.push({ ...m, external: false, where: { all: true }, whereCodes: [], cli: withCli.has(m.userId), blocked: null, openCases: Number(open[0]?.n ?? 0), repos: [] });
  }
  for (const [userId, where] of grants) {
    const p = facts.get(userId);
    // Chi non è più collaboratore non compare (le concessioni le toglie l'uscita dal workspace).
    if (!p || externalRefusal(p) === "non_collaboratore") continue;
    rows.push({
      userId,
      name: p.name,
      email: p.email,
      external: true,
      role: "builder_esterno",
      where,
      whereCodes: where.all ? [] : where.useCaseIds.map((id) => codes.get(id) ?? "senza codice").sort(),
      cli: withCli.has(userId),
      blocked: externalRefusal(p),
      openCases: await observedOpenCases(executor, workspaceId, userId),
      repos: await reposOf(executor, workspaceId, where),
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, "it"));
}

/** Gli use case che si possono scegliere nel «Dove», anche senza dossier (non quelli scartati), per codice. */
export async function listWhereChoices(executor: UcExecutor, workspaceId: string): Promise<{ useCaseId: string; code: string; title: string }[]> {
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT id, code, title FROM use_cases WHERE workspace_id = ${cast(workspaceId, "uuid")} AND status::text <> 'rejected' ORDER BY code NULLS LAST, title`),
  ]);
  return rows.map((r) => ({ useCaseId: String(r.id), code: r.code ? String(r.code) : "", title: String(r.title ?? "") }));
}
