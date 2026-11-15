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
 * 2. le registrazioni (`use_case_repos`): tutte quelle del workspace per quel repository, o solo quelle dello use case;
 * 3. la versione del modello del repository (`use_case_factory_repos`), se nel workspace non resta nessun caso con quel
 *    repository.
 * Le pull request già salvate e le proposte già decise restano: sono la storia dei casi. Gli eventi che arrivano dopo da
 * quel repository si ignorano («repository_non_registrato»). GitHub non si tocca: gli accessi si tolgono a mano.
 *
 * Modulo puro: import relativi `.ts`. Nell'uscita solo codici dei casi, cartelle e conteggi: mai nomi, e-mail o titoli.
 */
import { cast, toStatement, ucSql, type UcStatement } from "../../uc/sql/statement.ts";

export const REPO_UNREGISTER_OPTIONS = Object.freeze({ values: Object.freeze(["repo", "use-case"]) as readonly string[] });

/** Le tabelle che il comando usa: i repository dei casi (0031); le proposte (0034) e le versioni (0032), se ci sono. */
export const REPO_UNREGISTER_SCHEMA_SQL = `SELECT to_regclass('public.use_case_repos') IS NOT NULL AS ok,
  to_regclass('public.use_case_task_proposals') IS NOT NULL AS proposals,
  to_regclass('public.use_case_factory_repos') IS NOT NULL AS factory_repos`;

export const REPO_UNREGISTER_SCHEMA_MESSAGE = "Manca la tabella dei repository dei casi (drizzle/0031): non c'è niente da togliere.";

export const REPO_UNREGISTER_NOTE =
  "Le pull request già salvate e le proposte già decise restano. Gli eventi che arrivano dopo da questo repository si ignorano. Su GitHub gli accessi si tolgono a mano.";

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
  tables: { proposals: boolean; factoryRepos: boolean };
  /** Le proposte da decidere che vengono dal repository negli use case toccati. */
  pendingProposals: number;
  /** Le registrazioni del repository che restano nel workspace. */
  remaining: number;
}

export interface RepoUnregisterPlan {
  statements: UcStatement[];
  report: { repository: string; casi: { caso: string; cartella: string }[]; proposteDaTogliere: number; restanoNelWorkspace: number; nota: string };
}

/** Il piano: gli statement nell'ordine, in una transazione, e un riepilogo senza dati delle persone. */
export function repoUnregisterPlan(i: RepoUnregisterFacts): RepoUnregisterPlan {
  const ws = cast(i.workspaceId, "uuid");
  const repo = cast(i.repo, "text");
  const ids = cast(i.registrations.map((r) => r.id), "uuid[]");
  const useCaseIds = cast([...new Set(i.registrations.map((r) => r.useCaseId))], "uuid[]");
  const statements: UcStatement[] = [];
  if (i.tables.proposals) {
    statements.push(
      toStatement(ucSql`DELETE FROM use_case_task_proposals p WHERE p.workspace_id = ${ws} AND p.use_case_id = ANY (${useCaseIds}) AND p.status = 'proposta'
  AND starts_with(lower(coalesce(p.link, '')), ${cast(linkPrefix(i.repo), "text")})`),
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
    report: {
      repository: i.repo,
      casi: i.registrations.map((r) => ({ caso: r.code || "senza codice", cartella: r.folder })),
      proposteDaTogliere: i.tables.proposals ? i.pendingProposals : 0,
      restanoNelWorkspace: i.remaining,
      nota: REPO_UNREGISTER_NOTE,
    },
  };
}
