import "server-only";
/**
 * Le proposte di compito (rilascio 8.1b, docs/rilascio-8/RILASCIO-8.1-COSTRUZIONE.md §2, 8.1b).
 *
 * - **Da dove:** un'issue di GitHub, o un commento `/compito`, nel repository di un caso (il webhook, con
 *   `proposalStatements`); più avanti da Slack. Il titolo passa lo stesso controllo dei testi del team (`checkLsText`).
 * - **Chi decide:** una persona che costruisce il caso (dalla 8.0c anche da fuori Lateral Space). «Accetta» fa nascere
 *   il compito T-n (da prendere, con la sorgente della proposta); «Scarta» la chiude. Una proposta si decide una volta sola.
 * - **Avvisi:** una proposta nuova va al team che costruisce (campanella ed e-mail, una al giorno per caso); un
 *   compito nato da una proposta dice «ci sono compiti da prendere», tranne a chi l'ha accettata.
 *
 * Mai chi propone o chi decide (art. 15.4).
 */
import type { UcExecutor } from "@/lib/db/uc-executor";
import type { FactoryTarget } from "@/lib/db/queries/use-case-factory";
import { PROPOSALS_PROBE_SQL, PROPOSAL_LIMITS, type ProposalSource, type ProposalStatus } from "@/lib/db/use-case-hub-proposals-ddl";
import { projectApproved, projectVersionSql, tasksLock } from "@/lib/db/queries/use-case-tasks";
import { NOBODY, notifyTask } from "@/lib/db/queries/use-case-tasks-notices";
import { buildsCaseSql, loadBuilderScope, type BuilderScope } from "@/lib/db/queries/use-case-builders";
import { ucLsDomains } from "@/lib/db/queries/uc-access";
import { cast, raw, toStatement, ucSql, type SqlFragment, type UcStatement } from "@/lib/uc/sql/statement";
import { fail, ok, type Result } from "@/lib/uc/types";
import { cutText } from "@/lib/use-cases/factory/github";

/** Le proposte aperte di un caso, al massimo: oltre, le nuove non si registrano (un repository pubblico non intasa). */
export const OPEN_PROPOSALS_MAX = 50;

/** Vero se la 0034 è applicata. */
export async function proposalsStoreReady(executor: UcExecutor): Promise<boolean> {
  try {
    const [rows] = await executor.batch([toStatement(ucSql`SELECT ${raw(PROPOSALS_PROBE_SQL)} AS ready`)]);
    return rows[0]?.ready === true;
  } catch {
    return false;
  }
}

export interface ProposalView {
  id: string;
  source: ProposalSource;
  title: string;
  area: string | null;
  link: string | null;
  existingRef: string | null;
  status: ProposalStatus;
  createdAt: string;
}

