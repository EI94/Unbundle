/**
 * Le notifiche dei compiti (rilascio 8.1a, docs/rilascio-8/RILASCIO-8.1-COSTRUZIONE.md §2): campanella ed e-mail
 * interna, e il giro dei compiti fermi del cron dei dossier.
 *
 * - `notifyTask`: una riga nella campanella (`use_case_notifications`) e un'e-mail in coda (`uc_notifications`),
 *   a una persona, ai ruoli del caso o (8.0c) a chi costruisce il caso adesso (`{ builders }`: i ruoli di Lateral Space
 *   salvati più chi costruisce da fuori, il predicato di `use-case-builders.ts`). Mai a chi agisce; una al giorno per
 *   persona, caso e tipo. `when` è una condizione nella stessa transazione.
 * - `runTaskStaleSweep`: nei giorni lavorativi, per ogni compito in corso, `staleStep`.
 *   - «chiedi» lo chiede a chi ha il compito;
 *   - «responsabile» lo dice al responsabile del caso (non a chi ha il compito, se è lui);
 *   - si segna quando, così non si ripete per lo stesso segnale.
 *
 *   Non riassegna mai niente.
 *
 * Modulo senza import dell'app (`@/…`, `server-only`): lo usano le query dei compiti e il cron dei dossier.
 */
import { TASKS_PROBE_SQL, type TaskStatus } from "../use-case-hub-tasks-ddl.ts";
import type { GithubNoticeKind } from "../use-case-hub-github-ddl.ts";
import type { ProposalNoticeKind } from "../use-case-hub-proposals-ddl.ts";
import type { EvalNoticeKind } from "../use-case-hub-evals-ddl.ts";
import type { TaskNoticeKind as TaskOnlyNoticeKind } from "../use-case-hub-tasks-ddl.ts";
import { createHash } from "node:crypto";
import { cast, jsonb, raw, toStatement, ucSql, type SqlFragment, type UcStatement } from "../../uc/sql/statement.ts";
import type { CaseRole } from "../../uc/vocab.ts";
import { romeToday } from "../../use-cases/quarter.ts";
import { staleStep } from "../../use-cases/factory/tasks.ts";
import type { UcExecutor } from "../uc-executor.ts";
import { builderMembersSql, type BuilderScope } from "./use-case-builders.ts";

/** Lo use case e il workspace. */
export interface TaskNoticeTarget {
  workspaceId: string;
  useCaseId: string;
}

/**
 * A chi va: una persona, i ruoli salvati nel caso, oppure chi costruisce il caso adesso (`builders`: con l'ambito degli
 * esterni, i domini di Lateral Space e se la 0037 c'è, letto da chi chiama prima di costruire le istruzioni).
 */
export type TaskRecipient = { userId: string } | { roles: readonly CaseRole[] } | { builders: BuilderScope };

/** Le persone del caso `c` a cui va la notifica (una colonna `user_id`), per i ruoli o per chi costruisce. */
function caseRecipients(to: Exclude<TaskRecipient, { userId: string }>): SqlFragment {
  if ("builders" in to) return builderMembersSql(to.builders);
  return ucSql`(SELECT m.user_id FROM uc_case_members m WHERE m.case_id = c.id AND m.role = ANY (${cast([...to.roles], "text[]")}))`;
}

/**
 * I tipi che passano da qui: quelli dei compiti (0032), la PR da rivedere (0033), la proposta di compito (0034), il
 * consiglio del banco di prova e le evals scese (0036).
 */
export type TaskNoticeKind = TaskOnlyNoticeKind | GithubNoticeKind | ProposalNoticeKind | EvalNoticeKind;

/**
 * Che cosa aggiunge una notifica: al responsabile (il compito fermo), o la PR (numero e repository), o (0036) il ruolo e
 * il modello che il banco consiglia (con il nome da mostrare), l'avviso delle evals con la qualità già scritta
 * («80%») e il calo (0..1). I testi li scrive il modulo del banco: l'e-mail li controlla e li mostra. Mai una persona.
 */
export interface TaskNoticeExtra {
  responsabile?: boolean;
  pr?: number;
  repo?: string;
  role?: string;
  model?: string;
  label?: string;
  alert?: "sotto_soglia" | "in_calo";
  qualityText?: string;
  drop?: number;
  /**
   * (8.2b) Le evals le ha mandate la CI di main, con la chiave del repository: l'e-mail `evals_in_calo` lo dice, con il
   * commit (le 40 cifre; l'e-mail ne mostra 7). Senza, o con un commit che non è di 40 cifre, niente riga in più.
   */
  fromCi?: { commit: string };
}

/** (8.2b) Il commit di main che manda la CI: le 40 cifre esadecimali, in minuscolo. */
const CI_COMMIT = /^[0-9a-f]{40}$/;

/** Nessuno: per le notifiche del cron, che non escludono una persona. */
export const NOBODY = "00000000-0000-0000-0000-000000000000";

const ALWAYS = raw("true");

/** Chi agisce (e non riceve): un id, o (8.1b) un'espressione letta nella stessa transazione. */
export type TaskActor = string | SqlFragment;
const actorSql = (actor: TaskActor): SqlFragment => (typeof actor === "string" ? cast(actor, "uuid") : actor);

