import "server-only";
/**
 * La pagina «Agent Factory» di un cliente (rilascio 8.1a, docs/rilascio-8/RILASCIO-8.1-COSTRUZIONE.md §2): i casi
 * con la loro stazione, le famiglie (i repository), «Da fare per te» e la coda della fabbrica.
 *
 * - **Chi la vede (8.1a):** chi costruisce, cioè ha un ruolo di Lateral Space nel team di almeno un caso, e vede i
 *   suoi casi. I manager del workspace di Lateral Space vedono tutti i casi, in lettura. Il cliente arriva con la 8.0c.
 * - **«Da fare per te»:** le domande dei coding agent da decidere (a chi vede «Cosa serve»), i compiti che un collega
 *   ti chiede, i tuoi compiti fermi, i progetti che approvi tu. Sono i tuoi, mai una classifica.
 * - **Sessioni dei coding agent:** quante, token e costo per caso; mai per persona.
 */
import type { UcExecutor } from "@/lib/db/uc-executor";
import { tasksTablesReady } from "@/lib/db/queries/use-case-tasks-notices";
import { cast, raw, toStatement, ucSql } from "@/lib/uc/sql/statement";
import { CASE_STATUSES, type CaseStatus } from "@/lib/uc/vocab";
import { fail, ok, type Result } from "@/lib/uc/types";
import { factoryQueue, nextStepOf, stationOf, type LineCase, type Station } from "@/lib/use-cases/factory/line";

const LS_CASE_ROLES_SQL = raw("('ls_lead', 'ls_analista', 'ls_sviluppatore')");

/** Vero se la persona costruisce in almeno un caso del workspace (la voce «Agent Factory» nella barra). */
export async function factoryNavVisible(executor: UcExecutor, input: { workspaceId: string; userId: string; lsManager: boolean }): Promise<boolean> {
  if (input.lsManager) return true;
  try {
    const [rows] = await executor.batch([
      toStatement(ucSql`SELECT 1 AS ok FROM uc_case_members m JOIN uc_cases c ON c.id = m.case_id
WHERE c.workspace_id = ${cast(input.workspaceId, "uuid")} AND m.user_id = ${cast(input.userId, "uuid")} AND m.role IN ${LS_CASE_ROLES_SQL} LIMIT 1`),
    ]);
    return rows.length > 0;
  } catch {
    return false;
  }
}

export interface FactoryCaseRow {
  useCaseId: string;
  caseId: string;
  code: string;
  title: string;
  station: Station;
  nextStep: string;
  tasks: LineCase["tasks"];
  sessions: { count: number; tokens: number; costUsd: number; lastAt: string | null };
  repo: string | null;
  mine: boolean;
}

export interface FactoryTodo {
  kind: "domande" | "chiesto" | "fermo" | "approva";
  useCaseId: string;
  caseId: string;
  code: string;
  text: string;
}

export interface FactoryOverview {
  cases: FactoryCaseRow[];
  families: { repo: string | null; templateVersion: string | null; commonVersion: string | null; cases: FactoryCaseRow[] }[];
  todos: FactoryTodo[];
  queue: { repo: string; text: string }[];
  tasksReady: boolean;
}

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const statusOf = (v: unknown): CaseStatus => ((CASE_STATUSES as readonly string[]).includes(String(v)) ? (String(v) as CaseStatus) : "bozza");

/**
 * La pagina per chi guarda: con `seeAll` (manager di Lateral Space) tutti i dossier del workspace, altrimenti quelli
 * dove la persona è nel team. `canSeeNeeds`: chi vede «Cosa serve» (le domande dei coding agent da decidere).
 */
