import "server-only";
/**
 * Gli eventi di GitHub nei compiti (rilascio 8.1b, docs/rilascio-8/RILASCIO-8.1-COSTRUZIONE.md §2, 8.1b).
 *
 * `applyGithubEvent`, dopo che il webhook ha controllato la firma:
 * - **Il caso:** il repository dev'essere registrato per uno use case (`unbundle repo create`) e il ramo dev'essere di
 *   quel caso (`<id>/…`). Altrimenti l'evento si registra come «ignorato» e non cambia niente.
 * - **Una PR:** si salva (numero, ramo, stato, bozza, date; mai chi l'ha aperta). Se il ramo è di un compito
 *   (`<id>/t-<n>`):
 *   - aperta e non in bozza → il compito va in revisione;
 *   - unita → il compito è fatto;
 *   - chiusa senza unirla, o tornata in bozza → torna in corso (da fare, se nessuno lo ha), se non ha altre PR pronte.
 *   Un compito fatto o annullato non cambia più. Una PR unita resta unita, una chiusa si riapre solo con «reopened»
 *   (GitHub può consegnare gli eventi fuori ordine).
 *   - Quando una PR diventa pronta, campanella ed e-mail a chi costruisce il caso, tranne chi ha il compito.
 * - **Un push** sul ramo di un compito in corso o in revisione è un segnale di vita (come `unbundle take`).
 * - **Una proposta** (un'issue aperta, o un commento `/compito`): il caso è quello della PR commentata, o quello il cui
 *   codice è nel titolo o nelle etichette, o l'unico del repository. Il titolo passa il controllo dei testi del team.
 *   Diventa una proposta da decidere (`use-case-task-proposals.ts`), mai un compito da sola.
 * - **Una volta sola:** l'id della consegna sta in `use_case_github_deliveries`, nella stessa transazione degli
 *   effetti; se c'è già, l'evento non conta di nuovo («ripetuto»).
 * - **Un repository tolto nel mezzo** (`use-case-admin repo-unregister`, che prende lo stesso lock dei compiti): una PR,
 *   un push o una proposta che avevano già letto il caso non scrivono niente, se alla transazione la registrazione non
 *   c'è più.
 *
 * Nessuna lettura qui raggruppa, conta o ordina per persona (art. 15.4).
 */
import type { UcExecutor } from "@/lib/db/uc-executor";
import { GITHUB_PROBE_SQL, type GithubDeliveryOutcome } from "@/lib/db/use-case-hub-github-ddl";
import { checkLsText } from "@/lib/db/queries/uc-cases";
import { scanPayload } from "@/lib/uc/text/scan";
import { proposalsStoreReady, proposalStatements } from "@/lib/db/queries/use-case-task-proposals";
import { TASKS_PROBE_SQL } from "@/lib/db/use-case-hub-tasks-ddl";
import { tasksLock } from "@/lib/db/queries/use-case-tasks";
import { NOBODY, notifyTask } from "@/lib/db/queries/use-case-tasks-notices";
import { loadBuilderScope, NO_EXTERNAL_BUILDERS, type BuilderScope } from "@/lib/db/queries/use-case-builders";
import { ucLsDomains } from "@/lib/db/queries/uc-access";
import { cast, raw, toStatement, ucSql, type SqlFragment, type UcStatement } from "@/lib/uc/sql/statement";
import { caseCodeFromBranch, GITHUB_DELIVERY_RE, proposalUrl, pullRequestUrl, taskRefOfBranch, type GithubEvent } from "@/lib/use-cases/factory/github";
import { byUseCaseId, taskAfterPullRequestSql } from "@/lib/use-cases/factory/pull-request-sql";

/** Vero se la 0032 e la 0033 sono applicate. */
export async function githubStoreReady(executor: UcExecutor): Promise<boolean> {
  try {
    const [rows] = await executor.batch([toStatement(ucSql`SELECT (${raw(TASKS_PROBE_SQL)} AND ${raw(GITHUB_PROBE_SQL)}) AS ready`)]);
    return rows[0]?.ready === true;
  } catch {
    return false;
  }
}

export type GithubApplyResult =
  | { esito: "non_disponibile" }
  | { esito: "ripetuto" }
  | { esito: "ignorato"; motivo: string }
  | { esito: "applicato"; casi: { workspaceId: string; useCaseId: string; caseId: string | null; compito: string | null; stato: string | null }[] };

