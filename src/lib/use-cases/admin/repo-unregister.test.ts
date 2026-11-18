// `use-case-admin repo-unregister` (rilascio 8.0c): le opzioni, il piano in una transazione e un riepilogo senza dati
// delle persone. Id e repository inventati.
import test from "node:test";
import assert from "node:assert/strict";
import { ADMIN_COMMANDS, parseAdminOptions } from "./cli.ts";
import {
  openPullRequestsSql,
  parseRepoOption,
  parseUseCaseCode,
  REPO_UNREGISTER_NOTE,
  REPO_UNREGISTER_OPTIONS,
  REPO_UNREGISTER_SCHEMA_SQL,
  repoUnregisterOutcome,
  repoUnregisterPlan,
  repoUnregisterReads,
} from "./repo-unregister.ts";
import { raw } from "../../uc/sql/statement.ts";
import { taskAfterPullRequestSql, tasksLockOfUseCaseSql } from "../factory/pull-request-sql.ts";

const WS = "3f2a9c1e-0000-4000-8000-0000000000a1";
const REG = [
  { id: "3f2a9c1e-0000-4000-8000-0000000000b1", useCaseId: "3f2a9c1e-0000-4000-8000-0000000000c1", code: "NM-0009", folder: "casi/nm-0009" },
  { id: "3f2a9c1e-0000-4000-8000-0000000000b2", useCaseId: "3f2a9c1e-0000-4000-8000-0000000000c2", code: "NM-0010", folder: "casi/nm-0010" },
];

test("il comando c'è, con --repo e --use-case; vuole --workspace o --all come gli altri, e --apply con le conferme", () => {
  assert.ok((ADMIN_COMMANDS as readonly string[]).includes("repo-unregister"));
  const parsed = parseAdminOptions(["--workspace", WS, "--repo", "Voltaen/alfa-esploso", "--use-case", "NM-0009"], REPO_UNREGISTER_OPTIONS);
  assert.ok(parsed.ok);
  if (parsed.ok) assert.deepEqual([parsed.value.values.get("repo"), parsed.value.values.get("use-case"), parsed.value.apply], ["Voltaen/alfa-esploso", "NM-0009", false]);
  assert.equal(parseAdminOptions(["--workspace", WS, "--repo", "Voltaen/x", "--tutto"], REPO_UNREGISTER_OPTIONS).ok, false);
  assert.equal(parseAdminOptions(["--workspace", WS, "--repo", "Voltaen/x", "--apply"], REPO_UNREGISTER_OPTIONS).ok, false, "--apply senza conferme");
});

test("--repo: owner/nome come lo registra la CLI, .git tolto; --use-case: un codice di use case", () => {
  assert.equal(parseRepoOption("Voltaen/alfa-esploso"), "Voltaen/alfa-esploso");
  assert.equal(parseRepoOption(" Voltaen/alfa-esploso.git "), "Voltaen/alfa-esploso");
  for (const bad of [null, "", "alfa-esploso", "Voltaen/", "-x/y", "Voltaen/alfa esploso", "a/b/c"]) assert.equal(parseRepoOption(bad), null, String(bad));
  assert.equal(parseUseCaseCode("nm-0009"), "NM-0009");
  for (const bad of [null, "", "NM9", "NM-9", "N-0009", "NM-0009; DROP"]) assert.equal(parseUseCaseCode(bad), null, String(bad));
});

test("le registrazioni si leggono nel workspace, per repository senza badare alle maiuscole; con --use-case solo quello", () => {
  const all = repoUnregisterReads(WS, "Voltaen/Alfa-Esploso", null).registrations;
  assert.match(all.text, /WHERE r\.workspace_id = \$1::uuid AND lower\(r\.repo\) = lower\(\$2::text\) AND true/);
  assert.deepEqual(all.params, [WS, "Voltaen/Alfa-Esploso"]);
  const one = repoUnregisterReads(WS, "Voltaen/alfa-esploso", "NM-0009").registrations;
  assert.match(one.text, /AND upper\(u\.code\) = \$3::text/);
  assert.deepEqual(one.params, [WS, "Voltaen/alfa-esploso", "NM-0009"]);
});

const NO_PRS = { openPullRequests: 0, tasksInReview: 0 };

