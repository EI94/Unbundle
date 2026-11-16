/**
 * `use-case-admin repo-unregister --workspace <id> --repo owner/nome [--use-case <codice>] [--apply …]` (rilascio 8.0c,
 * RILASCIO-8.0c-ESTERNI.md §12): toglie la registrazione di un repository dai casi di un workspace. Serve quando un
 * repository è registrato per sbaglio (il caso o la cartella sbagliati, un repository che non è del cliente): il webhook
 * di GitHub cerca i casi per repository, e finché la registrazione c'è le issue, i commenti `/compito` e le pull request
 * di quel repository arrivano a quei casi.
 *
 * **Solo Lateral Space, e per questo uno script dell'operatore e non un comando della CLI:** lo lancia chi ha
 * `USE_CASE_ADMIN_DATABASE_URL`, cioè solo l'operatore di Lateral Space; la CLI la usano anche le persone che
 * costruiscono da fuori, e un comando lì sarebbe una rotta in più da proteggere per un'operazione rara. Lo script è a
 * secco se non si chiede `--apply`, vuole le conferme dell'operatore (`--confirm-authorized`, il database, l'ambiente e in
 * produzione `--production-approved`) e stampa il piano prima di scrivere.
 *
 * Con `--apply`, in una transazione:
 * 1. le proposte di compito ancora da decidere che vengono da quel repository, negli use case toccati: sono arrivate solo
 *    perché il repository era registrato lì (anche i titoli di un repository che non era del cliente);
 * 2. le pull request aperte di quel repository negli use case toccati si segnano chiuse, e i loro compiti si muovono come
 *    con una chiusura arrivata da GitHub (`taskAfterPullRequestSql`, la stessa regola del webhook): un compito in
 *    revisione torna in corso (da fare, se nessuno lo ha), se non ha un'altra pull request pronta. Senza questo
 *    resterebbero «da rivedere» per sempre: la chiusura vera, dopo, si ignora. Sotto il lock dei compiti di ogni use
 *    case toccato, preso per primo e nello stesso ordine del webhook;
 * 3. le registrazioni (`use_case_repos`): tutte quelle del workspace per quel repository, o solo quelle dello use case;
 * 4. la versione del modello del repository (`use_case_factory_repos`), se nel workspace non resta nessun caso con quel
 *    repository.
 * Le pull request già unite o chiuse e le proposte già decise restano: sono la storia dei casi. Gli eventi che arrivano
 * dopo da quel repository si ignorano («repository_non_registrato»). GitHub non si tocca: lì le pull request e gli
 * accessi si chiudono a mano.
 *
 * Modulo puro: import relativi `.ts`. Nell'uscita solo codici dei casi, cartelle e conteggi: mai nomi, e-mail o titoli.
 */
import { cast, raw, ref, toStatement, ucSql, type SqlFragment, type UcStatement } from "../../uc/sql/statement.ts";
import { byUseCaseId, taskAfterPullRequestSql, tasksLockOfUseCaseSql } from "../factory/pull-request-sql.ts";

export const REPO_UNREGISTER_OPTIONS = Object.freeze({ values: Object.freeze(["repo", "use-case"]) as readonly string[] });

/**
 * Le tabelle che il comando usa: i repository dei casi (0031); le proposte (0034), le versioni (0032) e le pull request
 * con i loro compiti (0033), se ci sono.
 */
export const REPO_UNREGISTER_SCHEMA_SQL = `SELECT to_regclass('public.use_case_repos') IS NOT NULL AS ok,
  to_regclass('public.use_case_task_proposals') IS NOT NULL AS proposals,
  to_regclass('public.use_case_factory_repos') IS NOT NULL AS factory_repos,
  (to_regclass('public.use_case_pull_requests') IS NOT NULL AND to_regclass('public.use_case_tasks') IS NOT NULL) AS pull_requests`;

export const REPO_UNREGISTER_SCHEMA_MESSAGE = "Manca la tabella dei repository dei casi (drizzle/0031): non c'è niente da togliere.";

export const REPO_UNREGISTER_NOTE =
  "Le pull request aperte di questo repository si segnano chiuse, e i loro compiti in revisione tornano in corso (da fare, se nessuno li ha). Le pull request già unite o chiuse e le proposte già decise restano. Gli eventi che arrivano dopo da questo repository si ignorano. Su GitHub non cambia niente: lì le pull request e gli accessi si chiudono a mano.";

const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const CODE_RE = /^[A-Z]{2,4}-[0-9]{4,5}$/;

/** `--repo`: `owner/nome` come lo registra la CLI; `.git` alla fine si toglie. null se non vale. */
export function parseRepoOption(value: string | null): string | null {
  const repo = (value ?? "").trim().replace(/\.git$/i, "");
  return REPO_RE.test(repo) ? repo : null;
}

