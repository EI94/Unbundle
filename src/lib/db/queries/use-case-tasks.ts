import "server-only";
/**
 * I compiti di uno use case nel database (rilascio 8.1a, docs/rilascio-8/RILASCIO-8.1-COSTRUZIONE.md §2).
 *
 * - `listTasks`: i compiti con chi li ha (il nome si legge solo qui, per la pagina e per `unbundle compiti`; il
 *   brief usa «tuo» o «di un collega»).
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
import { planTaskImport, type TaskDraft, type TaskImportPlan, type TaskRow } from "@/lib/use-cases/factory/tasks";

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
  input: { drafts: readonly TaskDraft[]; doneRefs?: readonly string[]; dryRun?: boolean },
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
  const statements: UcStatement[] = plan.ops.map((op) => {
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
  });
  await executor.batch(statements);
  return ok({ ...plan, dryRun: false });
}
