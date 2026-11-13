import "server-only";
/**
 * I compiti di uno use case nel database (rilascio 8.1a, docs/rilascio-8/RILASCIO-8.1-COSTRUZIONE.md §2).
 *
 * - `listTasks`: i compiti con chi li ha (il nome si legge solo qui, per la pagina e per `unbundle compiti`; il
 *   brief usa «tuo» o «di altri»). I risultati delle azioni, che il registro dell'idempotenza conserva, non hanno nomi.
 * - `importTasks`: i compiti di `compiti.md`, più «fatto» dalle PR unite, con `planTaskImport`. A secco dice soltanto
 *   cosa farebbe; altrimenti scrive tutto in una transazione. Testi del team: passano `checkLsText`.
 *
 * Chi ha un compito si vede sul compito; nessuna lettura qui raggruppa, conta o ordina per persona (art. 15.4).
 */
import type { UcExecutor } from "@/lib/db/uc-executor";
import { TASKS_PROBE_SQL, TASK_STATUSES, type TaskStatus } from "@/lib/db/use-case-hub-tasks-ddl";
import { checkLsText } from "@/lib/db/queries/uc-cases";
import type { FactoryTarget } from "@/lib/db/queries/use-case-factory";
import { cast, jsonb, raw, toStatement, ucSql, type UcStatement } from "@/lib/uc/sql/statement";
import { fail, ok, type Result } from "@/lib/uc/types";
import type { CaseRole } from "@/lib/uc/vocab";
import { overlappingTasks, planTaskImport, type TaskDraft, type TaskImportPlan, type TaskRow } from "@/lib/use-cases/factory/tasks";
import { BUILDER_ROLES, hasOpenTasksSql, NOBODY, notifyTask } from "@/lib/db/queries/use-case-tasks-notices";
import { ucLsDomains } from "@/lib/db/queries/uc-access";
import { isEmailVerifiedValue, isLateralSpaceEmail } from "@/lib/uc/lateral-space";

/** Un compito alla volta per use case: l'import, `compito nuovo` (stesso lock, stessa chiave). */
const tasksLock = (target: FactoryTarget) => toStatement(ucSql`SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-tasks:' || ${cast(target.useCaseId, "text")}))`);

/** Vero se la 0032 è applicata (la stessa sonda di `ensureDbSchema`). */
export async function tasksStoreReady(executor: UcExecutor): Promise<boolean> {
  try {
    const [rows] = await executor.batch([toStatement(ucSql`SELECT ${raw(TASKS_PROBE_SQL)} AS ready`)]);
    return rows[0]?.ready === true;
  } catch {
    return false;
  }
}

/** Un compito con il nome di chi lo ha, per la pagina e per `unbundle compiti`. */
export interface TaskView extends TaskRow {
  holderName: string | null;
  branch: string | null;
  prUrl: string | null;
  updatedAt: string;
}

const iso = (v: unknown) => (v === null || v === undefined ? null : new Date(String(v)).toISOString());
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const statusOf = (v: unknown): TaskStatus => ((TASK_STATUSES as readonly string[]).includes(String(v)) ? (String(v) as TaskStatus) : "da_fare");