/** Una riga nella campanella, a una persona o ai ruoli del caso; mai a `actorId`. Una al giorno per tipo. */
export function taskNoticeSql(target: TaskNoticeTarget, kind: TaskNoticeKind, to: TaskRecipient, actorId: TaskActor, now: Date, when: SqlFragment = ALWAYS): UcStatement {
  const ws = cast(target.workspaceId, "uuid");
  const uc = cast(target.useCaseId, "uuid");
  const day = cast(romeToday(now), "date");
  const conflict = raw("ON CONFLICT (recipient_user_id, use_case_id, kind, rome_day) DO UPDATE SET last_event_at = now(), read_at = NULL");
  if ("userId" in to) {
    return toStatement(ucSql`INSERT INTO use_case_notifications (workspace_id, use_case_id, recipient_user_id, kind, rome_day)
SELECT ${ws}, ${uc}, ${cast(to.userId, "uuid")}, ${cast(kind, "text")}, ${day} WHERE ${cast(to.userId, "uuid")} IS DISTINCT FROM ${actorSql(actorId)} AND ${when}
${conflict}`);
  }
  return toStatement(ucSql`INSERT INTO use_case_notifications (workspace_id, use_case_id, recipient_user_id, kind, rome_day)
SELECT DISTINCT c.workspace_id, c.portfolio_use_case_id, r.user_id, ${cast(kind, "text")}, ${day}
FROM uc_cases c CROSS JOIN LATERAL ${caseRecipients(to)} r
WHERE c.workspace_id = ${ws} AND c.portfolio_use_case_id = ${uc} AND r.user_id IS DISTINCT FROM ${actorSql(actorId)} AND ${when}
${conflict}`);
}

/**
 * L'e-mail interna della coda dei dossier (`uc_notifications`), a una persona o ai ruoli del caso; mai a `actorId`.
 * Una al giorno per persona, caso e tipo. La manda il giro dopo la risposta, o il cron.
 */
export function taskEmailSql(
  target: TaskNoticeTarget,
  kind: TaskNoticeKind,
  to: TaskRecipient,
  actorId: TaskActor,
  now: Date,
  ref: string | null,
  when: SqlFragment = ALWAYS,
  extra: TaskNoticeExtra = {},
): UcStatement {
  const ws = cast(target.workspaceId, "uuid");
  const uc = cast(target.useCaseId, "uuid");
  const tpl = cast(kind, "text");
  const day = cast(romeToday(now), "text");
  const payload = jsonb({
    useCase: target.useCaseId,
    ...(ref ? { ref } : {}),
    ...(extra.responsabile ? { responsabile: true } : {}),
    ...(extra.pr ? { pr: extra.pr } : {}),
    ...(extra.repo ? { repo: extra.repo } : {}),
    ...(extra.role ? { role: extra.role } : {}),
    ...(extra.model ? { model: extra.model } : {}),
    ...(extra.label ? { label: extra.label } : {}),
    ...(extra.alert ? { alert: extra.alert } : {}),
    ...(extra.qualityText ? { qualityText: extra.qualityText } : {}),
    ...(extra.drop !== undefined && Number.isFinite(extra.drop) ? { drop: extra.drop } : {}),
    ...(extra.fromCi && CI_COMMIT.test(extra.fromCi.commit) ? { source: "ci", commit: extra.fromCi.commit } : {}),
  });
  // Il compito (e la PR) nella chiave: due compiti, o due PR, lo stesso giorno sono due e-mail. La PR come impronta
  // corta: un nome di repository lungo non supera la colonna (varchar 200).
  const prKey = extra.pr ? `pr-${createHash("sha256").update(`${extra.repo ?? ""}#${extra.pr}`).digest("hex").slice(0, 16)}` : null;
  const which = [ref, prKey].filter(Boolean).join(":") || null;
  const key = which ? ucSql`${tpl} || ':' || c.id::text || ':' || r.user_id::text || ':' || ${day} || ':' || ${cast(which, "text")}` : ucSql`${tpl} || ':' || c.id::text || ':' || r.user_id::text || ':' || ${day}`;
  const recipients = "userId" in to ? ucSql`(SELECT ${cast(to.userId, "uuid")} AS user_id)` : caseRecipients(to);
  return toStatement(ucSql`INSERT INTO uc_notifications (workspace_id, case_id, recipient_user_id, channel, template_key, payload, status, dedupe_key, scheduled_at)
SELECT DISTINCT ON (r.user_id) c.workspace_id, c.id, r.user_id, 'email', ${tpl}, ${payload}, 'in_coda', ${key}, now()
FROM uc_cases c CROSS JOIN LATERAL ${recipients} r
WHERE c.workspace_id = ${ws} AND c.portfolio_use_case_id = ${uc} AND r.user_id IS DISTINCT FROM ${actorSql(actorId)} AND ${when}
ON CONFLICT (dedupe_key) DO NOTHING`);
}

