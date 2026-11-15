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
// evento di GitHub di quel repository si ignora. L'uscita non ha nomi né e-mail.
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
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.wsA, ids.wsB]]);
  await q(`DELETE FROM uc_templates WHERE id = $1`, [ids.template]);
  await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
  await q(`DELETE FROM users WHERE id = $1`, [ids.lead]);
});

test("a secco: le registrazioni del workspace, le proposte che se ne vanno e quante registrazioni restano; niente scritto, niente nomi", opts, async () => {
  const before = [await registrations(), await proposals(), await versions()];
  const run = runAdmin(["--workspace", ids.wsA, "--repo", REPO.toUpperCase()]);
  assert.equal(run.status, 0, run.stdout);
  assert.equal(run.docs.length, 1, "un documento solo");
  assert.equal(run.last.status, "DRY_RUN");
  assert.deepEqual(run.last.casi, [
    { caso: "NR-0001", cartella: "casi/nr-0001" },
    { caso: "NR-0002", cartella: "casi/nr-0002" },
  ]);
  assert.deepEqual([run.last.proposteDaTogliere, run.last.restanoNelWorkspace], [2, 0]);
  assert.doesNotMatch(run.stdout, /@|Lucia|Titolo/, "niente nomi, e-mail o titoli");
  assert.deepEqual([await registrations(), await proposals(), await versions()], before);
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
});

test("--apply: via le registrazioni del workspace, le proposte da decidere di quel repository e la sua versione; il resto e B restano; dopo, GitHub non arriva più", opts, async () => {
  const github = await import("../../db/queries/use-case-github.ts");
  const exec = (await import("../../db/uc-executor.ts")).ucExecutorForUrl(url!);
  const issue = (deliveryId: string, title: string) =>
    github.applyGithubEvent(exec, { deliveryId, event: "issues", parsed: { kind: "proposta", repo: REPO, number: 9, commentId: null, title, caseCodes: ["NR-0001"], onPullRequest: false } });
  // Prima: un'issue del repository diventa una proposta nel caso di A.
  assert.equal((await issue(`repo-${suffix}-prima`, "Arrivata prima di togliere")).esito, "applicato");
  assert.equal(await titled("Arrivata prima di togliere"), 1);
  const run = runAdmin(["--workspace", ids.wsA, "--repo", `${REPO}.git`, ...confirm]);
  assert.equal(run.status, 0, run.stdout);
  assert.equal(run.last.status, "APPLIED");
  assert.deepEqual([run.last.proposteDaTogliere, run.last.restanoNelWorkspace], [2, 0]);
  assert.deepEqual(await registrations(), ["B:TR-0001"], "B non cambia");
  assert.deepEqual(await proposals(), ["a-2:scartata", "a-3:proposta", "b-1:proposta"], "la decisa e quella di un altro repository restano");
  assert.equal(await titled("Arrivata prima di togliere"), 0, "la proposta arrivata dal repository se ne va");
  assert.deepEqual(await versions(), ["B"]);
  // Dopo: lo stesso repository non porta più niente ai casi di A.
  assert.deepEqual(await issue(`repo-${suffix}-dopo`, "Arrivata dopo"), { esito: "ignorato", motivo: "repository_non_registrato" });
  assert.equal(await titled("Arrivata dopo"), 0);
});
