import "server-only";
/**
 * La pagina «Agent Factory» di un cliente (rilascio 8.1a, docs/rilascio-8/RILASCIO-8.1-COSTRUZIONE.md §2): i casi
 * con la loro stazione, le famiglie (i repository), «Da fare per te» e la coda della fabbrica.
 *
 * - **Chi la vede (8.1a):** chi costruisce, cioè ha un ruolo di Lateral Space nel team di almeno un caso, e vede i
 *   suoi casi. I manager del workspace di Lateral Space vedono tutti i casi, in lettura. (8.0c) Anche chi costruisce da
 *   fuori Lateral Space e oggi lo può fare (il predicato unico di `use-case-builders.ts`): mai la voce per poi un 403.
 * - **«Da fare per te»:** le domande dei coding agent da decidere (a chi vede «Cosa serve»), i compiti che qualcuno del
 *   team ti chiede, i tuoi compiti fermi, i progetti che approvi tu (solo il responsabile del caso). Sono i tuoi, mai una
 *   classifica. (8.0c) «Collega Claude Code» a chi costruisce almeno un caso e non ha una CLI collegata nel workspace.
 * - **Sessioni dei coding agent:** quante, token e costo per caso; mai per persona.
 * - **(8.1b) Pull request:** quante aperte e unite per caso, e quanto passa di solito dalla presa del compito
 *   all'unione (la mediana), solo da {@link MIN_MERGED_FOR_MEDIAN} PR unite in su: con meno sarebbe il tempo di una
 *   persona. Mai per persona. In «Da fare per te» le PR pronte dei tuoi casi, tranne quelle dei
 *   tuoi compiti.
 * - **(8.2a) Evals e banco di prova:** per ogni caso le evals che fanno il suo stato (`main` prima, poi i modelli veri,
 *   poi il livello completo) e il consiglio dell'ultimo banco di ogni ruolo, letti per tutti i casi insieme
 *   (`loadEvalFacts`). In «Da fare per te», a chi costruisce il caso, il consiglio del banco e le evals di `main` sotto
 *   soglia (con i modelli veri, mai in costruzione).
 */
import type { UcExecutor } from "@/lib/db/uc-executor";
import { tasksTablesReady } from "@/lib/db/queries/use-case-tasks-notices";
import { githubStoreReady } from "@/lib/db/queries/use-case-github";
import { openProposalsCountSql, proposalsStoreReady } from "@/lib/db/queries/use-case-task-proposals";
import { cast, raw, toStatement, ucSql } from "@/lib/uc/sql/statement";
import { CASE_STATUSES, type CaseStatus } from "@/lib/uc/vocab";
import { fail, ok, type Result } from "@/lib/uc/types";
import { factoryQueue, nextStepOf, stationOf, type LineCase, type Station } from "@/lib/use-cases/factory/line";
import { pullRequestUrl } from "@/lib/use-cases/factory/github";
import { EVALS_MAIN_BRANCH, loadEvalFacts, type CaseEvalFacts } from "@/lib/db/queries/use-case-evals";
import { evalsTodoText } from "@/lib/use-cases/factory/line";
import { buildsCaseSql, caseOnlyChores, externalBuilderSql, loadBuilderScope, lsStoredBuilderSql, NO_EXTERNAL_BUILDERS, type BuilderScope } from "@/lib/db/queries/use-case-builders";
import { caseOnlyAddTodoText, caseOnlyRemoveTodoText } from "@/lib/use-cases/factory/builders-text";
import { CLI_TOKEN_PROVIDER } from "@/lib/use-cases/cli/codes";
import { ciKeysStoreReady } from "@/lib/db/queries/use-case-ci-keys";
import { CI_VERSION_WINDOW_DAYS } from "@/lib/use-cases/ci/api";

/**
 * Vero se la persona costruisce in almeno un caso del workspace (la voce «Agent Factory» nella barra): un ruolo di
 * Lateral Space nel caso, o (8.0c) da fuori Lateral Space, adesso, con il predicato unico. `lsDomains`: i domini di
 * Lateral Space (`UC_LS_EMAIL_DOMAINS`).
 */