test("il piano: le proposte da decidere di quel repository, le registrazioni, la versione se non resta nessun caso; un riepilogo senza nomi", () => {
  const plan = repoUnregisterPlan({
    workspaceId: WS,
    repo: "Voltaen/alfa-esploso",
    registrations: REG,
    tables: { proposals: true, factoryRepos: true, pullRequests: false },
    pendingProposals: 2,
    ...NO_PRS,
    remaining: 0,
  });
  assert.equal(plan.statements.length, 3);
  assert.match(plan.statements[0].text, /^DELETE FROM use_case_task_proposals p WHERE p\.workspace_id = \$1::uuid AND p\.use_case_id = ANY \(\$2::uuid\[\]\) AND p\.status = 'proposta'/);
  assert.deepEqual(plan.statements[0].params, [WS, [REG[0].useCaseId, REG[1].useCaseId], "https://github.com/voltaen/alfa-esploso/"]);
  assert.match(plan.statements[1].text, /^DELETE FROM use_case_repos r WHERE r\.workspace_id = \$1::uuid AND r\.id = ANY \(\$2::uuid\[\]\)$/);
  assert.deepEqual(plan.statements[1].params, [WS, [REG[0].id, REG[1].id]]);
  assert.match(plan.statements[2].text, /^DELETE FROM use_case_factory_repos f WHERE f\.workspace_id = \$1::uuid AND lower\(f\.repo\) = lower\(\$2::text\)\n  AND NOT EXISTS/);
  assert.deepEqual(plan.report, {
    repository: "Voltaen/alfa-esploso",
    casi: [
      { caso: "NM-0009", cartella: "casi/nm-0009" },
      { caso: "NM-0010", cartella: "casi/nm-0010" },
    ],
    proposteDaTogliere: 2,
    prDaChiudere: 0,
    compitiInRevisione: 0,
    restanoNelWorkspace: 0,
    nota: REPO_UNREGISTER_NOTE,
  });
  assert.doesNotMatch(JSON.stringify(plan.report), /@/);
  // Senza le tabelle delle proposte, delle versioni e delle pull request: solo le registrazioni.
  const bare = repoUnregisterPlan({
    workspaceId: WS,
    repo: "Voltaen/alfa-esploso",
    registrations: REG.slice(0, 1),
    tables: { proposals: false, factoryRepos: false, pullRequests: false },
    pendingProposals: 5,
    openPullRequests: 4,
    tasksInReview: 3,
    remaining: 1,
  });
  assert.deepEqual(
    bare.statements.map((s) => s.text.split(" ").slice(0, 3).join(" ")),
    ["DELETE FROM use_case_repos"],
  );
  assert.deepEqual([bare.report.proposteDaTogliere, bare.report.prDaChiudere, bare.report.compitiInRevisione, bare.at], [0, 0, 0, null]);
  assert.deepEqual(repoUnregisterOutcome(bare, [[]]), { prChiuse: 0, compitiTornati: 0 });
});