/** Le proposte da decidere dello use case, dalla più vecchia. */
export async function listOpenProposals(executor: UcExecutor, target: FactoryTarget): Promise<ProposalView[]> {
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT p.id, p.source, p.title, p.area, p.link, p.status, p.created_at, t.ref AS existing_ref
FROM use_case_task_proposals p LEFT JOIN use_case_tasks t ON t.id = p.existing_task_id
WHERE p.workspace_id = ${cast(target.workspaceId, "uuid")} AND p.use_case_id = ${cast(target.useCaseId, "uuid")} AND p.status = 'proposta'
ORDER BY p.created_at, p.id
LIMIT 100`),
  ]);
  return rows.map((r) => ({
    id: String(r.id),
    source: String(r.source) as ProposalSource,
    title: String(r.title),
    area: r.area ? String(r.area) : null,
    link: r.link ? String(r.link) : null,
    existingRef: r.existing_ref ? String(r.existing_ref) : null,
    status: String(r.status) as ProposalStatus,
    createdAt: new Date(String(r.created_at)).toISOString(),
  }));
}

/**
 * Gli statement di una proposta nuova: la riga (una per origine, `ON CONFLICT DO NOTHING`) e l'avviso a chi costruisce il
 * caso (`builders`, letto da chi chiama), solo se la riga è nata in questa transazione. `when`: una condizione in più (la
 * consegna di GitHub è nuova).
 */
export function proposalStatements(
  target: FactoryTarget,
  input: { source: ProposalSource; externalKey: string; title: string; area?: string | null; link: string | null },
  when: SqlFragment,
  builders: BuilderScope,
): UcStatement[] {
  const ws = cast(target.workspaceId, "uuid");
  const uc = cast(target.useCaseId, "uuid");
  const key = cast(input.externalKey.slice(0, PROPOSAL_LIMITS.externalKey), "text");
  const created = ucSql`EXISTS (SELECT 1 FROM use_case_task_proposals x WHERE x.use_case_id = ${uc} AND x.external_key = ${key} AND x.created_at = now())`;
  return [
    toStatement(ucSql`INSERT INTO use_case_task_proposals (use_case_id, workspace_id, source, external_key, title, area, link)
SELECT ${uc}, ${ws}, ${cast(input.source, "text")}, ${key}, ${cast(cutText(input.title.trim(), PROPOSAL_LIMITS.title), "text")},
  ${cast(input.area ? cutText(input.area, PROPOSAL_LIMITS.area) : null, "text")}, ${cast(input.link, "text")}
WHERE ${when}
  AND (SELECT count(*) FROM use_case_task_proposals o WHERE o.use_case_id = ${uc} AND o.status = 'proposta') < ${cast(OPEN_PROPOSALS_MAX, "int")}
ON CONFLICT (use_case_id, external_key) DO NOTHING`),
    ...notifyTask(target, "compito_proposto", { builders }, NOBODY, new Date(), null, created),
  ];
}

/**
 * «Accetta» o «Scarta». Lo controlla chi chiama: una persona del team che costruisce. Accettata, nasce il compito con
 * il numero dopo l'ultimo, da prendere; il team (tranne chi decide) sa che ci sono compiti da prendere.
 */
export async function decideProposal(
  executor: UcExecutor,
  target: FactoryTarget,
  input: { id: unknown; decision: unknown; actorId: string },
): Promise<Result<{ ref: string | null }>> {
  const id = typeof input.id === "string" && /^[0-9a-f-]{36}$/i.test(input.id) ? input.id : null;
  if (!id) return fail("dati_non_validi", "Proposta non valida.");
  if (input.decision !== "accetta" && input.decision !== "scarta") return fail("dati_non_validi", "Si accetta o si scarta.");
  if (!(await proposalsStoreReady(executor))) return fail("non_disponibile", "Le proposte non sono ancora disponibili: riprova tra qualche minuto.");
  const ws = cast(target.workspaceId, "uuid");
  const uc = cast(target.useCaseId, "uuid");
  const pid = cast(id, "uuid");
  const decide = (status: ProposalStatus) =>
    toStatement(ucSql`UPDATE use_case_task_proposals SET status = ${cast(status, "text")}, decided_at = now(), updated_at = now()
WHERE id = ${pid} AND workspace_id = ${ws} AND use_case_id = ${uc} AND status = 'proposta'
RETURNING id`);
  if (input.decision === "accetta" && !(await projectApproved(executor, target))) {
    return fail("progetto_non_approvato", "Il progetto non è ancora approvato: le proposte diventano compiti dopo l'approvazione. Intanto si possono scartare.");
  }
  if (input.decision === "scarta") {
    const [rows] = await executor.batch([decide("scartata")]);
    return rows[0] ? ok({ ref: null }) : fail("conflitto", "Questa proposta è già stata decisa.");
  }
  const accepted = ucSql`EXISTS (SELECT 1 FROM use_case_task_proposals p WHERE p.id = ${pid} AND p.status = 'accettata' AND p.decided_at = now())`;
  const builders = await loadBuilderScope(executor, ucLsDomains());
  const results = await executor.batch([
    tasksLock(target),
    decide("accettata"),
    toStatement(ucSql`INSERT INTO use_case_tasks (use_case_id, workspace_id, ref, title, areas, status, source, project_version)
SELECT ${uc}, ${ws}, 'T-' || (coalesce((SELECT max(substring(ref from 3)::int) FROM use_case_tasks WHERE use_case_id = ${uc}), 0) + 1),
  p.title, CASE WHEN p.area IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(p.area) END, 'da_fare', p.source, ${projectVersionSql(target)}
FROM use_case_task_proposals p WHERE p.id = ${pid} AND ${accepted}
RETURNING id, ref`),
    toStatement(ucSql`UPDATE use_case_task_proposals p SET task_id = (SELECT t.id FROM use_case_tasks t WHERE t.use_case_id = ${uc} AND t.created_at = now() ORDER BY t.created_at DESC, t.id LIMIT 1)
WHERE p.id = ${pid} AND ${accepted}`),
    ...notifyTask(target, "compiti_pronti", { builders }, input.actorId, new Date(), null, accepted),
  ]);
  const task = results[2][0];
  if (!results[1][0] || !task) return fail("conflitto", "Questa proposta è già stata decisa.");
  return ok({ ref: String(task.ref) });
}

/**
 * Quante proposte da decidere per use case, nei casi dove la persona costruisce adesso («Da fare per te»): con un ruolo
 * di Lateral Space, o (8.0c) da fuori, con il predicato unico.
 */
export function openProposalsCountSql(workspaceId: string, userId: string, builders: BuilderScope): UcStatement {
  return toStatement(ucSql`SELECT p.use_case_id, count(*) AS n FROM use_case_task_proposals p
WHERE p.workspace_id = ${cast(workspaceId, "uuid")} AND p.status = 'proposta'
  AND EXISTS (SELECT 1 FROM uc_cases c
    WHERE c.portfolio_use_case_id = p.use_case_id AND c.workspace_id = p.workspace_id AND ${buildsCaseSql(builders, cast(userId, "uuid"))})
GROUP BY p.use_case_id`);
}