export async function factoryNavVisible(executor: UcExecutor, input: { workspaceId: string; userId: string; lsManager: boolean; lsDomains: readonly string[] }): Promise<boolean> {
  if (input.lsManager) return true;
  try {
    const me = cast(input.userId, "uuid");
    const [rows] = await executor.batch([
      toStatement(ucSql`SELECT 1 AS ok FROM uc_cases c WHERE c.workspace_id = ${cast(input.workspaceId, "uuid")} AND ${lsStoredBuilderSql(me)} LIMIT 1`),
    ]);
    if (rows.length > 0) return true;
    const builders = await loadBuilderScope(executor, input.lsDomains);
    if (!builders.externalReady) return false;
    const [external] = await executor.batch([
      toStatement(ucSql`SELECT 1 AS ok FROM uc_cases c JOIN users u ON u.id = ${me} WHERE c.workspace_id = ${cast(input.workspaceId, "uuid")} AND ${externalBuilderSql(builders)} LIMIT 1`),
    ]);
    return external.length > 0;
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
  /**
   * (8.1b) Le PR del caso: aperte, unite, i giorni di solito dalla presa del compito all'unione, e in media costo e
   * token delle sessioni dei coding agent per PR unita (le sessioni con quella PR o con il suo compito). Tempo e spesa
   * solo da {@link MIN_MERGED_FOR_MEDIAN} PR unite in su.
   */
  prs: { open: number; merged: number; medianDays: number | null; costPerPrUsd: number | null; tokensPerPr: number | null };
  repo: string | null;
  mine: boolean;
  /** (8.2a) Le evals che fanno lo stato del caso (`main` prima, poi i modelli veri, poi il livello completo), o null. */
  evals: CaseEvalFacts["evals"];
  /** (8.2a) La lettura dell'ultimo banco di ogni ruolo, in ordine di ruolo, e se è superato. */
  benches: CaseEvalFacts["benches"];
}

export interface FactoryTodo {
  kind: "domande" | "chiesto" | "fermo" | "approva" | "rivedi" | "proposte" | "banco" | "evals" | "collega" | "togli_esterno" | "aggiungi_esterno";
  /** Vuoti per «Collega Claude Code», che è del workspace e non di un caso. */
  useCaseId: string;
  caseId: string;
  code: string;
  text: string;
  /** (8.1b) Un indirizzo fuori da Unbundle: la PR su GitHub. */
  href?: string;
}

export interface FactoryOverview {
  cases: FactoryCaseRow[];
  families: { repo: string | null; templateVersion: string | null; commonVersion: string | null; cases: FactoryCaseRow[] }[];
  todos: FactoryTodo[];
  queue: { repo: string; text: string }[];
  tasksReady: boolean;
}

/** Sotto questo numero di PR unite (con il compito preso) la mediana non si dice: sarebbe il tempo di una persona. */
export const MIN_MERGED_FOR_MEDIAN = 3;

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const statusOf = (v: unknown): CaseStatus => ((CASE_STATUSES as readonly string[]).includes(String(v)) ? (String(v) as CaseStatus) : "bozza");

/** «Collega Claude Code: nel terminale «unbundle login», poi scegli {cliente}.» */
export function connectCliTodoText(clientName: string): string {
  return `Collega Claude Code: nel terminale «unbundle login», poi scegli ${clientName.replace(/\s+/g, " ").trim() || "questo workspace"}.`;
}

/**
 * La pagina per chi guarda: con `seeAll` (manager di Lateral Space) tutti i dossier del workspace, altrimenti quelli
 * dove la persona è nel team. `canSeeNeeds`: chi vede «Cosa serve» (le domande dei coding agent da decidere).
 * `lsDomains`: i domini di Lateral Space, per dire chi costruisce da fuori (senza, nessuno).
 */
export async function loadFactoryOverview(
  executor: UcExecutor,
  input: { workspaceId: string; userId: string; seeAll: boolean; canSeeNeeds: boolean; lsDomains?: readonly string[]; caseOnly?: boolean },
): Promise<FactoryOverview> {
  const ws = cast(input.workspaceId, "uuid");
  const me = cast(input.userId, "uuid");
  const builders: BuilderScope = input.lsDomains?.length ? await loadBuilderScope(executor, input.lsDomains) : NO_EXTERNAL_BUILDERS;
  const tasksReady = await tasksTablesReady(executor);
  const githubReady = tasksReady && (await githubStoreReady(executor));
  const proposalsReady = githubReady && (await proposalsStoreReady(executor));
  const prStats = githubReady
    ? ucSql`(SELECT jsonb_build_object('open', count(*) FILTER (WHERE p.state = 'aperta'), 'merged', count(*) FILTER (WHERE p.state = 'unita'),
      'medianHours', percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (p.merged_at - t.taken_at)) / 3600)
        FILTER (WHERE p.state = 'unita' AND t.taken_at IS NOT NULL AND p.merged_at > t.taken_at),
      'timed', count(*) FILTER (WHERE p.state = 'unita' AND t.taken_at IS NOT NULL AND p.merged_at > t.taken_at))
    FROM use_case_pull_requests p LEFT JOIN use_case_tasks t ON t.id = p.task_id WHERE p.use_case_id = u.id AND p.workspace_id = u.workspace_id)`
    : raw("NULL::jsonb");
  const taskCounts = tasksReady
    ? ucSql`(SELECT jsonb_build_object('total', count(*), 'open', count(*) FILTER (WHERE t.status = 'da_fare'), 'inProgress', count(*) FILTER (WHERE t.status = 'in_corso'),
      'inReview', count(*) FILTER (WHERE t.status = 'in_revisione'), 'done', count(*) FILTER (WHERE t.status = 'fatto'), 'cancelled', count(*) FILTER (WHERE t.status = 'annullato'))
    FROM use_case_tasks t WHERE t.use_case_id = u.id AND t.workspace_id = u.workspace_id)`
    : raw("NULL::jsonb");
  // (8.1b) La spesa delle sessioni legate a una PR unita del caso: per la sua PR, o per il compito della PR.
  const prSpend = githubReady
    ? ucSql`(SELECT jsonb_build_object('cost', coalesce(sum(s.cost_usd), 0), 'tokens', coalesce(sum(s.input_tokens + s.output_tokens), 0))
    FROM use_case_build_sessions s WHERE s.use_case_id = u.id AND s.workspace_id = u.workspace_id AND (
      EXISTS (SELECT 1 FROM use_case_pull_requests m WHERE m.use_case_id = u.id AND m.state = 'unita' AND lower(s.pr_url) = lower('https://github.com/' || m.repo || '/pull/' || m.number))
      OR EXISTS (SELECT 1 FROM use_case_pull_requests m JOIN use_case_tasks mt ON mt.id = m.task_id WHERE m.use_case_id = u.id AND m.state = 'unita' AND s.task_ref = mt.ref)))`
    : raw("NULL::jsonb");
  // (8.0d) «Solo questo use case» vede solo i casi che costruisce adesso (il predicato), mai quelli dove ha solo una riga.
  const visible = input.seeAll
    ? raw("true")
    : input.caseOnly
      ? buildsCaseSql(builders, me)
      : ucSql`EXISTS (SELECT 1 FROM uc_case_members m WHERE m.case_id = c.id AND m.user_id = ${me})`;
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT u.id AS use_case_id, c.id AS case_id, coalesce(u.code, c.code) AS code, u.title, c.status AS dossier_status,
  EXISTS (SELECT 1 FROM uc_case_members m WHERE m.case_id = c.id AND m.user_id = ${me}) AS mine,
  ${buildsCaseSql(builders, me)} AS builder,
  (SELECT CASE WHEN bool_or(p.status = 'approvato') THEN 'approvato' WHEN bool_or(p.status = 'da_approvare') THEN 'da_approvare' WHEN bool_or(p.status = 'in_corso') THEN 'in_corso' END
     FROM use_case_projects p WHERE p.use_case_id = u.id AND p.workspace_id = u.workspace_id) AS project_status,
  ${taskCounts} AS tasks,
  (SELECT jsonb_build_object('count', count(*), 'tokens', coalesce(sum(s.input_tokens + s.output_tokens), 0), 'cost', coalesce(sum(s.cost_usd), 0), 'last', max(s.ended_at))
     FROM use_case_build_sessions s WHERE s.use_case_id = u.id AND s.workspace_id = u.workspace_id) AS sessions,
  ${prStats} AS prs,
  ${prSpend} AS pr_spend,
  (SELECT r.repo FROM use_case_repos r WHERE r.use_case_id = u.id AND r.workspace_id = u.workspace_id ORDER BY r.created_at LIMIT 1) AS repo
FROM uc_cases c JOIN use_cases u ON u.id = c.portfolio_use_case_id AND u.workspace_id = c.workspace_id
WHERE c.workspace_id = ${ws} AND c.setup_completed_at IS NOT NULL AND c.status <> 'chiuso' AND ${visible}
ORDER BY coalesce(u.code, c.code)`),
  ]);
  const cases: FactoryCaseRow[] = rows.map((r) => {
    const t = (r.tasks ?? {}) as Record<string, unknown>;
    const tasks = { total: num(t.total), open: num(t.open), inProgress: num(t.inProgress), inReview: num(t.inReview), done: num(t.done), cancelled: num(t.cancelled) };
    const s = (r.sessions ?? {}) as Record<string, unknown>;
    const p = (r.prs ?? {}) as Record<string, unknown>;
    const medianHours = p.medianHours === null || p.medianHours === undefined || num(p.timed) < MIN_MERGED_FOR_MEDIAN ? null : Number(p.medianHours);
    const spend = (r.pr_spend ?? {}) as Record<string, unknown>;
    const merged = num(p.merged);
    const enough = merged >= MIN_MERGED_FOR_MEDIAN;
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
      prs: {
        open: num(p.open),
        merged,
        medianDays: medianHours !== null && Number.isFinite(medianHours) ? Math.round((medianHours / 24) * 10) / 10 : null,
        costPerPrUsd: enough && num(spend.cost) > 0 ? Math.round((num(spend.cost) / merged) * 100) / 100 : null,
        tokensPerPr: enough && num(spend.tokens) > 0 ? Math.round(num(spend.tokens) / merged) : null,
      },
      repo: r.repo ? String(r.repo) : null,
      mine: r.mine === true,
      evals: null,
      benches: [],
    };
  });
  // (8.2a) Le evals e il banco di tutti i casi, in due letture.
  const builderOf = new Set(rows.filter((r) => r.builder === true).map((r) => String(r.use_case_id)));
  const evalFacts = await loadEvalFacts(executor, input.workspaceId, cases.map((c) => c.useCaseId));
  for (const c of cases) {
    const facts = evalFacts.get(c.useCaseId);
    if (!facts) continue;
    c.evals = facts.evals;
    c.benches = facts.benches;
  }

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
  const [mineRows, approveRows, questionRows, reviewRows, proposalRows, cliRows] = await executor.batch([
    tasksReady
      ? toStatement(ucSql`SELECT t.use_case_id, t.ref, t.status, (t.stale_asked_at IS NOT NULL AND t.stale_asked_at >= coalesce(t.last_activity_at, t.taken_at)) AS stale,
  (SELECT count(*) FROM use_case_task_notes n WHERE n.task_id = t.id AND n.kind = 'richiesta' AND n.created_at >= coalesce(t.taken_at, t.created_at)) AS requests
FROM use_case_tasks t WHERE t.workspace_id = ${ws} AND t.holder_user_id = ${me} AND t.status IN ('in_corso', 'in_revisione') ORDER BY t.use_case_id, substring(t.ref from 3)::int`)
      : toStatement(ucSql`SELECT NULL::uuid AS use_case_id WHERE false`),
    toStatement(ucSql`SELECT p.use_case_id FROM use_case_projects p
JOIN uc_cases c ON c.portfolio_use_case_id = p.use_case_id AND c.workspace_id = p.workspace_id
JOIN uc_case_members m ON m.case_id = c.id AND m.user_id = ${me} AND m.role = 'ls_lead'
WHERE p.workspace_id = ${ws} AND p.status = 'da_approvare'`),
    input.canSeeNeeds
      ? toStatement(ucSql`SELECT q.use_case_id, count(*) AS n FROM use_case_agent_questions q WHERE q.workspace_id = ${ws} AND q.status = 'proposta' GROUP BY q.use_case_id`)
      : toStatement(ucSql`SELECT NULL::uuid AS use_case_id, 0 AS n WHERE false`),
    // (8.1b) Le PR pronte dei casi dove costruisci (anche da fuori, 8.0c), tranne quelle dei tuoi compiti.
    githubReady
      ? toStatement(ucSql`SELECT DISTINCT p.use_case_id, p.repo, p.number, t.ref FROM use_case_pull_requests p
LEFT JOIN use_case_tasks t ON t.id = p.task_id
JOIN uc_cases c ON c.portfolio_use_case_id = p.use_case_id AND c.workspace_id = p.workspace_id
WHERE p.workspace_id = ${ws} AND p.state = 'aperta' AND NOT p.draft AND t.holder_user_id IS DISTINCT FROM ${me} AND ${buildsCaseSql(builders, me)}
ORDER BY p.use_case_id, p.number`)
      : toStatement(ucSql`SELECT NULL::uuid AS use_case_id WHERE false`),
    // (8.1b) Le proposte di compito da decidere, nei casi dove costruisci.
    proposalsReady ? openProposalsCountSql(input.workspaceId, input.userId, builders) : toStatement(ucSql`SELECT NULL::uuid AS use_case_id, 0 AS n WHERE false`),
    // (8.0c) Una CLI collegata nel workspace (viva), e il nome del cliente per «Collega Claude Code».
    toStatement(ucSql`SELECT w.name, EXISTS (SELECT 1 FROM workspace_integration_tokens t WHERE t.workspace_id = w.id AND t.owner_user_id = ${me}
    AND t.provider = ${cast(CLI_TOKEN_PROVIDER, "text")} AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > now())) AS cli
FROM workspaces w WHERE w.id = ${ws}`),
  ]);
  // (8.0c) Chi costruisce almeno un caso e non ha ancora collegato la CLI: il primo passo, prima di tutti gli altri.
  if (builderOf.size > 0 && cliRows[0] && cliRows[0].cli !== true) {
    todos.push({ kind: "collega", useCaseId: "", caseId: "", code: "", text: connectCliTodoText(String(cliRows[0].name ?? "")) });
  }
  for (const r of mineRows) {
    const c = byCase.get(String(r.use_case_id));
    if (!c) continue;
    if (num(r.requests) > 0) todos.push({ kind: "chiesto", useCaseId: c.useCaseId, caseId: c.caseId, code: c.code, text: `Qualcuno del team chiede ${r.ref}, che hai tu: passaglielo o rispondigli.` });
    if (r.stale === true) todos.push({ kind: "fermo", useCaseId: c.useCaseId, caseId: c.caseId, code: c.code, text: `${r.ref} è fermo da giorni: riprendilo con «unbundle take» o lascialo con una nota.` });
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
  for (const r of proposalRows) {
    const c = byCase.get(String(r.use_case_id));
    const n = num(r.n);
    if (c && n > 0) todos.push({ kind: "proposte", useCaseId: c.useCaseId, caseId: c.caseId, code: c.code, text: n === 1 ? "Una proposta di compito da decidere." : `${n} proposte di compito da decidere.` });
  }
  for (const r of reviewRows) {
    const c = byCase.get(String(r.use_case_id));
    if (!c) continue;
    const repo = String(r.repo);
    const number = num(r.number);
    const text = r.ref ? `La PR #${number} di ${r.ref} aspetta una revisione.` : `La PR #${number} in ${repo} aspetta una revisione.`;
    todos.push({ kind: "rivedi", useCaseId: c.useCaseId, caseId: c.caseId, code: c.code, text, href: pullRequestUrl(repo, number) });
  }
  // (8.2a) A chi costruisce il caso: il consiglio del banco, per ruolo, tranne quello di un banco superato (seguito, o il
  // ruolo non c'è più); le evals di main sotto soglia (modelli veri, mai in costruzione), come la campanella.
  for (const c of cases) {
    if (!builderOf.has(c.useCaseId)) continue;
    for (const b of c.benches) {
      if (b.verdict.kind === "cambia" && !b.superseded) todos.push({ kind: "banco", useCaseId: c.useCaseId, caseId: c.caseId, code: c.code, text: b.verdict.text });
    }
    const e = c.evals;
    if (e && !e.thresholdsMet && !e.inConstruction && !e.fakeModels && e.branch === EVALS_MAIN_BRANCH) {
      todos.push({ kind: "evals", useCaseId: c.useCaseId, caseId: c.caseId, code: c.code, text: evalsTodoText(e.quality) });
    }
  }
  // (8.0d) «Solo questo use case»: al manager «Togli …» (caso chiuso, o use case che non c'è più), al responsabile del caso
  // «Aggiungi … al team» (la riga che manca dopo l'invito). Mai a «Solo questo use case» stesso.
  if (!input.caseOnly) {
    const chores = await caseOnlyChores(executor, { workspaceId: input.workspaceId, viewerUserId: input.userId, lsManager: input.seeAll });
    for (const c of chores.remove) {
      todos.push({ kind: "togli_esterno", useCaseId: c.useCaseId ?? "", caseId: c.caseId ?? "", code: "", text: caseOnlyRemoveTodoText(c.name, c.code) });
    }
    for (const c of chores.add) {
      if (c.code && c.caseId && c.useCaseId) todos.push({ kind: "aggiungi_esterno", useCaseId: c.useCaseId, caseId: c.caseId, code: "", text: caseOnlyAddTodoText(c.name, c.code) });
    }
  }
  return { cases, families, todos, queue, tasksReady };
}

