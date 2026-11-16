import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

// `use-case-admin repo-unregister` (rilascio 8.0c) sul database del pacchetto: lo script gira in un processo figlio, come
// lo lancia l'operatore di Lateral Space, con `USE_CASE_ADMIN_DATABASE_URL` e il trasporto locale
// (scripts/uc-test/local-neon.cjs). A secco non scrive niente; con `--apply` toglie le registrazioni del repository (o
// solo quella di uno use case), le proposte da decidere che ne sono arrivate e la versione del repository quando non
// resta nessun caso; le proposte già decise, quelle di altri repository e gli altri workspace non cambiano; dopo, un
// evento di GitHub di quel repository si ignora. Le pull request aperte di quel repository si chiudono, e i loro compiti
// si muovono come con una chiusura arrivata da GitHub. L'uscita non ha nomi né e-mail.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su 127.0.0.1). Dati
//   sintetici, creati e cancellati qui.
const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) throw new Error("Hub DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  if (!/^\/hub_[a-z0-9][a-z0-9_]{0,39}$/.test(parsed.pathname)) throw new Error("Run this suite only on a package database hub_<id>");
}
const opts = { skip: !enabled };

type Row = Record<string, unknown>;
let q: (text: string, params?: unknown[]) => Promise<Row[]>;
let exec: import("../../db/uc-executor.ts").UcExecutor;
let github: typeof import("../../db/queries/use-case-github.ts");

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const parsedUrl = enabled ? new URL(url!) : null;
const port = parsedUrl?.port ?? "";
const packageDb = parsedUrl?.pathname.slice(1) ?? "";
const suffix = randomBytes(3).toString("hex");
const REPO = `Prova/famiglia-${suffix}`;
const OTHER = `Prova/altro-${suffix}`;
const ids = { org: randomUUID(), wsA: randomUUID(), wsB: randomUUID(), uc1: randomUUID(), uc2: randomUUID(), ucB: randomUUID(), lead: randomUUID(), template: randomUUID(), case1: randomUUID() };

interface AdminRun {
  status: number;
  docs: Row[];
  last: Row;
  stdout: string;
}

/** Lo script come lo lancia l'operatore: solo le variabili che servono, `DATABASE_URL` come trappola verso un altro database. */
function runAdmin(args: string[]): AdminRun {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "/private/tmp",
    UC_TEST_DATABASE_URL: url!,
    UC_TEST_PG_PORT: port,
    UC_TEST_PG_DB: packageDb,
    USE_CASE_ADMIN_DATABASE_URL: url!,
    DATABASE_URL: `postgresql://uc_test@127.0.0.1:${port}/hub_trappola_r80c`,
  };
  const result = spawnSync(process.execPath, ["--no-warnings", "--require", "./scripts/uc-test/local-neon.cjs", "scripts/use-case-admin.ts", "repo-unregister", ...args], {
    cwd: ROOT,
    env: env as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
    timeout: 120_000,
  });
  const docs = result.stdout
    .split(/^\}$/m)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => JSON.parse(`${chunk}\n}`) as Row);
  return { status: result.status ?? -1, docs, last: docs.at(-1) ?? {}, stdout: result.stdout };
}

const confirm = ["--apply", "--confirm-authorized", "--confirm-database", `127.0.0.1:${port}/${packageDb}`, "--environment", "local"];

const registrations = async () =>
  (await q(`SELECT r.workspace_id, u.code, r.folder FROM use_case_repos r JOIN use_cases u ON u.id = r.use_case_id WHERE lower(r.repo) = lower($1) ORDER BY u.code`, [REPO])).map(
    (r) => `${r.workspace_id === ids.wsA ? "A" : "B"}:${r.code}`,
  );
const proposals = async () =>
  (await q(`SELECT external_key, status FROM use_case_task_proposals WHERE workspace_id = ANY($1::uuid[]) AND external_key LIKE 'prova-%' ORDER BY external_key`, [[ids.wsA, ids.wsB]])).map(
    (r) => `${String(r.external_key).slice(6)}:${r.status}`,
  );