/** Campanella ed e-mail insieme. */
export function notifyTask(
  target: TaskNoticeTarget,
  kind: TaskNoticeKind,
  to: TaskRecipient,
  actorId: TaskActor,
  now: Date,
  ref: string | null,
  when: SqlFragment = ALWAYS,
  extra: TaskNoticeExtra = {},
): UcStatement[] {
  return [taskNoticeSql(target, kind, to, actorId, now, when), taskEmailSql(target, kind, to, actorId, now, ref, when, extra)];
}

/** Vero se lo use case ha compiti da prendere (la condizione di «ci sono compiti da prendere»). */
export function hasOpenTasksSql(target: TaskNoticeTarget): SqlFragment {
  return ucSql`EXISTS (SELECT 1 FROM use_case_tasks t WHERE t.workspace_id = ${cast(target.workspaceId, "uuid")} AND t.use_case_id = ${cast(target.useCaseId, "uuid")} AND t.status = 'da_fare')`;
}

/** Vero se la 0032 è applicata. */
export async function tasksTablesReady(executor: UcExecutor): Promise<boolean> {
  try {
    const [rows] = await executor.batch([toStatement(ucSql`SELECT ${raw(TASKS_PROBE_SQL)} AS ready`)]);
    return rows[0]?.ready === true;
  } catch {
    return false;
  }
}

export interface TaskStaleSummary {
  asked: number;
  escalated: number;
  errors: number;
}

const iso = (v: unknown) => (v === null || v === undefined ? null : new Date(String(v)).toISOString());

/**
 * Il giro dei compiti fermi, nei workspace `workspaceIds` (null = tutti). Ogni compito in una transazione sua: un
 * errore non ferma gli altri.
 */
export async function runTaskStaleSweep(executor: UcExecutor, o: { now: Date; workspaceIds: readonly string[] | null; limit?: number }): Promise<TaskStaleSummary> {
  const summary: TaskStaleSummary = { asked: 0, escalated: 0, errors: 0 };
  if (!(await tasksTablesReady(executor))) return summary;
  const scope = o.workspaceIds === null ? raw("") : ucSql` AND t.workspace_id = ANY (${cast([...o.workspaceIds], "uuid[]")})`;
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT t.id, t.workspace_id, t.use_case_id, t.ref, t.status, t.holder_user_id, t.taken_at, t.last_activity_at, t.stale_asked_at, t.stale_escalated_at,
  t.last_activity_at::text AS last_activity_exact
FROM use_case_tasks t
JOIN uc_cases c ON c.portfolio_use_case_id = t.use_case_id AND c.workspace_id = t.workspace_id AND c.status NOT IN ('chiuso', 'sospeso')
WHERE t.status = 'in_corso' AND t.holder_user_id IS NOT NULL${scope}
ORDER BY t.workspace_id, t.use_case_id, t.ref
LIMIT ${cast(o.limit ?? 2000, "int")}`),
  ]);
  for (const r of rows) {
    const task = {
      status: String(r.status) as TaskStatus,
      holderUserId: String(r.holder_user_id),
      takenAt: iso(r.taken_at),
      lastActivityAt: iso(r.last_activity_at),
      staleAskedAt: iso(r.stale_asked_at),
      staleEscalatedAt: iso(r.stale_escalated_at),
    };
    const step = staleStep(task, o.now);
    if (step === "niente") continue;
    const target = { workspaceId: String(r.workspace_id), useCaseId: String(r.use_case_id) };
    const ref = String(r.ref);
    const column = step === "chiedi" ? raw("stale_asked_at") : raw("stale_escalated_at");
    // Lo stesso segnale di quando si è letto, al microsecondo (il testo di Postgres, non un Date di JS che tiene i
    // millesimi): se nel frattempo è cambiato, niente.
    const exact = r.last_activity_exact === null || r.last_activity_exact === undefined ? null : String(r.last_activity_exact);
    const still = ucSql`EXISTS (SELECT 1 FROM use_case_tasks x WHERE x.id = ${cast(String(r.id), "uuid")} AND x.status = 'in_corso'
  AND x.holder_user_id = ${cast(task.holderUserId, "uuid")} AND x.last_activity_at IS NOT DISTINCT FROM ${cast(exact, "timestamptz")})`;
    const to: TaskRecipient = step === "chiedi" ? { userId: task.holderUserId } : { roles: ["ls_lead"] };
    // Al responsabile, mai a chi ha il compito (se il compito è suo, lo sa già dalla domanda).
    const exclude = step === "chiedi" ? NOBODY : task.holderUserId;
    try {
      const results = await executor.batch([
        ...notifyTask(target, "compito_fermo", to, exclude, o.now, ref, still, { responsabile: step === "responsabile" }),
        toStatement(ucSql`UPDATE use_case_tasks SET ${column} = ${cast(o.now.toISOString(), "timestamptz")} WHERE id = ${cast(String(r.id), "uuid")} AND ${still} RETURNING id`),
      ]);
      // Conta solo se il compito era ancora quello letto (l'UPDATE ha scritto).
      if (results[results.length - 1].length === 0) continue;
      if (step === "chiedi") summary.asked++;
      else summary.escalated++;
    } catch {
      summary.errors++;
    }
  }
  return summary;
}