/** I compiti dello use case, in ordine di riferimento. */
export async function listTasks(executor: UcExecutor, target: FactoryTarget): Promise<TaskView[]> {
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT t.id, t.ref, t.title, t.areas, t.estimate_hours, t.evidence, t.status, t.holder_user_id, t.taken_at, t.last_activity_at,
  t.stale_asked_at, t.stale_escalated_at, t.branch, t.pr_url, t.updated_at, coalesce(nullif(btrim(u.name), ''), split_part(u.email, '@', 1)) AS holder_name
FROM use_case_tasks t
LEFT JOIN users u ON u.id = t.holder_user_id
WHERE t.workspace_id = ${cast(target.workspaceId, "uuid")} AND t.use_case_id = ${cast(target.useCaseId, "uuid")}
ORDER BY substring(t.ref from 3)::int`),
  ]);
  return rows.map((r) => ({
    id: String(r.id),
    ref: String(r.ref),
    title: String(r.title),
    areas: Array.isArray(r.areas) ? r.areas.map(String) : [],
    estimateHours: num(r.estimate_hours),
    evidence: r.evidence === null || r.evidence === undefined ? null : String(r.evidence),
    status: statusOf(r.status),
    holderUserId: r.holder_user_id ? String(r.holder_user_id) : null,
    takenAt: iso(r.taken_at),
    lastActivityAt: iso(r.last_activity_at),
    staleAskedAt: iso(r.stale_asked_at),
    staleEscalatedAt: iso(r.stale_escalated_at),
    holderName: r.holder_user_id && r.holder_name ? String(r.holder_name) : null,
    branch: r.branch ? String(r.branch) : null,
    prUrl: r.pr_url ? String(r.pr_url) : null,
    updatedAt: iso(r.updated_at) ?? "",
  }));
}

/** La versione del progetto a cui legare i compiti: l'approvata, altrimenti l'ultima. */
const projectVersionSql = (target: FactoryTarget) =>
  ucSql`(SELECT p.version FROM use_case_projects p WHERE p.use_case_id = ${cast(target.useCaseId, "uuid")} AND p.workspace_id = ${cast(target.workspaceId, "uuid")}
  ORDER BY (p.status = 'approvato') DESC, p.version DESC LIMIT 1)`;

export interface TaskImportResult extends TaskImportPlan {
  dryRun: boolean;
}

/**
 * Porta in Unbundle i compiti del file. `doneRefs`: i compiti con una PR unita. Chi lo fa deve poter scrivere nel
 * caso: lo controlla chi chiama. Un compito con un titolo, un'area o una prova che non passa il controllo dei testi
 * ferma tutto, prima di scrivere.
 */
export async function importTasks(
  executor: UcExecutor,
  target: FactoryTarget,
  input: { drafts: readonly TaskDraft[]; doneRefs?: readonly string[]; dryRun?: boolean; actorId?: string | null },
  now: Date = new Date(),
): Promise<Result<TaskImportResult>> {
  if (input.drafts.length === 0) return fail("dati_non_validi", "Nessun compito da importare: controlla compiti.md.");
  if (input.drafts.length > 200) return fail("dati_non_validi", "Troppi compiti in un caso solo (al massimo 200).");
  const texts = checkLsText(input.drafts.map((d) => ({ titolo: d.title, aree: d.areas, prove: d.evidence })));
  if (!texts.ok) return texts;
  const existing = await listTasks(executor, target);
  const plan = planTaskImport(existing, input.drafts, new Set(input.doneRefs ?? []));
  if (input.dryRun || plan.ops.length === 0) return ok({ ...plan, dryRun: Boolean(input.dryRun) });
  const ws = cast(target.workspaceId, "uuid");
  const uc = cast(target.useCaseId, "uuid");
  const statements: UcStatement[] = [tasksLock(target)];
  statements.push(...plan.ops.map((op) => {
    if (op.kind === "nuovo") {
      const d = op.draft;
      return toStatement(ucSql`INSERT INTO use_case_tasks (use_case_id, workspace_id, ref, title, areas, estimate_hours, evidence, status, source, project_version)
VALUES (${uc}, ${ws}, ${cast(d.ref, "text")}, ${cast(d.title, "text")}, ${jsonb(d.areas)}, ${cast(d.estimateHours, "numeric")}, ${cast(d.evidence, "text")},
  ${cast(op.status, "text")}, 'progetto', ${projectVersionSql(target)})
ON CONFLICT (use_case_id, ref) DO NOTHING`);
    }
    const c = op.changes;
    const sets = [
      c.title !== undefined ? ucSql`title = ${cast(c.title, "text")}` : null,
      c.areas !== undefined ? ucSql`areas = ${jsonb(c.areas)}` : null,
      c.estimateHours !== undefined ? ucSql`estimate_hours = ${cast(c.estimateHours, "numeric")}` : null,
      c.evidence !== undefined ? ucSql`evidence = ${cast(c.evidence, "text")}` : null,
      op.status === "fatto" ? ucSql`status = CASE WHEN status IN ('fatto', 'annullato') THEN status ELSE 'fatto' END` : null,
    ].filter((s): s is NonNullable<typeof s> => s !== null);
    const assignments = sets.reduce((acc, s, i) => (i === 0 ? s : ucSql`${acc}, ${s}`));
    return toStatement(ucSql`UPDATE use_case_tasks SET ${assignments}, updated_at = now()
WHERE id = ${cast(op.id, "uuid")} AND workspace_id = ${ws} AND use_case_id = ${uc}`);
  }));
  // Compiti nuovi da prendere su un progetto già approvato: lo sa chi costruisce (mai chi importa).
  if (plan.ops.some((o) => o.kind === "nuovo" && o.status === "da_fare")) {
    const approved = ucSql`EXISTS (SELECT 1 FROM use_case_projects p WHERE p.workspace_id = ${ws} AND p.use_case_id = ${uc} AND p.status = 'approvato')`;
    statements.push(...notify(target, "compiti_pronti", { roles: BUILDER_ROLES }, input.actorId ?? NOBODY, now, null, ucSql`${approved} AND ${hasOpenTasksSql(target)}`));
  }
  await executor.batch(statements);
  return ok({ ...plan, dryRun: false });
}

// ─── Le azioni sui compiti ───────────────────────────────────────────

/** Chi agisce: la persona e i suoi ruoli nel caso (chi può scrivere lo controlla chi chiama). */
export interface TaskActor {
  userId: string;
  roles: readonly CaseRole[];
}

const isLead = (a: TaskActor) => a.roles.includes("ls_lead");
const notify = notifyTask;

async function projectApproved(executor: UcExecutor, target: FactoryTarget): Promise<boolean> {
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT 1 AS ok FROM use_case_projects WHERE use_case_id = ${cast(target.useCaseId, "uuid")} AND workspace_id = ${cast(target.workspaceId, "uuid")} AND status = 'approvato' LIMIT 1`),
  ]);
  return rows.length > 0;
}