interface Target {
  workspaceId: string;
  useCaseId: string;
  caseId: string | null;
  code: string;
  /** Lo stato del dossier (null senza dossier). */
  dossierStatus: string | null;
}

interface TaskNow {
  id: string;
  ref: string;
  holderUserId: string | null;
}

/** I casi registrati per il repository, uno per use case. */
async function targetsOfRepo(executor: UcExecutor, repo: string): Promise<Target[]> {
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT DISTINCT r.workspace_id, r.use_case_id, c.id AS case_id, c.status AS dossier_status, coalesce(u.code, c.code) AS code
FROM use_case_repos r
JOIN use_cases u ON u.id = r.use_case_id AND u.workspace_id = r.workspace_id
LEFT JOIN uc_cases c ON c.portfolio_use_case_id = u.id AND c.workspace_id = u.workspace_id
WHERE lower(r.repo) = lower(${cast(repo, "text")})`),
  ]);
  const seen = new Set<string>();
  const out: Target[] = [];
  for (const r of rows) {
    const key = `${r.workspace_id}:${r.use_case_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      workspaceId: String(r.workspace_id),
      useCaseId: String(r.use_case_id),
      caseId: r.case_id ? String(r.case_id) : null,
      code: String(r.code ?? ""),
      dossierStatus: r.dossier_status ? String(r.dossier_status) : null,
    });
  }
  return out;
}

/** I casi del repository con il codice del ramo: di solito uno. */
async function targetsFor(executor: UcExecutor, repo: string, caseCode: string): Promise<Target[]> {
  return (await targetsOfRepo(executor, repo)).filter((t) => t.code.toLowerCase() === caseCode);
}

/**
 * Il caso di una proposta, tra quelli del repository con un dossier aperto: quello della PR commentata, o quello con
 * il codice nel titolo o nelle etichette, o l'unico. Un codice che non è di nessuno di questi casi, o casi di workspace
 * diversi senza un codice che decida: non è chiaro, e non si propone niente.
 */
async function proposalTarget(executor: UcExecutor, e: Extract<GithubEvent, { kind: "proposta" }>): Promise<Target | "nessuno" | "non_chiaro"> {
  const targets = (await targetsOfRepo(executor, e.repo)).filter((t) => t.caseId !== null && t.dossierStatus !== "chiuso");
  if (targets.length === 0) return "nessuno";
  // Lo stesso repository registrato in workspace diversi: solo la PR commentata decide (un titolo non sposta mai una
  // proposta nel workspace di un altro cliente).
  const spansWorkspaces = new Set(targets.map((t) => t.workspaceId)).size > 1;
  if (e.onPullRequest) {
    const [rows] = await executor.batch([
      toStatement(ucSql`SELECT DISTINCT use_case_id FROM use_case_pull_requests WHERE repo = ${cast(e.repo, "text")} AND number = ${cast(e.number, "int")}`),
    ]);
    const ofPr = targets.filter((t) => rows.some((r) => String(r.use_case_id) === t.useCaseId));
    if (ofPr.length === 1) return ofPr[0];
  }
  if (spansWorkspaces) return "non_chiaro";
  const named = targets.filter((t) => t.code && e.caseCodes.includes(t.code.toUpperCase()));
  if (named.length === 1) return named[0];
  if (named.length === 0 && e.caseCodes.length === 0 && targets.length === 1) return targets[0];
  return "non_chiaro";
}

/**
 * Il titolo di una proposta arriva da GitHub, scritto da chiunque abbia accesso al repository, e nessuno lo rilegge
 * prima di salvarlo: oltre al controllo dei testi del team, niente contatti (e-mail, telefono) e niente `@persona`.
 */