export async function loadFactoryOverview(executor: UcExecutor, input: { workspaceId: string; userId: string; seeAll: boolean; canSeeNeeds: boolean }): Promise<FactoryOverview> {
  const ws = cast(input.workspaceId, "uuid");
  const me = cast(input.userId, "uuid");
  const tasksReady = await tasksTablesReady(executor);
  const taskCounts = tasksReady
    ? ucSql`(SELECT jsonb_build_object('total', count(*), 'open', count(*) FILTER (WHERE t.status = 'da_fare'), 'inProgress', count(*) FILTER (WHERE t.status = 'in_corso'),
      'inReview', count(*) FILTER (WHERE t.status = 'in_revisione'), 'done', count(*) FILTER (WHERE t.status = 'fatto'), 'cancelled', count(*) FILTER (WHERE t.status = 'annullato'))
    FROM use_case_tasks t WHERE t.use_case_id = u.id AND t.workspace_id = u.workspace_id)`
    : raw("NULL::jsonb");
  const visible = input.seeAll ? raw("true") : ucSql`EXISTS (SELECT 1 FROM uc_case_members m WHERE m.case_id = c.id AND m.user_id = ${me})`;
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT u.id AS use_case_id, c.id AS case_id, coalesce(u.code, c.code) AS code, u.title, c.status AS dossier_status,
  EXISTS (SELECT 1 FROM uc_case_members m WHERE m.case_id = c.id AND m.user_id = ${me}) AS mine,
  (SELECT CASE WHEN bool_or(p.status = 'approvato') THEN 'approvato' WHEN bool_or(p.status = 'da_approvare') THEN 'da_approvare' WHEN bool_or(p.status = 'in_corso') THEN 'in_corso' END
     FROM use_case_projects p WHERE p.use_case_id = u.id AND p.workspace_id = u.workspace_id) AS project_status,
  ${taskCounts} AS tasks,
  (SELECT jsonb_build_object('count', count(*), 'tokens', coalesce(sum(s.input_tokens + s.output_tokens), 0), 'cost', coalesce(sum(s.cost_usd), 0), 'last', max(s.ended_at))
     FROM use_case_build_sessions s WHERE s.use_case_id = u.id AND s.workspace_id = u.workspace_id) AS sessions,
  (SELECT r.repo FROM use_case_repos r WHERE r.use_case_id = u.id AND r.workspace_id = u.workspace_id ORDER BY r.created_at LIMIT 1) AS repo
FROM uc_cases c JOIN use_cases u ON u.id = c.portfolio_use_case_id AND u.workspace_id = c.workspace_id
WHERE c.workspace_id = ${ws} AND c.setup_completed_at IS NOT NULL AND c.status <> 'chiuso' AND ${visible}
ORDER BY coalesce(u.code, c.code)`),
  ]);
  const cases: FactoryCaseRow[] = rows.map((r) => {
    const t = (r.tasks ?? {}) as Record<string, unknown>;
    const tasks = { total: num(t.total), open: num(t.open), inProgress: num(t.inProgress), inReview: num(t.inReview), done: num(t.done), cancelled: num(t.cancelled) };
    const s = (r.sessions ?? {}) as Record<string, unknown>;
    const projectStatus = r.project_status === "approvato" || r.project_status === "da_approvare" || r.project_status === "in_corso" ? r.project_status : null;
    const line: LineCase = { dossierStatus: statusOf(r.dossier_status), projectStatus, tasks };
    return {
      useCaseId: String(r.use_case_id),
      caseId: String(r.case_id),
      code: String(r.code ?? ""),
      title: String(r.title ?? ""),
      station: stationOf(line),
      nextStep: nextStepOf(line),
      tasks,
      sessions: { count: num(s.count), tokens: num(s.tokens), costUsd: num(s.cost), lastAt: s.last ? new Date(String(s.last)).toISOString() : null },
      repo: r.repo ? String(r.repo) : null,
      mine: r.mine === true,
    };
  });

  const [repoRows] = await executor.batch([
    tasksReady
      ? toStatement(ucSql`SELECT repo, template_version, common_version FROM use_case_factory_repos WHERE workspace_id = ${ws} AND kind = 'famiglia'`)
      : toStatement(ucSql`SELECT NULL::text AS repo, NULL::text AS template_version, NULL::text AS common_version WHERE false`),
  ]);
  const versions = new Map(repoRows.map((r) => [String(r.repo).toLowerCase(), { template: r.template_version ? String(r.template_version) : null, common: r.common_version ? String(r.common_version) : null }]));
  const byRepo = new Map<string | null, FactoryCaseRow[]>();
  for (const c of cases) byRepo.set(c.repo, [...(byRepo.get(c.repo) ?? []), c]);
  const families = [...byRepo.entries()]
    .map(([repo, list]) => {
      const v = repo ? versions.get(repo.toLowerCase()) : undefined;
      return { repo, templateVersion: v?.template ?? null, commonVersion: v?.common ?? null, cases: list };
    })
    .sort((a, b) => (a.repo === null ? 1 : b.repo === null ? -1 : a.repo.localeCompare(b.repo)));
  const queue = factoryQueue(families.filter((f) => f.repo !== null).map((f) => ({ repo: f.repo as string, templateVersion: f.templateVersion })));

  // «Da fare per te»: solo le cose della persona.
  const todos: FactoryTodo[] = [];
  const byCase = new Map(cases.map((c) => [c.useCaseId, c]));
  const [mineRows, approveRows, questionRows] = await executor.batch([
    tasksReady
      ? toStatement(ucSql`SELECT t.use_case_id, t.ref, t.status, (t.stale_asked_at IS NOT NULL AND t.stale_asked_at >= coalesce(t.last_activity_at, t.taken_at)) AS stale,
  (SELECT count(*) FROM use_case_task_notes n WHERE n.task_id = t.id AND n.kind = 'richiesta' AND n.created_at >= coalesce(t.taken_at, t.created_at)) AS requests
FROM use_case_tasks t WHERE t.workspace_id = ${ws} AND t.holder_user_id = ${me} AND t.status IN ('in_corso', 'in_revisione') ORDER BY t.ref`)
      : toStatement(ucSql`SELECT NULL::uuid AS use_case_id WHERE false`),
    toStatement(ucSql`SELECT p.use_case_id FROM use_case_projects p
JOIN uc_cases c ON c.portfolio_use_case_id = p.use_case_id AND c.workspace_id = p.workspace_id
JOIN uc_case_members m ON m.case_id = c.id AND m.user_id = ${me} AND m.role = 'ls_lead'
WHERE p.workspace_id = ${ws} AND p.status = 'da_approvare'`),
    input.canSeeNeeds
      ? toStatement(ucSql`SELECT q.use_case_id, count(*) AS n FROM use_case_agent_questions q WHERE q.workspace_id = ${ws} AND q.status = 'proposta' GROUP BY q.use_case_id`)
      : toStatement(ucSql`SELECT NULL::uuid AS use_case_id, 0 AS n WHERE false`),
  ]);
  for (const r of mineRows) {
    const c = byCase.get(String(r.use_case_id));
    if (!c) continue;
    if (num(r.requests) > 0) todos.push({ kind: "chiesto", useCaseId: c.useCaseId, caseId: c.caseId, code: c.code, text: `Un collega chiede ${r.ref}, che hai tu: passaglielo o rispondigli.` });
    if (r.stale === true) todos.push({ kind: "fermo", useCaseId: c.useCaseId, caseId: c.caseId, code: c.code, text: `${r.ref} è fermo da giorni: riprendilo o lascialo con una nota.` });
  }
  for (const r of approveRows) {
    const c = byCase.get(String(r.use_case_id));
    if (c) todos.push({ kind: "approva", useCaseId: c.useCaseId, caseId: c.caseId, code: c.code, text: "Il progetto aspetta la tua approvazione." });
  }
  for (const r of questionRows) {
    const c = byCase.get(String(r.use_case_id));
    const n = num(r.n);
    if (c && n > 0) todos.push({ kind: "domande", useCaseId: c.useCaseId, caseId: c.caseId, code: c.code, text: n === 1 ? "Un coding agent propone una domanda: decidila in «Cosa serve»." : `${n} domande proposte dai coding agent da decidere in «Cosa serve».` });
  }
  return { cases, families, todos, queue, tasksReady };
}

const SEMVER = /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/;

/**
 * La versione del modello (e del comune) di un repository della fabbrica, come la dice `unbundle start`. Il
 * repository dev'essere già registrato per uno use case del workspace.
 */
export async function reportRepoVersion(executor: UcExecutor, input: { workspaceId: string; repo: string; templateVersion: unknown; commonVersion?: unknown }): Promise<Result<{ repo: string }>> {
  const template = typeof input.templateVersion === "string" && SEMVER.test(input.templateVersion) ? input.templateVersion : null;
  const common = typeof input.commonVersion === "string" && SEMVER.test(input.commonVersion) ? input.commonVersion : null;
  if (!template) return fail("dati_non_validi", "versioneModello: come 1.3.0.");
  if (!(await tasksTablesReady(executor))) return fail("non_disponibile", "Non ancora disponibile: riprova tra qualche minuto.");
  const ws = cast(input.workspaceId, "uuid");
  const [rows] = await executor.batch([
    toStatement(ucSql`INSERT INTO use_case_factory_repos (workspace_id, repo, kind, template_version, common_version, reported_at)
SELECT ${ws}, r.repo, 'famiglia', ${cast(template, "text")}, ${cast(common, "text")}, now()
FROM use_case_repos r WHERE r.workspace_id = ${ws} AND lower(r.repo) = lower(${cast(input.repo, "text")})
LIMIT 1
ON CONFLICT (workspace_id, repo) DO UPDATE SET template_version = EXCLUDED.template_version, common_version = coalesce(EXCLUDED.common_version, use_case_factory_repos.common_version),
  reported_at = now(), updated_at = now()
RETURNING repo`),
  ]);
  if (!rows[0]) return fail("non_trovato", "Il repository non è registrato in questo workspace: «unbundle repo create».");
  return ok({ repo: String(rows[0].repo) });
}