const SEMVER = /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/;

/**
 * (8.2b) Vero, nell'aggiornamento di una riga di `use_case_factory_repos`, se la CI ha mandato evals di main per un caso
 * del repository negli ultimi `CI_VERSION_WINDOW_DAYS` giorni: la versione del modello allora la dice main. Legge la
 * fonte delle evals: solo con la 0042 pronta.
 */
const CI_VERSION_FROM_MAIN_SQL = ucSql`EXISTS (SELECT 1 FROM use_case_eval_runs e
  JOIN use_case_repos rr ON rr.use_case_id = e.use_case_id AND rr.workspace_id = e.workspace_id
  WHERE e.workspace_id = use_case_factory_repos.workspace_id AND lower(rr.repo) = lower(use_case_factory_repos.repo)
    AND e.source = 'ci' AND e.branch = ${cast(EVALS_MAIN_BRANCH, "text")} AND e.template_version IS NOT NULL
    AND e.created_at > now() - make_interval(days => ${cast(CI_VERSION_WINDOW_DAYS, "int")}))`;

/**
 * La versione del modello (e del comune) di un repository della fabbrica, come la dice `unbundle start`. Il
 * repository dev'essere registrato per lo use case del token: un caso dice la versione solo del suo repository.
 * (8.2b) Se la CI manda le evals di main del repository (negli ultimi `CI_VERSION_WINDOW_DAYS` giorni), la versione
 * del modello la dice main (`recordEvalRun` dalla CI): quella detta dal computer di una persona, magari da un ramo, non
 * la cambia; la versione del comune sì (la CI non la manda).
 */