const notFound = (ref: string) => fail("non_trovato", `${ref} non c'è tra i compiti del caso: «unbundle compiti» li elenca.`) as Result<never>;
const who = (t: TaskView) => t.holderName ?? "qualcuno del team";

export interface TakeResult extends Record<string, unknown> {
  ref: string;
  titolo: string;
  ramo: string | null;
  giaTuo: boolean;
  sovrapposizioni: { ref: string; areas: string[] }[];
}

/**
 * `take`: prende un compito da fare (o rimasto senza persona). Con il progetto approvato. Se le sue aree toccano un
 * compito in corso si ferma, salvo `force`. Due persone insieme: lo prende una sola.
 */
export async function takeTask(executor: UcExecutor, target: FactoryTarget, actor: TaskActor, input: { ref: string; branch: string | null; force: boolean }): Promise<Result<TakeResult>> {
  if (!(await projectApproved(executor, target))) return fail("progetto_non_approvato", "Il progetto non è ancora approvato: i compiti si prendono dopo l'approvazione.");
  const tasks = await listTasks(executor, target);
  const task = tasks.find((t) => t.ref === input.ref);
  if (!task) return notFound(input.ref);
  if (task.status === "fatto" || task.status === "annullato") return fail("conflitto", `${task.ref} è ${task.status === "fatto" ? "già fatto" : "annullato"}.`);
  const overlaps = overlappingTasks(task, tasks.filter((t) => t.holderUserId !== actor.userId));
  if ((task.status === "in_corso" || task.status === "in_revisione") && task.holderUserId === actor.userId) {
    // Riprenderlo è un segnale di vita: è quello che chiede il promemoria del compito fermo.
    await touchTask(executor, target, { userId: actor.userId, ref: task.ref });
    return ok({ ref: task.ref, titolo: task.title, ramo: task.branch, giaTuo: true, sovrapposizioni: overlaps });
  }
  if (task.holderUserId !== null) return fail("gia_preso", `${task.ref} l'ha già preso ${who(task)}: chiediglielo con «unbundle chiedi».`);
  if (overlaps.length && !input.force) {
    const list = overlaps.map((o) => `${o.ref} (${o.areas.join(", ")})`).join("; ");
    return fail("aree_sovrapposte", `${task.ref} tocca le aree di compiti in corso: ${list}. Accordatevi, poi rilancia con --comunque.`);
  }
  const [rows] = await executor.batch([
    // Un compito rimasto senza persona (l'utente non c'è più) si riprende dov'era: in corso o in revisione.
    toStatement(ucSql`UPDATE use_case_tasks SET status = CASE WHEN status = 'in_revisione' THEN status ELSE 'in_corso' END, holder_user_id = ${cast(actor.userId, "uuid")},
  taken_at = now(), last_activity_at = now(), stale_asked_at = NULL, stale_escalated_at = NULL, branch = coalesce(${cast(input.branch, "text")}, branch), updated_at = now()
WHERE id = ${cast(task.id, "uuid")} AND workspace_id = ${cast(target.workspaceId, "uuid")}
  AND (status = 'da_fare' OR (status IN ('in_corso', 'in_revisione') AND holder_user_id IS NULL))
RETURNING ref, branch`),
  ]);
  if (!rows[0]) return fail("gia_preso", `${task.ref} l'ha appena preso qualcun altro: «unbundle compiti» per vedere chi.`);
  return ok({ ref: task.ref, titolo: task.title, ramo: rows[0].branch ? String(rows[0].branch) : null, giaTuo: false, sovrapposizioni: overlaps });
}