const titled = async (title: string) => Number((await q(`SELECT count(*)::int AS n FROM use_case_task_proposals WHERE workspace_id = $1 AND title = $2`, [ids.wsA, title]))[0].n);
const versions = async () => (await q(`SELECT workspace_id FROM use_case_factory_repos WHERE lower(repo) = lower($1)`, [REPO])).map((r) => (r.workspace_id === ids.wsA ? "A" : "B")).sort();

/** Le pull request dei due repository nei due workspace: `A:REPO#11:aperta`. */
const prs = async () =>
  (await q(`SELECT workspace_id, repo, number, state FROM use_case_pull_requests WHERE workspace_id = ANY($1::uuid[]) ORDER BY workspace_id = $2 DESC, repo = $3 DESC, number`, [[ids.wsA, ids.wsB], ids.wsA, REPO])).map(
    (r) => `${r.workspace_id === ids.wsA ? "A" : "B"}:${r.repo === REPO ? "REPO" : "OTHER"}#${r.number}:${r.state}`,
  );
/** I compiti: `NR-0001 T-1:in_revisione:suo` (di chi lo ha) o `:libero`. */
const tasks = async () =>
  (await q(`SELECT u.code, t.ref, t.status, t.holder_user_id FROM use_case_tasks t JOIN use_cases u ON u.id = t.use_case_id WHERE t.workspace_id = ANY($1::uuid[]) ORDER BY u.code, t.ref`, [[ids.wsA, ids.wsB]])).map(
    (r) => `${r.code} ${r.ref}:${r.status}:${r.holder_user_id ? "suo" : "libero"}`,
  );

/** «Da fare per te» di chi costruisce NR-0001: le pull request che aspettano una revisione. */
async function reviewTodos(): Promise<string[]> {
  const line = await import("../../db/queries/use-case-factory-line.ts");
  const overview = await line.loadFactoryOverview(exec, { workspaceId: ids.wsA, userId: ids.lead, seeAll: false, canSeeNeeds: true, lsDomains: ["ls.test"] });
  return overview.todos.filter((todo) => todo.kind === "rivedi").map((todo) => todo.text);
}

