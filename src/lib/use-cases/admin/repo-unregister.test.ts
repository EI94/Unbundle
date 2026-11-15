// `use-case-admin repo-unregister` (rilascio 8.0c): le opzioni, il piano in una transazione e un riepilogo senza dati
// delle persone. Id e repository inventati.
import test from "node:test";
import assert from "node:assert/strict";
import { ADMIN_COMMANDS, parseAdminOptions } from "./cli.ts";
import { parseRepoOption, parseUseCaseCode, REPO_UNREGISTER_NOTE, REPO_UNREGISTER_OPTIONS, repoUnregisterPlan, repoUnregisterReads } from "./repo-unregister.ts";

const WS = "3f2a9c1e-0000-4000-8000-0000000000a1";
const REG = [
  { id: "3f2a9c1e-0000-4000-8000-0000000000b1", useCaseId: "3f2a9c1e-0000-4000-8000-0000000000c1", code: "NM-0009", folder: "casi/nm-0009" },
  { id: "3f2a9c1e-0000-4000-8000-0000000000b2", useCaseId: "3f2a9c1e-0000-4000-8000-0000000000c2", code: "NM-0010", folder: "casi/nm-0010" },
];

test("il comando c'è, con --repo e --use-case; vuole --workspace o --all come gli altri, e --apply con le conferme", () => {
  assert.ok((ADMIN_COMMANDS as readonly string[]).includes("repo-unregister"));
  const parsed = parseAdminOptions(["--workspace", WS, "--repo", "Voltaen/nardi-esploso", "--use-case", "NM-0009"], REPO_UNREGISTER_OPTIONS);
  assert.ok(parsed.ok);
  if (parsed.ok) assert.deepEqual([parsed.value.values.get("repo"), parsed.value.values.get("use-case"), parsed.value.apply], ["Voltaen/nardi-esploso", "NM-0009", false]);
  assert.equal(parseAdminOptions(["--workspace", WS, "--repo", "Voltaen/x", "--tutto"], REPO_UNREGISTER_OPTIONS).ok, false);
  assert.equal(parseAdminOptions(["--workspace", WS, "--repo", "Voltaen/x", "--apply"], REPO_UNREGISTER_OPTIONS).ok, false, "--apply senza conferme");
});

test("--repo: owner/nome come lo registra la CLI, .git tolto; --use-case: un codice di use case", () => {
  assert.equal(parseRepoOption("Voltaen/nardi-esploso"), "Voltaen/nardi-esploso");
  assert.equal(parseRepoOption(" Voltaen/nardi-esploso.git "), "Voltaen/nardi-esploso");
  for (const bad of [null, "", "nardi-esploso", "Voltaen/", "-x/y", "Voltaen/nardi esploso", "a/b/c"]) assert.equal(parseRepoOption(bad), null, String(bad));
  assert.equal(parseUseCaseCode("nm-0009"), "NM-0009");
  for (const bad of [null, "", "NM9", "NM-9", "N-0009", "NM-0009; DROP"]) assert.equal(parseUseCaseCode(bad), null, String(bad));
});

test("le registrazioni si leggono nel workspace, per repository senza badare alle maiuscole; con --use-case solo quello", () => {
  const all = repoUnregisterReads(WS, "Voltaen/Nardi-Esploso", null).registrations;
  assert.match(all.text, /WHERE r\.workspace_id = \$1::uuid AND lower\(r\.repo\) = lower\(\$2::text\) AND true/);
  assert.deepEqual(all.params, [WS, "Voltaen/Nardi-Esploso"]);
  const one = repoUnregisterReads(WS, "Voltaen/nardi-esploso", "NM-0009").registrations;
  assert.match(one.text, /AND upper\(u\.code\) = \$3::text/);
  assert.deepEqual(one.params, [WS, "Voltaen/nardi-esploso", "NM-0009"]);
});

test("il piano: le proposte da decidere di quel repository, le registrazioni, la versione se non resta nessun caso; un riepilogo senza nomi", () => {
  const plan = repoUnregisterPlan({ workspaceId: WS, repo: "Voltaen/nardi-esploso", registrations: REG, tables: { proposals: true, factoryRepos: true }, pendingProposals: 2, remaining: 0 });
  assert.equal(plan.statements.length, 3);
  assert.match(plan.statements[0].text, /^DELETE FROM use_case_task_proposals p WHERE p\.workspace_id = \$1::uuid AND p\.use_case_id = ANY \(\$2::uuid\[\]\) AND p\.status = 'proposta'/);
  assert.deepEqual(plan.statements[0].params, [WS, [REG[0].useCaseId, REG[1].useCaseId], "https://github.com/voltaen/nardi-esploso/"]);
  assert.match(plan.statements[1].text, /^DELETE FROM use_case_repos r WHERE r\.workspace_id = \$1::uuid AND r\.id = ANY \(\$2::uuid\[\]\)$/);
  assert.deepEqual(plan.statements[1].params, [WS, [REG[0].id, REG[1].id]]);
  assert.match(plan.statements[2].text, /^DELETE FROM use_case_factory_repos f WHERE f\.workspace_id = \$1::uuid AND lower\(f\.repo\) = lower\(\$2::text\)\n  AND NOT EXISTS/);
  assert.deepEqual(plan.report, {
    repository: "Voltaen/nardi-esploso",
    casi: [
      { caso: "NM-0009", cartella: "casi/nm-0009" },
      { caso: "NM-0010", cartella: "casi/nm-0010" },
    ],
    proposteDaTogliere: 2,
    restanoNelWorkspace: 0,
    nota: REPO_UNREGISTER_NOTE,
  });
  assert.doesNotMatch(JSON.stringify(plan.report), /@/);
  // Senza le tabelle delle proposte e delle versioni: solo le registrazioni.
  const bare = repoUnregisterPlan({ workspaceId: WS, repo: "Voltaen/nardi-esploso", registrations: REG.slice(0, 1), tables: { proposals: false, factoryRepos: false }, pendingProposals: 5, remaining: 1 });
  assert.deepEqual(
    bare.statements.map((s) => s.text.split(" ").slice(0, 3).join(" ")),
    ["DELETE FROM use_case_repos"],
  );
  assert.equal(bare.report.proposteDaTogliere, 0);
});