const noteText = (note: unknown): Result<string> => {
  const text = typeof note === "string" ? note.trim() : "";
  if (!text) return fail("dati_non_validi", "Serve la nota di passaggio: fatto, da fare, dubbi, come riprendere.");
  if (text.length > 2000) return fail("dati_non_validi", "La nota è troppo lunga (al massimo 2000 caratteri).");
  const guard = checkLsText({ nota: text });
  return guard.ok ? ok(text) : guard;
};

/** `lascia`: il compito torna da prendere, con la nota di passaggio. Lo lascia chi lo ha, o il responsabile del caso. */
export async function releaseTask(executor: UcExecutor, target: FactoryTarget, actor: TaskActor, input: { ref: string; note: unknown }): Promise<Result<{ ref: string }>> {
  const note = noteText(input.note);
  if (!note.ok) return note;
  const task = (await listTasks(executor, target)).find((t) => t.ref === input.ref);
  if (!task) return notFound(input.ref);
  if (task.status !== "in_corso") return fail("conflitto", `${task.ref} non è in corso: si lascia solo un compito in corso.`);
  if (task.holderUserId !== actor.userId && !isLead(actor)) return fail("permesso_negato", `${task.ref} è di ${who(task)}: lo lascia chi lo ha, o il responsabile del caso.`);
  const [rows] = await executor.batch([
    toStatement(ucSql`WITH done AS (
  UPDATE use_case_tasks SET status = 'da_fare', holder_user_id = NULL, taken_at = NULL, stale_asked_at = NULL, stale_escalated_at = NULL, updated_at = now()
  WHERE id = ${cast(task.id, "uuid")} AND workspace_id = ${cast(target.workspaceId, "uuid")} AND status = 'in_corso'
    AND holder_user_id IS NOT DISTINCT FROM ${cast(task.holderUserId, "uuid")}
  RETURNING id
)
INSERT INTO use_case_task_notes (task_id, use_case_id, workspace_id, kind, body)
SELECT done.id, ${cast(target.useCaseId, "uuid")}, ${cast(target.workspaceId, "uuid")}, 'passaggio', ${cast(note.value, "text")} FROM done
RETURNING task_id`),
  ]);
  if (!rows[0]) return fail("conflitto", `${task.ref} è appena cambiato: «unbundle compiti» per vederlo com'è.`);
  return ok({ ref: task.ref });
}

/**
 * `passa`: il compito a una persona del team che costruisce (di Lateral Space, con l'e-mail verificata), con la nota.
 * Lo passa chi lo ha, o il responsabile. La notifica parte solo se il passaggio è avvenuto.
 */