let clock = Date.now();
/** Un evento di una pull request, come lo legge il webhook dopo la firma. Senza la campanella (`ready: false`). */
function prEvent(i: { repo?: string; number: number; branch: string; state?: "aperta" | "chiusa" | "unita"; draft?: boolean; action?: string }, executor = exec) {
  const at = new Date((clock += 1000)).toISOString();
  const state = i.state ?? "aperta";
  return github.applyGithubEvent(executor, {
    deliveryId: `repo-${suffix}-${i.repo === OTHER ? "o" : "r"}${i.number}-${state}-${clock}`,
    event: "pull_request",
    parsed: {
      kind: "pr",
      repo: i.repo ?? REPO,
      number: i.number,
      branch: i.branch,
      state,
      draft: i.draft === true,
      openedAt: at,
      mergedAt: state === "unita" ? at : null,
      closedAt: state === "aperta" ? null : at,
      updatedAt: at,
      action: i.action ?? (state === "aperta" ? "opened" : "closed"),
      reopened: false,
      signal: state === "aperta",
      ready: false,
    },
  });
}

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  await (await import("../../db/ensure-schema.ts")).ensureDbSchema();
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova repository', $2)`, [ids.org, `org-repo-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $3, 'Cliente A di prova repository'), ($2, $3, 'Cliente B di prova repository')`, [ids.wsA, ids.wsB, ids.org]);
  await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, 'Lucia Guida', now())`, [ids.lead, `lead-repo-${suffix}@ls.test`]);
  await q(`INSERT INTO use_cases (id, workspace_id, title, code) VALUES ($1, $4, 'Esploso di prova', 'NR-0001'), ($2, $4, 'Ricambi di prova', 'NR-0002'), ($3, $5, 'Quotazioni di prova', 'TR-0001')`, [
    ids.uc1,
    ids.uc2,
    ids.ucB,
    ids.wsA,
    ids.wsB,
  ]);
  // La famiglia in A per due casi; in B lo stesso nome (registrato prima della 8.0c), che non si tocca.
  await q(
    `INSERT INTO use_case_repos (use_case_id, workspace_id, repo, folder, created_by_user_id) VALUES ($1, $4, $6, 'casi/nr-0001', $7), ($2, $4, $6, 'casi/nr-0002', $7), ($3, $5, $6, 'casi/tr-0001', $7)`,
    [ids.uc1, ids.uc2, ids.ucB, ids.wsA, ids.wsB, REPO, ids.lead],
  );
  await q(`INSERT INTO use_case_factory_repos (workspace_id, repo, kind, template_version) VALUES ($1, $3, 'famiglia', '1.5.0'), ($2, $3, 'famiglia', '1.5.0')`, [ids.wsA, ids.wsB, REPO]);
  // Il dossier di NR-0001: gli eventi di GitHub del repository arrivano lì.
  await q(
    `INSERT INTO uc_templates (id, key, version, name, archetype, definition, definition_hash) VALUES ($1::uuid, $2, '1.0.0', 'Template di prova repository', 'prova', '{"confidential": false}'::jsonb, $3)`,
    [ids.template, `prova.repo_${suffix}`, randomBytes(32).toString("hex")],
  );
  await q(
    `INSERT INTO uc_cases (id, workspace_id, organization_id, portfolio_use_case_id, template_id, template_version, code, title, status, setup_completed_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, '1.0.0', $6, 'Dossier di prova repository', 'pronto_sviluppo', now())`,
    [ids.case1, ids.wsA, ids.org, ids.uc1, ids.template, `XR-${suffix.toUpperCase()}`],
  );
  // Le proposte: da decidere e già decisa da quel repository, da decidere da un altro repository, da decidere in B.
  const issue = (repo: string, n: number) => `https://github.com/${repo}/issues/${n}`;
  await q(
    `INSERT INTO use_case_task_proposals (use_case_id, workspace_id, source, external_key, title, link, status, decided_at) VALUES
       ($1, $3, 'github', 'prova-a-1', 'Titolo da quel repository', $5, 'proposta', NULL),
       ($1, $3, 'github', 'prova-a-2', 'Titolo già scartato', $6, 'scartata', now()),
       ($1, $3, 'github', 'prova-a-3', 'Titolo da un altro repository', $7, 'proposta', NULL),
       ($2, $3, 'github', 'prova-a-4', 'Titolo maiuscolo', $8, 'proposta', NULL),
       ($9, $4, 'github', 'prova-b-1', 'Titolo in B', $10, 'proposta', NULL)`,
    [ids.uc1, ids.uc2, ids.wsA, ids.wsB, issue(REPO, 1), issue(REPO, 2), issue(OTHER, 3), issue(REPO.toUpperCase(), 4), ids.ucB, issue(REPO, 5)],
  );
  // Le pull request e i compiti. NR-0001 è anche in un altro repository, che resta registrato.
  exec = (await import("../../db/uc-executor.ts")).ucExecutorForUrl(url!);
  github = await import("../../db/queries/use-case-github.ts");
  await q(`INSERT INTO use_case_repos (use_case_id, workspace_id, repo, folder, created_by_user_id) VALUES ($1, $2, $3, 'casi/nr-0001', $4)`, [ids.uc1, ids.wsA, OTHER, ids.lead]);
  await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'ls_lead')`, [ids.case1, ids.lead]);
  await q(
    `INSERT INTO use_case_tasks (use_case_id, workspace_id, ref, title, status, holder_user_id, taken_at, source) VALUES
       ($1, $4, 'T-1', 'Compito che qualcuno ha', 'in_corso', $6, now(), 'cli'),
       ($1, $4, 'T-2', 'Compito che nessuno ha', 'da_fare', NULL, NULL, 'cli'),
       ($1, $4, 'T-3', 'Compito con due pull request', 'in_corso', $6, now(), 'cli'),
       ($1, $4, 'T-4', 'Compito con una pull request in bozza', 'in_corso', $6, now(), 'cli'),
       ($2, $4, 'T-1', 'Compito di NR-0002', 'in_corso', $6, now(), 'cli'),
       ($3, $5, 'T-1', 'Compito in B', 'in_corso', $6, now(), 'cli')`,
    [ids.uc1, ids.uc2, ids.ucB, ids.wsA, ids.wsB, ids.lead],
  );
  const applied = [
    await prEvent({ number: 11, branch: "nr-0001/t-1-prova" }),
    await prEvent({ number: 12, branch: "nr-0001/t-2-prova" }),
    await prEvent({ number: 13, branch: "nr-0001/t-3-prova" }),
    await prEvent({ repo: OTHER, number: 3, branch: "nr-0001/t-3-altro" }),
    await prEvent({ number: 14, branch: "nr-0001/t-4-prova", draft: true }),
    // La storia: una chiusa senza unirla e una unita, senza compito.
    await prEvent({ number: 15, branch: "nr-0001/storia" }),
    await prEvent({ number: 15, branch: "nr-0001/storia", state: "chiusa" }),
    await prEvent({ number: 16, branch: "nr-0001/unita", state: "unita" }),
    await prEvent({ number: 21, branch: "nr-0002/t-1-prova" }),
    await prEvent({ number: 31, branch: "tr-0001/t-1-prova" }),
  ];
  assert.deepEqual(applied.map((r) => r.esito), applied.map(() => "applicato"));
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.wsA, ids.wsB]]);
  await q(`DELETE FROM uc_templates WHERE id = $1`, [ids.template]);
  await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
  await q(`DELETE FROM users WHERE id = $1`, [ids.lead]);
});

/** Lo stato di partenza delle pull request e dei compiti: tre compiti di NR-0001 in revisione, uno di NR-0002, uno in B. */
const PRS_AT_START = ["A:REPO#11:aperta", "A:REPO#12:aperta", "A:REPO#13:aperta", "A:REPO#14:aperta", "A:REPO#15:chiusa", "A:REPO#16:unita", "A:REPO#21:aperta", "A:OTHER#3:aperta", "B:REPO#31:aperta"];
const TASKS_AT_START = ["NR-0001 T-1:in_revisione:suo", "NR-0001 T-2:in_revisione:libero", "NR-0001 T-3:in_revisione:suo", "NR-0001 T-4:in_corso:suo", "NR-0002 T-1:in_revisione:suo", "TR-0001 T-1:in_revisione:suo"];

test("a secco: le registrazioni del workspace, le proposte che se ne vanno, le PR aperte da chiudere e quante registrazioni restano; niente scritto, niente nomi", opts, async () => {
  assert.deepEqual([await prs(), await tasks()], [PRS_AT_START, TASKS_AT_START]);
  const before = [await registrations(), await proposals(), await versions(), await prs(), await tasks()];
  const run = runAdmin(["--workspace", ids.wsA, "--repo", REPO.toUpperCase()]);
  assert.equal(run.status, 0, run.stdout);
  assert.equal(run.docs.length, 1, "un documento solo");
  assert.equal(run.last.status, "DRY_RUN");
  assert.deepEqual(run.last.casi, [
    { caso: "NR-0001", cartella: "casi/nr-0001" },
    { caso: "NR-0002", cartella: "casi/nr-0002" },
  ]);
  assert.deepEqual([run.last.proposteDaTogliere, run.last.restanoNelWorkspace], [2, 0]);
  // Le PR aperte di quel repository nei due use case di A (anche quella in bozza) e i loro compiti in revisione; mai B.
  assert.deepEqual([run.last.prDaChiudere, run.last.compitiInRevisione], [5, 4]);
  assert.equal("prChiuse" in run.last, false, "a secco non c'è niente di chiuso");
  assert.doesNotMatch(run.stdout, /@|Lucia|Titolo|Compito/, "niente nomi, e-mail o titoli");
  assert.deepEqual([await registrations(), await proposals(), await versions(), await prs(), await tasks()], before);
});

test("le opzioni sbagliate si fermano; un repository non registrato non fa niente", opts, () => {
  assert.deepEqual([runAdmin(["--all", "--repo", REPO]).last.code, runAdmin(["--workspace", ids.wsA]).last.code], ["opzioni", "opzioni"]);
  assert.equal(runAdmin(["--workspace", ids.wsA, "--repo", REPO, "--use-case", "NR1"]).last.code, "opzioni");
  const none = runAdmin(["--workspace", ids.wsA, "--repo", `Prova/mai-${suffix}`]);
  assert.deepEqual([none.status, none.last.status], [0, "NOTHING_TO_DO"]);
  assert.equal(runAdmin(["--workspace", ids.wsA, "--repo", REPO, ...confirm.slice(0, 1)]).last.code, "conferma", "--apply vuole le conferme");
});

test("--use-case: toglie solo la registrazione di quello use case e le sue proposte da decidere; la versione resta finché c'è un caso", opts, async () => {
  const run = runAdmin(["--workspace", ids.wsA, "--repo", REPO, "--use-case", "nr-0002", ...confirm]);
  assert.equal(run.status, 0, run.stdout);
  assert.deepEqual(run.docs.map((d) => d.status), ["PLAN", "APPLIED"]);
  assert.deepEqual([run.last.casi, run.last.proposteDaTogliere, run.last.restanoNelWorkspace], [[{ caso: "NR-0002", cartella: "casi/nr-0002" }], 1, 1]);
  assert.deepEqual(await registrations(), ["A:NR-0001", "B:TR-0001"]);
  assert.deepEqual(await proposals(), ["a-1:proposta", "a-2:scartata", "a-3:proposta", "b-1:proposta"]);
  assert.deepEqual(await versions(), ["A", "B"]);
  // Solo la PR aperta di NR-0002 si chiude, e il suo compito torna in corso a chi lo ha; il piano e l'esito lo contano.
  assert.deepEqual([run.docs[0].prDaChiudere, run.docs[0].compitiInRevisione, run.last.prChiuse, run.last.compitiTornati], [1, 1, 1, 1]);
  assert.deepEqual(await prs(), PRS_AT_START.map((pr) => (pr === "A:REPO#21:aperta" ? "A:REPO#21:chiusa" : pr)));
  assert.deepEqual(await tasks(), TASKS_AT_START.map((task) => (task === "NR-0002 T-1:in_revisione:suo" ? "NR-0002 T-1:in_corso:suo" : task)));
});

test("--apply: via le registrazioni del workspace, le proposte da decidere di quel repository e la sua versione; il resto e B restano; dopo, GitHub non arriva più", opts, async () => {
  const issue = (deliveryId: string, title: string) =>
    github.applyGithubEvent(exec, { deliveryId, event: "issues", parsed: { kind: "proposta", repo: REPO, number: 9, commentId: null, title, caseCodes: ["NR-0001"], onPullRequest: false } });
  // Prima: un'issue del repository diventa una proposta nel caso di A.
  assert.equal((await issue(`repo-${suffix}-prima`, "Arrivata prima di togliere")).esito, "applicato");
  assert.equal(await titled("Arrivata prima di togliere"), 1);
  // Prima: la PR di T-2, che nessuno ha, è «da rivedere» per chi costruisce il caso.
  assert.deepEqual(await reviewTodos(), [`La PR #12 di T-2 aspetta una revisione.`]);
  const run = runAdmin(["--workspace", ids.wsA, "--repo", `${REPO}.git`, ...confirm]);
  assert.equal(run.status, 0, run.stdout);
  assert.equal(run.last.status, "APPLIED");
  assert.deepEqual([run.last.proposteDaTogliere, run.last.restanoNelWorkspace], [2, 0]);
  // Il piano dice le PR aperte da chiudere e i compiti in revisione legati; l'esito quelle chiuse e i compiti tornati
  // (T-3 resta in revisione: ha una PR pronta nell'altro repository).
  assert.deepEqual([run.docs[0].status, run.docs[0].prDaChiudere, run.docs[0].compitiInRevisione], ["PLAN", 4, 3]);
  assert.deepEqual([run.last.prChiuse, run.last.compitiTornati], [4, 2]);
  assert.doesNotMatch(run.stdout, /@|Lucia|Titolo|Compito/, "niente nomi, e-mail o titoli");
  assert.deepEqual(await registrations(), ["B:TR-0001"], "B non cambia");
  assert.deepEqual(await proposals(), ["a-2:scartata", "a-3:proposta", "b-1:proposta"], "la decisa e quella di un altro repository restano");
  assert.equal(await titled("Arrivata prima di togliere"), 0, "la proposta arrivata dal repository se ne va");
  assert.deepEqual(await versions(), ["B"]);
  // Dopo: lo stesso repository non porta più niente ai casi di A.
  assert.deepEqual(await issue(`repo-${suffix}-dopo`, "Arrivata dopo"), { esito: "ignorato", motivo: "repository_non_registrato" });
  assert.equal(await titled("Arrivata dopo"), 0);
});

