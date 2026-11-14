/**
 * Il team di Lateral Space di un cliente (rilascio 8.1b): chi costruisce in tutti i casi di un workspace.
 *
 * - **Aggiungere** una persona (per e-mail, con un ruolo: responsabile, analista, sviluppatore): la si ricorda per il
 *   workspace e la si aggiunge al team di ogni dossier aperto, con gli stessi comandi del dossier (`addCaseMember`:
 *   collaboratore del workspace, ruoli `ls_*` solo a Lateral Space, l'evento «membro aggiunto»). Dove ha già un ruolo
 *   di Lateral Space non si aggiunge di nuovo.
 * - **Togliere**: non entra più nei casi nuovi, ed esce dai dossier aperti, da ogni ruolo di Lateral Space che ha
 *   (`removeCaseMember`: mai l'ultimo responsabile di un caso).
 * - **Un dossier nuovo** («Avvia la realizzazione»): chi è nel team del workspace entra nel suo team
 *   (`applyWorkspaceTeamToCase`).
 *
 * I comandi dei casi li fa chi agisce, con i suoi ruoli in quel caso: dove non è responsabile, il caso si salta e si
 * dice quale. Chi può gestire il team del workspace lo controlla chi chiama (il manager di Lateral Space).
 *
 * Modulo senza import dell'app (`@/…`, `server-only`), come `uc-cases.ts`.
 */
import { WORKSPACE_TEAM_PROBE_SQL, WORKSPACE_TEAM_ROLES, type WorkspaceTeamRole } from "../use-case-hub-team-ddl.ts";
import { addCaseMember, loadCaseRoles, loadUserContext, removeCaseMember, type UcCommandContext } from "./uc-cases.ts";
import { cast, raw, toStatement, ucSql } from "../../uc/sql/statement.ts";
import { fail, ok, type Result } from "../../uc/types.ts";
import type { CaseRole } from "../../uc/vocab.ts";
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
FROM use_case_workspace_team t JOIN users u ON u.id = t.user_id
WHERE t.workspace_id = ${cast(workspaceId, "uuid")}
ORDER BY lower(coalesce(nullif(btrim(u.name), ''), u.email))`),
  ]);
  return rows.map((r) => ({ userId: String(r.user_id), name: String(r.name), email: String(r.email), role: String(r.role) as WorkspaceTeamRole }));
}

/** I dossier aperti del workspace (non chiusi), con il codice. */
async function openCases(executor: UcExecutor, workspaceId: string): Promise<{ id: string; code: string }[]> {
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT c.id, coalesce(u.code, c.code) AS code FROM uc_cases c LEFT JOIN use_cases u ON u.id = c.portfolio_use_case_id
WHERE c.workspace_id = ${cast(workspaceId, "uuid")} AND c.status <> 'chiuso' ORDER BY coalesce(u.code, c.code)`),
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
 * Aggiunge al team del workspace una persona di Lateral Space, per e-mail, e la mette nel team di ogni dossier aperto.
 */
export async function addWorkspaceTeamMember(
  executor: UcExecutor,
  i: { workspaceId: string; actorUserId: string; email: unknown; role: unknown; lsDomains: readonly string[] },
): Promise<Result<TeamApplyResult & { userId: string; role: WorkspaceTeamRole }>> {
  const email = typeof i.email === "string" ? i.email.trim().toLowerCase() : "";
  if (!/^[^\s@]{1,64}@[^\s@]{1,255}$/.test(email)) return fail("dati_non_validi", "Scrivi l'e-mail della persona.");
  if (typeof i.role !== "string" || !ROLE_RE.has(i.role)) return fail("dati_non_validi", "Scegli il ruolo: responsabile, analista o sviluppatore.");
  const role = i.role as WorkspaceTeamRole;
  if (!(await workspaceTeamReady(executor))) return fail("non_disponibile", "Non ancora disponibile: riprova tra qualche minuto.");
  const [people] = await executor.batch([
    toStatement(ucSql`SELECT u.id FROM users u JOIN workspaces w ON w.id = ${cast(i.workspaceId, "uuid")}
WHERE lower(u.email) = ${cast(email, "text")} AND (
  EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = w.organization_id AND m.user_id = u.id AND m.role::text <> 'learner')
  OR EXISTS (SELECT 1 FROM workspace_memberships wm WHERE wm.workspace_id = w.id AND wm.user_id = u.id AND wm.role::text <> 'learner'))
LIMIT 1`),
  ]);
  if (!people[0]) return fail("non_collaboratore", "Questa persona non è un collaboratore del workspace: invitala prima nel workspace, poi aggiungila qui.");
  const userId = String(people[0].id);
  const person = await loadUserContext(executor, userId, i.lsDomains);
  if (!person?.isLateralSpace) return fail("non_lateral_space", "Nel team di Lateral Space entrano solo persone di Lateral Space, con l'e-mail verificata.");
  await executor.batch([
    toStatement(ucSql`INSERT INTO use_case_workspace_team (workspace_id, user_id, role) VALUES (${cast(i.workspaceId, "uuid")}, ${cast(userId, "uuid")}, ${cast(role, "text")})
ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role, updated_at = now()`),
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
): Promise<Result<TeamApplyResult>> {
  if (typeof i.userId !== "string" || !/^[0-9a-f-]{36}$/i.test(i.userId)) return fail("dati_non_validi", "Persona non valida.");
  const userId = i.userId;
  if (!(await workspaceTeamReady(executor))) return fail("non_disponibile", "Non ancora disponibile: riprova tra qualche minuto.");
  const [rows] = await executor.batch([
    toStatement(ucSql`DELETE FROM use_case_workspace_team WHERE workspace_id = ${cast(i.workspaceId, "uuid")} AND user_id = ${cast(userId, "uuid")} RETURNING role`),
  ]);
  if (!rows[0]) return fail("non_trovato", "Questa persona non è nel team del workspace.");
  const target = await loadUserContext(executor, userId, i.lsDomains);
  const out: TeamApplyResult = { done: [], unchanged: [], skipped: [] };
  for (const c of await openCases(executor, i.workspaceId)) {
    const held = target ? (await loadCaseRoles(executor, c.id, target, i.lsDomains)).stored.filter((r) => LS_ROLES.includes(r)) : [];
    if (!held.length) {
      out.unchanged.push(c.code);
      continue;
    }
    // Prima i ruoli che non sono di responsabile: se l'ultimo responsabile non si può togliere, il resto è già fatto.
    const ordered = [...held].sort((a, b) => Number(a === "ls_lead") - Number(b === "ls_lead"));
    let failed: string | null = null;
    for (const role of ordered) {
      const ctx = await contextFor(executor, { workspaceId: i.workspaceId, caseId: c.id, actorUserId: i.actorUserId, lsDomains: i.lsDomains });
      const removed = ctx ? await removeCaseMember(executor, ctx, { userId, role }) : fail("utente_non_trovato", "");
      if (!removed.ok) {
        failed = removed.code;
        break;
      }
    }
    if (failed) out.skipped.push({ code: c.code, reason: failed });
    else out.done.push(c.code);
  }
  return ok(out);
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