/** `--use-case`: il codice di uno use case (NM-0009), in maiuscolo. null se non vale. */
export function parseUseCaseCode(value: string | null): string | null {
  const code = (value ?? "").trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

/** I link di GitHub che vengono da quel repository: `https://github.com/<owner>/<nome>/…`, in minuscolo. */
const linkPrefix = (repo: string) => `https://github.com/${repo.toLowerCase()}/`;

export interface RepoRegistration {
  id: string;
  useCaseId: string;
  code: string;
  folder: string;
}

/** Le letture prima del piano: le registrazioni del repository nel workspace (o nello use case). */
export function repoUnregisterReads(workspaceId: string, repo: string, useCaseCode: string | null): { registrations: UcStatement } {
  const ws = cast(workspaceId, "uuid");
  const scope = useCaseCode === null ? ucSql`true` : ucSql`upper(u.code) = ${cast(useCaseCode, "text")}`;
  return {
    registrations: toStatement(ucSql`SELECT r.id, r.use_case_id, coalesce(u.code, '') AS code, r.folder
FROM use_case_repos r JOIN use_cases u ON u.id = r.use_case_id AND u.workspace_id = r.workspace_id
WHERE r.workspace_id = ${ws} AND lower(r.repo) = lower(${cast(repo, "text")}) AND ${scope}
ORDER BY u.code NULLS LAST, r.folder, r.id`),
  };
}

/** Quante proposte da decidere vengono dal repository negli use case toccati (solo con la tabella delle proposte). */
export function pendingProposalsSql(workspaceId: string, repo: string, useCaseIds: readonly string[]): UcStatement {
  return toStatement(ucSql`SELECT count(*)::int AS n FROM use_case_task_proposals p
WHERE p.workspace_id = ${cast(workspaceId, "uuid")} AND p.use_case_id = ANY (${cast([...useCaseIds], "uuid[]")}) AND p.status = 'proposta'
  AND starts_with(lower(coalesce(p.link, '')), ${cast(linkPrefix(repo), "text")})`);
}

/** Le pull request (alias `alias`) di quel repository negli use case toccati, senza badare alle maiuscole del nome. */
function pullRequestsOfRepo(alias: string, workspaceId: string, repo: string, useCaseIds: readonly string[]): SqlFragment {
  const p = ref(alias);
  return ucSql`${p}.workspace_id = ${cast(workspaceId, "uuid")} AND lower(${p}.repo) = lower(${cast(repo, "text")}) AND ${p}.use_case_id = ANY (${cast([...useCaseIds], "uuid[]")})`;
}

/**
 * Per il piano: quante pull request aperte ha il repository negli use case toccati (`n`), e quanti compiti in revisione
 * sono legati a quelle (`tasks`). Solo con le tabelle della 0033.
 */
export function openPullRequestsSql(workspaceId: string, repo: string, useCaseIds: readonly string[]): UcStatement {
  return toStatement(ucSql`SELECT count(*)::int AS n, count(DISTINCT t.id)::int AS tasks
FROM use_case_pull_requests p LEFT JOIN use_case_tasks t ON t.id = p.task_id AND t.status = 'in_revisione'
WHERE ${pullRequestsOfRepo("p", workspaceId, repo, useCaseIds)} AND p.state = 'aperta'`);
}

/** Quante registrazioni del repository restano nel workspace, tolte queste. */
export function remainingRegistrationsSql(workspaceId: string, repo: string, ids: readonly string[]): UcStatement {
  return toStatement(ucSql`SELECT count(*)::int AS n FROM use_case_repos r
WHERE r.workspace_id = ${cast(workspaceId, "uuid")} AND lower(r.repo) = lower(${cast(repo, "text")}) AND r.id <> ALL (${cast([...ids], "uuid[]")})`);
}

export interface RepoUnregisterFacts {
  workspaceId: string;
  repo: string;
  registrations: readonly RepoRegistration[];
  /** Le tabelle che ci sono. */
  tables: { proposals: boolean; factoryRepos: boolean; pullRequests: boolean };
  /** Le proposte da decidere che vengono dal repository negli use case toccati. */
  pendingProposals: number;
  /** Le pull request aperte del repository negli use case toccati, e i compiti in revisione legati a quelle. */
  openPullRequests: number;
  tasksInReview: number;
  /** Le registrazioni del repository che restano nel workspace. */
  remaining: number;
}

export interface RepoUnregisterPlan {
  statements: UcStatement[];
  /** Dove stanno, tra i risultati della transazione, le righe per `repoUnregisterOutcome` (null senza la 0033). */
  at: { inReview: number; closed: number; tasks: number } | null;
  report: {
    repository: string;
    casi: { caso: string; cartella: string }[];
    proposteDaTogliere: number;
    prDaChiudere: number;
    compitiInRevisione: number;
    restanoNelWorkspace: number;
    nota: string;
  };
}

/** Il piano: gli statement nell'ordine, in una transazione, e un riepilogo senza dati delle persone. */
export function repoUnregisterPlan(i: RepoUnregisterFacts): RepoUnregisterPlan {
  const ws = cast(i.workspaceId, "uuid");
  const repo = cast(i.repo, "text");
  const ids = cast(i.registrations.map((r) => r.id), "uuid[]");
  const touched = [...new Set(i.registrations.map((r) => r.useCaseId))];
  const useCaseIds = cast(touched, "uuid[]");
  const statements: UcStatement[] = [];
  let at: RepoUnregisterPlan["at"] = null;
  // Prima di ogni scrittura, i lock dei compiti degli use case toccati, nell'ordine del webhook di GitHub: un evento di
  // quel repository che arriva adesso aspetta, e poi non trova più la registrazione.
  if (i.tables.pullRequests) statements.push(...[...touched].sort(byUseCaseId).map(tasksLockOfUseCaseSql));
  if (i.tables.proposals) {
    statements.push(
      toStatement(ucSql`DELETE FROM use_case_task_proposals p WHERE p.workspace_id = ${ws} AND p.use_case_id = ANY (${useCaseIds}) AND p.status = 'proposta'
  AND starts_with(lower(coalesce(p.link, '')), ${cast(linkPrefix(i.repo), "text")})`),
    );
  }
  if (i.tables.pullRequests) {
    const ofRepo = pullRequestsOfRepo("p", i.workspaceId, i.repo, touched);
    at = { inReview: statements.length, closed: statements.length + 1, tasks: statements.length + 2 };
    statements.push(
      // I compiti in revisione legati alle pull request aperte, prima di chiuderle: per dire dopo quanti sono tornati.
      toStatement(ucSql`SELECT DISTINCT t.id FROM use_case_pull_requests p JOIN use_case_tasks t ON t.id = p.task_id AND t.status = 'in_revisione'
WHERE ${ofRepo} AND p.state = 'aperta'`),
      // Chiuse adesso (`changed_at = now()`), come le scrive una chiusura arrivata da GitHub; `gh_updated_at` resta l'ora
      // di GitHub dell'ultimo evento applicato.
      toStatement(ucSql`UPDATE use_case_pull_requests p SET state = 'chiusa', closed_at = now(), changed_at = now(), updated_at = now()
WHERE ${ofRepo} AND p.state = 'aperta'
RETURNING p.id`),
      // I compiti di quelle pull request, con la regola del webhook. Una PR chiusa non scrive `pr_url`: resta com'è. Due
      // PR dello stesso compito chiuse qui danno lo stesso esito, quale che sia quella che l'UPDATE prende.
      taskAfterPullRequestSql({ match: ucSql`${ofRepo} AND p.state = 'chiusa' AND p.changed_at = now() AND t.id = p.task_id`, url: raw("t.pr_url"), signal: false }),
    );
  }
  statements.push(toStatement(ucSql`DELETE FROM use_case_repos r WHERE r.workspace_id = ${ws} AND r.id = ANY (${ids})`));
  if (i.tables.factoryRepos) {
    statements.push(
      toStatement(ucSql`DELETE FROM use_case_factory_repos f WHERE f.workspace_id = ${ws} AND lower(f.repo) = lower(${repo})
  AND NOT EXISTS (SELECT 1 FROM use_case_repos r WHERE r.workspace_id = ${ws} AND lower(r.repo) = lower(${repo}))`),
    );
  }
  return {
    statements,
    at,
    report: {
      repository: i.repo,
      casi: i.registrations.map((r) => ({ caso: r.code || "senza codice", cartella: r.folder })),
      proposteDaTogliere: i.tables.proposals ? i.pendingProposals : 0,
      prDaChiudere: i.tables.pullRequests ? i.openPullRequests : 0,
      compitiInRevisione: i.tables.pullRequests ? i.tasksInReview : 0,
      restanoNelWorkspace: i.remaining,
      nota: REPO_UNREGISTER_NOTE,
    },
  };
}

/**
 * Dopo `--apply`, dai risultati della transazione: le pull request chiuse davvero e i compiti che erano in revisione e
 * non lo sono più (uno con un'altra pull request pronta resta in revisione). Solo conteggi.
 */
export function repoUnregisterOutcome(plan: RepoUnregisterPlan, results: readonly (readonly Record<string, unknown>[])[]): { prChiuse: number; compitiTornati: number } {
  if (!plan.at) return { prChiuse: 0, compitiTornati: 0 };
  const inReview = new Set((results[plan.at.inReview] ?? []).map((r) => String(r.id)));
  const back = (results[plan.at.tasks] ?? []).filter((r) => inReview.has(String(r.id)) && r.status !== "in_revisione");
  return { prChiuse: (results[plan.at.closed] ?? []).length, compitiTornati: back.length };
}