test("--apply ha chiuso le PR aperte di quel repository: i compiti in revisione tornano come con una chiusura vera, niente più «da rivedere»; il resto non cambia", opts, async () => {
  // Il test di prima ha tolto il repository da tutto A. Le quattro PR aperte di NR-0001 sono chiuse (anche la bozza);
  // quella già chiusa e quella unita restano com'erano, l'altro repository e B non si toccano.
  assert.deepEqual(await prs(), ["A:REPO#11:chiusa", "A:REPO#12:chiusa", "A:REPO#13:chiusa", "A:REPO#14:chiusa", "A:REPO#15:chiusa", "A:REPO#16:unita", "A:REPO#21:chiusa", "A:OTHER#3:aperta", "B:REPO#31:aperta"]);
  // T-1 torna in corso a chi lo ha, T-2 da fare (nessuno lo ha), T-3 resta in revisione per la PR pronta dell'altro
  // repository, T-4 (la bozza) non era in revisione e resta dov'era.
  assert.deepEqual(await tasks(), ["NR-0001 T-1:in_corso:suo", "NR-0001 T-2:da_fare:libero", "NR-0001 T-3:in_revisione:suo", "NR-0001 T-4:in_corso:suo", "NR-0002 T-1:in_corso:suo", "TR-0001 T-1:in_revisione:suo"]);
  const closed = await q(`SELECT number, closed_at IS NOT NULL AS closed, merged_at IS NULL AS unmerged, changed_at >= created_at AS changed FROM use_case_pull_requests WHERE workspace_id = $1 AND repo = $2 AND number IN (11, 12, 13, 14) ORDER BY number`, [ids.wsA, REPO]);
  assert.deepEqual(closed.map((r) => [r.closed, r.unmerged]), closed.map(() => [true, true]));
  // Come una chiusura arrivata da GitHub: la PR di B, chiusa da un evento vero, lascia il suo compito come quello di A.
  const mine = async (useCaseId: string) => (await q(`SELECT status, holder_user_id IS NOT NULL AS held, pr_url, branch FROM use_case_tasks WHERE use_case_id = $1 AND ref = 'T-1'`, [useCaseId]))[0];
  assert.equal((await prEvent({ number: 31, branch: "tr-0001/t-1-prova", state: "chiusa" })).esito, "applicato");
  const [byGithub, byOperator] = [await mine(ids.ucB), await mine(ids.uc1)];
  assert.deepEqual([byOperator.status, byOperator.held], [byGithub.status, byGithub.held]);
  assert.deepEqual([byGithub.status, byGithub.held], ["in_corso", true]);
  // L'indirizzo della PR e il ramo restano sul compito, come dopo una chiusura vera.
  assert.deepEqual([byOperator.pr_url, byOperator.branch], [`https://github.com/${REPO}/pull/11`, "nr-0001/t-1-prova"]);
  assert.deepEqual([byGithub.pr_url, byGithub.branch], [`https://github.com/${REPO}/pull/31`, "tr-0001/t-1-prova"]);
  // «Da fare per te»: prima c'era la PR di T-2 da rivedere; adesso di quel repository non resta niente.
  assert.deepEqual(await reviewTodos(), []);
  // La chiusura vera, quando arriva da GitHub, si ignora: non c'è più niente da chiudere.
  assert.deepEqual(await prEvent({ number: 11, branch: "nr-0001/t-1-prova", state: "chiusa" }), { esito: "ignorato", motivo: "repository_non_registrato" });
  assert.equal((await prs())[0], "A:REPO#11:chiusa");
});