test("il piano con le pull request: prima i lock dei compiti, nell'ordine del webhook; le PR aperte chiuse e i compiti mossi con la regola del webhook, prima di togliere le registrazioni", () => {
  // Gli use case arrivano in ordine di codice, non di id: i lock vanno in ordine di id.
  const registrations = [REG[1], REG[0], { ...REG[0], id: "3f2a9c1e-0000-4000-8000-0000000000b3", folder: "casi/altra" }];
  const plan = repoUnregisterPlan({
    workspaceId: WS,
    repo: "Voltaen/Alfa-Esploso",
    registrations,
    tables: { proposals: true, factoryRepos: true, pullRequests: true },
    pendingProposals: 1,
    openPullRequests: 3,
    tasksInReview: 2,
    remaining: 0,
  });
  const kinds = plan.statements.map((s) => s.text.split(/\s+/).slice(0, 3).join(" "));
  assert.deepEqual(kinds, [
    "SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-tasks:' ||",
    "SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-tasks:' ||",
    "DELETE FROM use_case_task_proposals",
    "SELECT DISTINCT t.id",
    "UPDATE use_case_pull_requests p",
    "UPDATE use_case_tasks t",
    "DELETE FROM use_case_repos",
    "DELETE FROM use_case_factory_repos",
  ]);
  // Un lock per use case (uno solo anche con due cartelle), in ordine di id: lo stesso lock e lo stesso ordine del webhook.
  assert.deepEqual(plan.statements.slice(0, 2), [tasksLockOfUseCaseSql(REG[0].useCaseId), tasksLockOfUseCaseSql(REG[1].useCaseId)]);
  assert.deepEqual(plan.at, { inReview: 3, closed: 4, tasks: 5 });
  const scope = /p\.workspace_id = \$1::uuid AND lower\(p\.repo\) = lower\(\$2::text\) AND p\.use_case_id = ANY \(\$3::uuid\[\]\)/;
  const touched = [REG[1].useCaseId, REG[0].useCaseId];
  // I compiti in revisione di prima, solo quelli legati a una PR aperta di quel repository negli use case toccati.
  assert.match(plan.statements[3].text, /JOIN use_case_tasks t ON t\.id = p\.task_id AND t\.status = 'in_revisione'/);
  assert.match(plan.statements[3].text, scope);
  assert.match(plan.statements[3].text, /AND p\.state = 'aperta'$/);
  assert.deepEqual(plan.statements[3].params, [WS, "Voltaen/Alfa-Esploso", touched]);
  // Solo le aperte si chiudono (le unite e le chiuse restano com'erano), e la chiusura conta come un cambio di adesso.
  assert.match(plan.statements[4].text, /^UPDATE use_case_pull_requests p SET state = 'chiusa', closed_at = now\(\), changed_at = now\(\), updated_at = now\(\)\nWHERE /);
  assert.match(plan.statements[4].text, scope);
  assert.match(plan.statements[4].text, /AND p\.state = 'aperta'\nRETURNING p\.id$/);
  assert.doesNotMatch(plan.statements[4].text, /merged_at|gh_updated_at|draft/);
  assert.deepEqual(plan.statements[4].params, [WS, "Voltaen/Alfa-Esploso", touched]);
  // I compiti: la regola del webhook, tale e quale, sulle PR chiuse adesso; `pr_url` resta com'è, nessun segnale di vita.
  const rule = (text: string) => text.slice(0, text.indexOf("\nWHERE "));
  assert.equal(rule(plan.statements[5].text), rule(taskAfterPullRequestSql({ match: raw("true"), url: raw("t.pr_url"), signal: false }).text));
  assert.match(
    plan.statements[5].text,
    /\nWHERE p\.workspace_id = \$2::uuid AND lower\(p\.repo\) = lower\(\$3::text\) AND p\.use_case_id = ANY \(\$4::uuid\[\]\) AND p\.state = 'chiusa' AND p\.changed_at = now\(\) AND t\.id = p\.task_id AND t\.status IN \('da_fare', 'in_corso', 'in_revisione'\)\nRETURNING t\.id, t\.status$/,
  );
  assert.deepEqual(plan.statements[5].params, [false, WS, "Voltaen/Alfa-Esploso", touched]);
  assert.deepEqual([plan.report.prDaChiudere, plan.report.compitiInRevisione], [3, 2]);
  assert.match(plan.report.nota, /pull request aperte di questo repository si segnano chiuse/);
  assert.doesNotMatch(JSON.stringify(plan.report), /@/);
});

test("dopo --apply: le PR chiuse davvero e i compiti che erano in revisione e non lo sono più, dai risultati della transazione", () => {
  const plan = repoUnregisterPlan({
    workspaceId: WS,
    repo: "Voltaen/alfa-esploso",
    registrations: REG.slice(0, 1),
    tables: { proposals: false, factoryRepos: false, pullRequests: true },
    pendingProposals: 0,
    openPullRequests: 3,
    tasksInReview: 2,
    remaining: 0,
  });
  assert.deepEqual(plan.at, { inReview: 1, closed: 2, tasks: 3 });
  const results = [
    [{ pg_advisory_xact_lock: "" }],
    // In revisione prima: t1 e t2.
    [{ id: "t1" }, { id: "t2" }],
    // Tre PR chiuse.
    [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
    // Dopo: t1 torna in corso; t2 resta in revisione (un'altra PR pronta); t3 era in corso con una PR in bozza e resta lì.
    [
      { id: "t1", status: "in_corso" },
      { id: "t2", status: "in_revisione" },
      { id: "t3", status: "in_corso" },
    ],
    [],
  ];
  assert.deepEqual(repoUnregisterOutcome(plan, results), { prChiuse: 3, compitiTornati: 1 });
  assert.deepEqual(repoUnregisterOutcome(plan, []), { prChiuse: 0, compitiTornati: 0 });
});

test("le letture del piano: le PR aperte del repository negli use case toccati e i compiti in revisione legati; la sonda dice se le tabelle ci sono", () => {
  const open = openPullRequestsSql(WS, "Voltaen/alfa-esploso", [REG[0].useCaseId]);
  assert.match(open.text, /^SELECT count\(\*\)::int AS n, count\(DISTINCT t\.id\)::int AS tasks\nFROM use_case_pull_requests p LEFT JOIN use_case_tasks t ON t\.id = p\.task_id AND t\.status = 'in_revisione'/);
  assert.match(open.text, /AND p\.state = 'aperta'$/);
  assert.deepEqual(open.params, [WS, "Voltaen/alfa-esploso", [REG[0].useCaseId]]);
  assert.match(REPO_UNREGISTER_SCHEMA_SQL, /to_regclass\('public\.use_case_pull_requests'\) IS NOT NULL AND to_regclass\('public\.use_case_tasks'\) IS NOT NULL\) AS pull_requests/);
});