export function proposalTitleAllowed(title: string): boolean {
  if (!checkLsText({ titolo: title }).ok) return false;
  const scan = scanPayload({ titolo: title }, { context: "testo_ls" });
  if (scan.truncated || scan.warnings.some((w) => w.category === "contatto")) return false;
  return !/(^|[\s(\[])@[A-Za-z0-9][A-Za-z0-9-]{0,38}\b/.test(title);
}

/** Una proposta di compito da un'issue o da un commento `/compito`. */
async function applyProposal(executor: UcExecutor, deliveryId: string, event: string, e: Extract<GithubEvent, { kind: "proposta" }>): Promise<GithubApplyResult> {
  if (!(await proposalsStoreReady(executor))) return { esito: "non_disponibile" };
  const target = await proposalTarget(executor, e);
  if (target === "nessuno") return ignore(executor, deliveryId, event, e.repo, "repository_non_registrato");
  if (target === "non_chiaro") return ignore(executor, deliveryId, event, e.repo, "caso_non_chiaro");
  if (!proposalTitleAllowed(e.title)) return ignore(executor, deliveryId, event, e.repo, "testo_non_ammesso");
  const externalKey = `gh:${e.repo.toLowerCase()}#${e.number}${e.commentId ? `:c${e.commentId}` : ""}`;
  const builders = await loadBuilderScope(executor, ucLsDomains());
  // Come una PR: prima il lock dei compiti dello use case (quello di `use-case-admin repo-unregister`), poi la proposta
  // solo se il repository è ancora del caso, riletto nella transazione. Altrimenti una proposta arrivata mentre
  // l'operatore toglie il repository resterebbe da decidere, dopo che lo script ha tolto quelle di quel repository.
  const live = ucSql`(${freshSql(deliveryId)} AND ${stillRegisteredSql(target, e.repo)})`;
  const results = await executor.batch([
    tasksLock(target),
    deliveryInsert(deliveryId, event, e.repo, "applicato"),
    ...proposalStatements(target, { source: "github", externalKey, title: e.title, link: proposalUrl(e.repo, e.number, e.commentId) }, live, builders),
  ]);
  if (results[1].length === 0) return { esito: "ripetuto" };
  return { esito: "applicato", casi: [{ workspaceId: target.workspaceId, useCaseId: target.useCaseId, caseId: target.caseId, compito: null, stato: "proposta" }] };
}

async function taskFor(executor: UcExecutor, t: Target, ref: string | null): Promise<TaskNow | null> {
  if (!ref) return null;
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT id, ref, holder_user_id FROM use_case_tasks
WHERE workspace_id = ${cast(t.workspaceId, "uuid")} AND use_case_id = ${cast(t.useCaseId, "uuid")} AND ref = ${cast(ref, "text")}`),
  ]);
  const r = rows[0];
  return r ? { id: String(r.id), ref: String(r.ref), holderUserId: r.holder_user_id ? String(r.holder_user_id) : null } : null;
}

const deliveryInsert = (deliveryId: string, event: string, repo: string | null, outcome: GithubDeliveryOutcome) =>
  toStatement(ucSql`INSERT INTO use_case_github_deliveries (delivery_id, event, repo, outcome)
VALUES (${cast(deliveryId, "text")}, ${cast(event, "text")}, ${cast(repo, "text")}, ${cast(outcome, "text")})
ON CONFLICT (delivery_id) DO NOTHING RETURNING delivery_id`);

/** Vero solo nella transazione che ha appena registrato la consegna (`now()` è lo stesso in tutta la transazione). */
const freshSql = (deliveryId: string): SqlFragment =>
  ucSql`EXISTS (SELECT 1 FROM use_case_github_deliveries d WHERE d.delivery_id = ${cast(deliveryId, "text")} AND d.received_at = now())`;

/**
 * Vero se il repository è ancora registrato per lo use case, letto nella transazione degli effetti (dopo il lock dei
 * compiti). I casi si leggono prima, fuori dalla transazione: nel mezzo `use-case-admin repo-unregister` può aver tolto
 * la registrazione e chiuso le PR aperte, e una PR scritta dopo resterebbe aperta per sempre (gli eventi di dopo si
 * ignorano); una proposta scritta dopo resterebbe da decidere, anche se lo script toglie quelle di quel repository.
 */
const stillRegisteredSql = (t: Target, repo: string): SqlFragment =>
  ucSql`EXISTS (SELECT 1 FROM use_case_repos gr WHERE gr.workspace_id = ${cast(t.workspaceId, "uuid")} AND gr.use_case_id = ${cast(t.useCaseId, "uuid")}
    AND lower(gr.repo) = lower(${cast(repo, "text")}))`;

/** Registra un evento che non riguarda nessun caso. */
async function ignore(executor: UcExecutor, deliveryId: string, event: string, repo: string | null, motivo: string): Promise<GithubApplyResult> {
  const [rows] = await executor.batch([deliveryInsert(deliveryId, event, repo, "ignorato")]);
  return rows.length ? { esito: "ignorato", motivo } : { esito: "ripetuto" };
}

/** Gli statement di una PR per un caso: la PR, il compito, la notifica. */
function prStatements(t: Target, task: TaskNow | null, e: Extract<GithubEvent, { kind: "pr" }>, fresh: SqlFragment, builders: BuilderScope): UcStatement[] {
  const ws = cast(t.workspaceId, "uuid");
  const uc = cast(t.useCaseId, "uuid");
  const repo = cast(e.repo, "text");
  const number = cast(e.number, "int");
  const incoming = cast(e.state, "text");
  // Un evento più vecchio di quello già applicato (GitHub consegna fuori ordine, o qualcuno rimanda un corpo vecchio)
  // non cambia stato né bozza.
  const stale = ucSql`(EXCLUDED.gh_updated_at IS NOT NULL AND p.gh_updated_at IS NOT NULL AND EXCLUDED.gh_updated_at < p.gh_updated_at)`;
  // Lo stato che resta: unita resta unita; un evento vecchio non cambia niente; chiusa si riapre solo con «reopened».
  const nextState = ucSql`CASE WHEN p.state = 'unita' THEN 'unita'
    WHEN ${stale} THEN p.state
    WHEN p.state = 'chiusa' AND ${incoming} = 'aperta' AND NOT ${cast(e.reopened, "boolean")} THEN 'chiusa'
    ELSE ${incoming} END`;
  const nextDraft = ucSql`CASE WHEN ${stale} OR p.state = 'unita' THEN p.draft ELSE EXCLUDED.draft END`;
  const merged = cast(e.mergedAt, "timestamptz");
  const closed = cast(e.closedAt, "timestamptz");
  const taskId = task ? cast(task.id, "uuid") : raw("NULL::uuid");
  const out: UcStatement[] = [
    toStatement(ucSql`INSERT INTO use_case_pull_requests AS p (use_case_id, workspace_id, task_id, repo, number, branch, state, draft, opened_at, merged_at, closed_at, gh_updated_at, changed_at)
SELECT ${uc}, ${ws}, ${taskId}, ${repo}, ${number}, ${cast(e.branch, "text")}, ${incoming}, ${cast(e.draft, "boolean")},
  coalesce(${cast(e.openedAt, "timestamptz")}, now()), CASE WHEN ${incoming} = 'unita' THEN coalesce(${merged}, now()) END, ${closed},
  ${cast(e.updatedAt, "timestamptz")}, now()
WHERE ${fresh}
ON CONFLICT (workspace_id, repo, number) DO UPDATE SET
  task_id = coalesce(p.task_id, EXCLUDED.task_id),
  state = ${nextState},
  draft = ${nextDraft},
  merged_at = CASE WHEN (${nextState}) = 'unita' THEN coalesce(p.merged_at, EXCLUDED.merged_at, now()) END,
  closed_at = CASE WHEN (${nextState}) = 'aperta' THEN NULL WHEN ${stale} THEN p.closed_at ELSE coalesce(EXCLUDED.closed_at, p.closed_at) END,
  gh_updated_at = greatest(p.gh_updated_at, EXCLUDED.gh_updated_at),
  -- Solo quando stato o bozza cambiano davvero, o il compito si lega adesso, il compito si muove (changed_at = now()).
  changed_at = CASE WHEN (${nextState}) IS DISTINCT FROM p.state OR (${nextDraft}) IS DISTINCT FROM p.draft
    OR (p.task_id IS NULL AND EXCLUDED.task_id IS NOT NULL) THEN now() ELSE p.changed_at END,
  updated_at = now()
WHERE p.use_case_id = EXCLUDED.use_case_id`),
  ];
  if (task) {
    // Il compito dopo la PR scritta qui sopra: la regola sta in `taskAfterPullRequestSql`, la stessa di
    // `use-case-admin repo-unregister` quando chiude le PR aperte di un repository tolto.
    out.push(
      taskAfterPullRequestSql({
        match: ucSql`p.workspace_id = ${ws} AND p.repo = ${repo} AND p.number = ${number} AND p.use_case_id = ${uc}
  AND t.id = ${cast(task.id, "uuid")} AND ${fresh}`,
        url: cast(pullRequestUrl(e.repo, e.number), "text"),
        signal: e.signal,
      }),
    );
  }
  if (e.ready) {
    // Al team che costruisce, tranne chi ha il compito adesso (letto nella stessa transazione); solo se questo evento ha
    // reso la PR pronta.
    const stillReady = ucSql`(${fresh} AND EXISTS (SELECT 1 FROM use_case_pull_requests p WHERE p.workspace_id = ${ws} AND p.repo = ${repo} AND p.number = ${number}
  AND p.use_case_id = ${uc} AND p.state = 'aperta' AND NOT p.draft AND p.changed_at = now()))`;
    const holder = task ? ucSql`(SELECT x.holder_user_id FROM use_case_tasks x WHERE x.id = ${cast(task.id, "uuid")})` : NOBODY;
    out.push(
      ...notifyTask({ workspaceId: t.workspaceId, useCaseId: t.useCaseId }, "pr_da_rivedere", { builders }, holder, new Date(), task?.ref ?? null, stillReady, {
        pr: e.number,
        repo: e.repo,
      }),
    );
  }
  return out;
}

/** Il segnale di vita di un push: il compito del ramo, se è in corso o in revisione. */
function pushStatements(task: TaskNow | null, fresh: SqlFragment): UcStatement[] {
  if (!task) return [];
  return [
    toStatement(ucSql`UPDATE use_case_tasks SET last_activity_at = now()
WHERE id = ${cast(task.id, "uuid")} AND status IN ('in_corso', 'in_revisione') AND ${fresh}`),
  ];
}

/**
 * Applica un evento già firmato. `deliveryId`: l'header `X-GitHub-Delivery`; `event`: `X-GitHub-Event`.
 */
export async function applyGithubEvent(executor: UcExecutor, input: { deliveryId: string; event: string; parsed: GithubEvent }): Promise<GithubApplyResult> {
  if (!GITHUB_DELIVERY_RE.test(input.deliveryId)) throw new Error("delivery id non valido");
  if (!(await githubStoreReady(executor))) return { esito: "non_disponibile" };
  const e = input.parsed;
  if (e.kind === "ping") return ignore(executor, input.deliveryId, input.event, null, "ping");
  if (e.kind === "altro") return ignore(executor, input.deliveryId, input.event, e.repo, e.reason);
  if (e.kind === "proposta") return applyProposal(executor, input.deliveryId, input.event, e);
  const code = caseCodeFromBranch(e.branch);
  if (!code) return ignore(executor, input.deliveryId, input.event, e.repo, "ramo_senza_caso");
  const targets = await targetsFor(executor, e.repo, code);
  if (targets.length === 0) return ignore(executor, input.deliveryId, input.event, e.repo, "repository_non_registrato");

  const fresh = freshSql(input.deliveryId);
  // (8.0c) A chi costruisce il caso adesso, anche da fuori Lateral Space: l'ambito si legge una volta per evento.
  const builders = e.kind === "pr" && e.ready ? await loadBuilderScope(executor, ucLsDomains()) : null;
  const plan: { target: Target; task: TaskNow | null; statements: UcStatement[] }[] = [];
  for (const t of targets) {
    const task = await taskFor(executor, t, taskRefOfBranch(e.branch, t.code));
    // Gli effetti contano solo per una consegna nuova e solo se il repository è ancora del caso (`stillRegisteredSql`).
    const live = ucSql`(${fresh} AND ${stillRegisteredSql(t, e.repo)})`;
    plan.push({ target: t, task, statements: e.kind === "pr" ? prStatements(t, task, e, live, builders ?? NO_EXTERNAL_BUILDERS) : pushStatements(task, live) });
  }
  // Un lock per use case, sempre nello stesso ordine; poi la consegna; poi gli effetti, solo se la consegna è nuova.
  const locks = [...plan].sort((a, b) => byUseCaseId(a.target.useCaseId, b.target.useCaseId)).map((p) => tasksLock(p.target));
  const statements = [...locks, deliveryInsert(input.deliveryId, input.event, e.repo, "applicato"), ...plan.flatMap((p) => p.statements)];
  const results = await executor.batch(statements);
  if (results[locks.length].length === 0) return { esito: "ripetuto" };

  // Lo stato del compito dopo l'evento (dal RETURNING dell'UPDATE del compito, se c'è).
  let cursor = locks.length + 1;
  const casi = plan.map((p) => {
    const rows = results.slice(cursor, cursor + p.statements.length);
    cursor += p.statements.length;
    const updated = e.kind === "pr" && p.task ? rows[1] : null;
    return {
      workspaceId: p.target.workspaceId,
      useCaseId: p.target.useCaseId,
      caseId: p.target.caseId,
      compito: p.task?.ref ?? null,
      stato: updated && updated[0] ? String(updated[0].status) : null,
    };
  });
  return { esito: "applicato", casi };
}