test("un evento che aveva già letto il caso mentre l'operatore toglie il repository non scrive niente: nessuna PR aperta dopo, nessun segnale di vita", opts, async () => {
  /** Un esecutore che, subito prima della transazione dell'evento, fa girare `between` per intero. */
  const racing = (between: () => void): typeof exec => {
    let fired = false;
    return {
      batch: async (statements) => {
        if (!fired && statements.some((st) => st.text.includes("INSERT INTO use_case_github_deliveries"))) {
          fired = true;
          between();
        }
        return exec.batch(statements);
      },
    };
  };
  const activity = async (useCaseId: string) => String((await q(`SELECT last_activity_at FROM use_case_tasks WHERE use_case_id = $1 AND ref = 'T-1'`, [useCaseId]))[0].last_activity_at);

  // Una PR nuova in B, che ha ancora il repository: l'evento legge il caso, poi l'operatore toglie il repository.
  let unregistered: AdminRun | null = null;
  const opened = await prEvent(
    { number: 32, branch: "tr-0001/t-1-nuova" },
    racing(() => {
      unregistered = runAdmin(["--workspace", ids.wsB, "--repo", REPO, ...confirm]);
    }),
  );
  assert.equal((unregistered as AdminRun | null)?.last.status, "APPLIED", "il repository è stato tolto nel mezzo");
  assert.equal(opened.esito, "applicato", "la consegna è registrata");
  assert.deepEqual(await registrations(), []);
  assert.deepEqual((await prs()).filter((pr) => pr.startsWith("B:")), ["B:REPO#31:chiusa"], "la PR nuova non entra aperta dopo che il repository è stato tolto");
  assert.equal((await tasks()).at(-1), "TR-0001 T-1:in_corso:suo", "il compito non va in revisione");

  // Un push: con il repository registrato è un segnale di vita; se l'operatore lo toglie nel mezzo, no.
  const push = (deliveryId: string, executor = exec) => github.applyGithubEvent(executor, { deliveryId, event: "push", parsed: { kind: "push", repo: REPO, branch: "nr-0002/t-1-prova" } });
  await q(`INSERT INTO use_case_repos (use_case_id, workspace_id, repo, folder, created_by_user_id) VALUES ($1, $2, $3, 'casi/nr-0002', $4)`, [ids.uc2, ids.wsA, REPO, ids.lead]);
  await q(`UPDATE use_case_tasks SET last_activity_at = now() - interval '2 days' WHERE use_case_id = $1 AND ref = 'T-1'`, [ids.uc2]);
  const stale = await activity(ids.uc2);
  assert.equal((await push(`repo-${suffix}-push-1`)).esito, "applicato");
  const alive = await activity(ids.uc2);
  assert.notEqual(alive, stale, "un push di un repository registrato è un segnale di vita");
  await q(`UPDATE use_case_tasks SET last_activity_at = now() - interval '2 days' WHERE use_case_id = $1 AND ref = 'T-1'`, [ids.uc2]);
  const before = await activity(ids.uc2);
  await push(
    `repo-${suffix}-push-2`,
    racing(() => {
      unregistered = runAdmin(["--workspace", ids.wsA, "--repo", REPO, "--use-case", "NR-0002", ...confirm]);
    }),
  );
  assert.equal((unregistered as AdminRun | null)?.last.status, "APPLIED");
  assert.equal(await activity(ids.uc2), before, "nessun segnale di vita da un repository tolto");
});