export async function passTask(
  executor: UcExecutor,
  target: FactoryTarget,
  actor: TaskActor,
  input: { ref: string; toEmail: unknown; note: unknown },
  now: Date = new Date(),
): Promise<Result<{ ref: string }>> {
  const note = noteText(input.note);
  if (!note.ok) return note;
  const email = typeof input.toEmail === "string" ? input.toEmail.trim().toLowerCase() : "";
  if (!/^[^\s@]{1,64}@[^\s@]{1,255}$/.test(email)) return fail("dati_non_validi", "Indica a chi passarlo con la sua e-mail: --a nome@dominio.");
  const task = (await listTasks(executor, target)).find((t) => t.ref === input.ref);
  if (!task) return notFound(input.ref);
  if (task.status !== "in_corso") return fail("conflitto", `${task.ref} non è in corso: si passa solo un compito in corso. Per uno da fare: «unbundle take».`);
  if (task.holderUserId !== actor.userId && !isLead(actor)) return fail("permesso_negato", `${task.ref} è di ${who(task)}: lo passa chi lo ha, o il responsabile del caso.`);
  const [people] = await executor.batch([
    toStatement(ucSql`SELECT DISTINCT u.id, u.email, u.email_verified
FROM uc_cases c JOIN uc_case_members m ON m.case_id = c.id JOIN users u ON u.id = m.user_id
WHERE c.workspace_id = ${cast(target.workspaceId, "uuid")} AND c.portfolio_use_case_id = ${cast(target.useCaseId, "uuid")}
  AND m.role = ANY (${cast([...BUILDER_ROLES], "text[]")}) AND lower(u.email) = ${cast(email, "text")}`),
  ]);
  const to = people.find((p) => isLateralSpaceEmail({ email: String(p.email), emailVerified: isEmailVerifiedValue(p.email_verified) }, ucLsDomains()));
  if (!to) return fail("non_trovato", "Questa persona non è nel team del caso con un ruolo che costruisce, o non è di Lateral Space: la aggiunge il responsabile, nel dossier.");
  const toId = String(to.id);
  if (toId === task.holderUserId) return fail("conflitto", `${task.ref} ce l'ha già questa persona.`);
  // Nella stessa transazione: il compito è passato adesso (`now()` è l'ora della transazione).
  const passed = ucSql`EXISTS (SELECT 1 FROM use_case_tasks x WHERE x.id = ${cast(task.id, "uuid")} AND x.holder_user_id = ${cast(toId, "uuid")} AND x.taken_at = now())`;
  const [rows] = await executor.batch([
    toStatement(ucSql`WITH done AS (
  UPDATE use_case_tasks SET holder_user_id = ${cast(toId, "uuid")}, taken_at = now(), last_activity_at = now(), stale_asked_at = NULL, stale_escalated_at = NULL, updated_at = now()
  WHERE id = ${cast(task.id, "uuid")} AND workspace_id = ${cast(target.workspaceId, "uuid")} AND status = 'in_corso'
    AND holder_user_id IS NOT DISTINCT FROM ${cast(task.holderUserId, "uuid")}
  RETURNING id
)
INSERT INTO use_case_task_notes (task_id, use_case_id, workspace_id, kind, body)
SELECT done.id, ${cast(target.useCaseId, "uuid")}, ${cast(target.workspaceId, "uuid")}, 'passaggio', ${cast(note.value, "text")} FROM done
RETURNING task_id`),
    ...notify(target, "compito_passato", { userId: toId }, actor.userId, now, task.ref, passed),
  ]);
  if (!rows[0]) return fail("conflitto", `${task.ref} è appena cambiato: «unbundle compiti» per vederlo com'è.`);
  return ok({ ref: task.ref });
}

/** `chiedi`: chiede un compito a chi lo ha, con una nota facoltativa. Chi lo ha lo sa (campanella ed e-mail). */
export async function requestTask(executor: UcExecutor, target: FactoryTarget, actor: TaskActor, input: { ref: string; note: unknown }, now: Date = new Date()): Promise<Result<{ ref: string }>> {
  const asked = typeof input.note === "string" && input.note.trim() ? input.note : "Vorrei prendere questo compito: passamelo con «unbundle passa», o dimmi quando.";
  const note = noteText(asked);
  if (!note.ok) return note;
  const task = (await listTasks(executor, target)).find((t) => t.ref === input.ref);
  if (!task) return notFound(input.ref);
  if (task.status === "da_fare" || (task.status === "in_corso" && task.holderUserId === null)) return fail("libero", `${task.ref} è libero: prendilo con «unbundle take».`);
  if (task.status === "fatto" || task.status === "annullato" || !task.holderUserId) return fail("conflitto", `${task.ref} non è in corso.`);
  if (task.holderUserId === actor.userId) return fail("conflitto", `${task.ref} è già tuo.`);
  await executor.batch([
    toStatement(ucSql`INSERT INTO use_case_task_notes (task_id, use_case_id, workspace_id, kind, body, requested_by_user_id)
VALUES (${cast(task.id, "uuid")}, ${cast(target.useCaseId, "uuid")}, ${cast(target.workspaceId, "uuid")}, 'richiesta', ${cast(note.value, "text")}, ${cast(actor.userId, "uuid")})`),
    ...notify(target, "compito_chiesto", { userId: task.holderUserId }, actor.userId, now, task.ref),
  ]);
  return ok({ ref: task.ref });
}

/** `compito nuovo`: un compito in più, con il riferimento dopo l'ultimo (sotto un lock per caso: due insieme non collidono). */
export async function addTask(
  executor: UcExecutor,
  target: FactoryTarget,
  input: { draft: Omit<TaskDraft, "ref" | "done" | "cancelled">; source: "cli" | "pagina" },
): Promise<Result<{ ref: string }>> {
  const d = input.draft;
  if (!d.title.trim()) return fail("dati_non_validi", "Serve il titolo del compito.");
  const guard = checkLsText({ titolo: d.title, aree: d.areas, prove: d.evidence });
  if (!guard.ok) return guard;
  const uc = cast(target.useCaseId, "uuid");
  const [, rows] = await executor.batch([
    tasksLock(target),
    toStatement(ucSql`INSERT INTO use_case_tasks (use_case_id, workspace_id, ref, title, areas, estimate_hours, evidence, status, source, project_version)
SELECT ${uc}, ${cast(target.workspaceId, "uuid")}, 'T-' || (coalesce((SELECT max(substring(ref from 3)::int) FROM use_case_tasks WHERE use_case_id = ${uc}), 0) + 1),
  ${cast(d.title.trim().slice(0, 200), "text")}, ${jsonb(d.areas)}, ${cast(d.estimateHours, "numeric")}, ${cast(d.evidence, "text")}, 'da_fare', ${cast(input.source, "text")}, ${projectVersionSql(target)}
RETURNING ref`),
  ]);
  return ok({ ref: String(rows[0].ref) });
}