export async function reportRepoVersion(
  executor: UcExecutor,
  input: { workspaceId: string; useCaseId: string; repo: string; templateVersion: unknown; commonVersion?: unknown },
): Promise<Result<{ repo: string }>> {
  const template = typeof input.templateVersion === "string" && SEMVER.test(input.templateVersion) ? input.templateVersion : null;
  const common = typeof input.commonVersion === "string" && SEMVER.test(input.commonVersion) ? input.commonVersion : null;
  if (!template) return fail("dati_non_validi", "versioneModello: come 1.3.0.");
  if (!(await tasksTablesReady(executor))) return fail("non_disponibile", "Non ancora disponibile: riprova tra qualche minuto.");
  const fromMain = (await ciKeysStoreReady(executor)) ? CI_VERSION_FROM_MAIN_SQL : raw("false");
  const ws = cast(input.workspaceId, "uuid");
  const [rows] = await executor.batch([
    toStatement(ucSql`INSERT INTO use_case_factory_repos (workspace_id, repo, kind, template_version, common_version, reported_at)
SELECT ${ws}, r.repo, 'famiglia', ${cast(template, "text")}, ${cast(common, "text")}, now()
FROM use_case_repos r WHERE r.workspace_id = ${ws} AND r.use_case_id = ${cast(input.useCaseId, "uuid")} AND lower(r.repo) = lower(${cast(input.repo, "text")})
LIMIT 1
ON CONFLICT (workspace_id, repo) DO UPDATE SET
  template_version = CASE WHEN ${fromMain} THEN use_case_factory_repos.template_version ELSE EXCLUDED.template_version END,
  common_version = coalesce(EXCLUDED.common_version, use_case_factory_repos.common_version),
  reported_at = CASE WHEN ${fromMain} THEN use_case_factory_repos.reported_at ELSE now() END, updated_at = now()
RETURNING repo`),
  ]);
  if (!rows[0]) return fail("non_trovato", "Il repository non è registrato per questo caso: «unbundle repo create».");
  return ok({ repo: String(rows[0].repo) });
}