/**
 * `compito segna`: fatto, annullato, o di nuovo da fare (riaperto, senza persona). Lo fa chi scrive nel caso; un
 * compito che ha qualcun altro lo segna solo il responsabile del caso, come per `lascia`.
 */
export async function setTaskStatus(executor: UcExecutor, target: FactoryTarget, actor: TaskActor, input: { ref: string; status: unknown }): Promise<Result<{ ref: string; stato: TaskStatus }>> {
  const status = input.status;
  if (status !== "fatto" && status !== "annullato" && status !== "da_fare") return fail("dati_non_validi", "Lo stato è fatto, annullato o da_fare.");
  const task = (await listTasks(executor, target)).find((t) => t.ref === input.ref);
  if (!task) return notFound(input.ref);
  if (task.status === status) return ok({ ref: task.ref, stato: status });
  if (task.holderUserId !== null && task.holderUserId !== actor.userId && !isLead(actor)) {
    return fail("permesso_negato", `${task.ref} è di ${who(task)}: lo segna chi lo ha, o il responsabile del caso. Per chiederlo: «unbundle chiedi».`);
  }
  const reset = status === "da_fare" ? raw(", holder_user_id = NULL, taken_at = NULL, stale_asked_at = NULL, stale_escalated_at = NULL") : raw("");
  const [rows] = await executor.batch([
    toStatement(ucSql`UPDATE use_case_tasks SET status = ${cast(status, "text")}${reset}, updated_at = now()
WHERE id = ${cast(task.id, "uuid")} AND workspace_id = ${cast(target.workspaceId, "uuid")} AND status = ${cast(task.status, "text")}
  AND holder_user_id IS NOT DISTINCT FROM ${cast(task.holderUserId, "uuid")}
RETURNING id`),
  ]);
  if (!rows[0]) return fail("conflitto", `${task.ref} è appena cambiato: «unbundle compiti» per vederlo com'è.`);
  return ok({ ref: task.ref, stato: status });
}

/** Un segnale di vita sul compito di chi lavora: da `take`, dalla sintesi di una sessione, da ogni chiamata con il compito. */
export async function touchTask(executor: UcExecutor, target: FactoryTarget, input: { userId: string; ref: string }): Promise<void> {
  await executor.batch([
    toStatement(ucSql`UPDATE use_case_tasks SET last_activity_at = now()
WHERE workspace_id = ${cast(target.workspaceId, "uuid")} AND use_case_id = ${cast(target.useCaseId, "uuid")} AND ref = ${cast(input.ref, "text")}
  AND holder_user_id = ${cast(input.userId, "uuid")} AND status IN ('in_corso', 'in_revisione')`),
  ]);
}

/** Le note di un compito, dalla più recente, per `unbundle compiti <ID> T-n` e la pagina. */
export async function listTaskNotes(executor: UcExecutor, target: FactoryTarget, ref: string): Promise<{ kind: string; body: string; createdAt: string; requestedBy: string | null }[]> {
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT n.kind, n.body, n.created_at, coalesce(nullif(btrim(u.name), ''), split_part(u.email, '@', 1)) AS requested_by
FROM use_case_task_notes n JOIN use_case_tasks t ON t.id = n.task_id
LEFT JOIN users u ON u.id = n.requested_by_user_id
WHERE t.workspace_id = ${cast(target.workspaceId, "uuid")} AND t.use_case_id = ${cast(target.useCaseId, "uuid")} AND t.ref = ${cast(ref, "text")}
ORDER BY n.created_at DESC LIMIT 20`),
  ]);
  return rows.map((r) => ({ kind: String(r.kind), body: String(r.body), createdAt: iso(r.created_at) ?? "", requestedBy: r.requested_by ? String(r.requested_by) : null }));
}
