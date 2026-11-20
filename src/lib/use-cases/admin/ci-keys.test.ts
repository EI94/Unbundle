import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ADMIN_COMMANDS, parseAdminOptions } from "./cli.ts";
import { CI_KEY_REVOKE_OPTIONS, ciKeyAdminLine, ciKeyAdminState } from "./ci-keys.ts";
import { REPO_UNREGISTER_SCHEMA_SQL, repoUnregisterOutcome, repoUnregisterPlan } from "./repo-unregister.ts";
import type { CiKeyRow } from "../ci/keys.ts";

// I comandi dell'operatore sulle chiavi della CI (rilascio 8.2b, RILASCIO-8.2b-SPEC.md §2.8): `ci-keys` (sola lettura,
// mai la chiave, mai chi), `ci-key-revoke` (a secco, poi `--apply` con le conferme), `repo-unregister` che revoca le
// chiavi del repository quando non gli restano casi; e il passo del cron. Id inventati.

const WS = "3f2a9c1e-0000-4000-8000-0000000000a1";
const NOW = new Date("2026-11-20T10:00:00.000Z");
const DAY = 86_400_000;
const REG = [{ id: "3f2a9c1e-0000-4000-8000-0000000000b1", useCaseId: "3f2a9c1e-0000-4000-8000-0000000000c1", code: "XX-0009", folder: "casi/xx-0009" }];

const row = (over: Partial<CiKeyRow> = {}): CiKeyRow => ({
  id: "3f2a9c1e-0000-4000-8000-0000000000d1",
  repo: "Voltaen/esempio-rosa",
  prefix: "ub_ci_ab12",
  createdAt: new Date(NOW.getTime() - DAY),
  expiresAt: new Date(NOW.getTime() + 179 * DAY),
  lastUsedAt: null,
  remindedAt: null,
  revokedAt: null,
  revokedReason: null,
  replacesKeyId: null,
  ...over,
});

test("i due comandi sono registrati; ci-keys è in sola lettura, ci-key-revoke vuole --repo", () => {
  assert.ok(ADMIN_COMMANDS.includes("ci-keys") && ADMIN_COMMANDS.includes("ci-key-revoke"));
  const keys = readFileSync(new URL("../../../../scripts/use-case-admin/ci-keys.ts", import.meta.url), "utf8");
  assert.match(keys, /name: "ci-keys",\s+readOnly: true,/);
  assert.equal(parseAdminOptions(["--workspace", WS, "--apply"], {}, true).ok, false, "niente --apply su ci-keys");
  const parsed = parseAdminOptions(["--workspace", WS, "--repo", "Voltaen/esempio-rosa"], CI_KEY_REVOKE_OPTIONS);
  assert.ok(parsed.ok);
  if (parsed.ok) assert.equal(parsed.value.values.get("repo"), "Voltaen/esempio-rosa");
  const revoke = readFileSync(new URL("../../../../scripts/use-case-admin/ci-key-revoke.ts", import.meta.url), "utf8");
  assert.match(revoke, /if \(!ctx\.apply\) return done\(\{ status: "DRY_RUN"/, "a secco prima di tutto");
  assert.ok(revoke.indexOf('ctx.print({ status: "PLAN"') < revoke.indexOf("ctx.db.write("), "il piano prima di scrivere");
});

test("ci-keys: repository, prefisso, date e stato; mai la chiave, mai chi", () => {
  assert.equal(ciKeyAdminState(row(), NOW), "viva");
  assert.equal(ciKeyAdminState(row({ expiresAt: new Date(NOW.getTime() - 1) }), NOW), "scaduta");
  assert.equal(ciKeyAdminState(row({ revokedAt: NOW, revokedReason: "esposta" }), NOW), "revocata");
  const line = ciKeyAdminLine(row({ lastUsedAt: NOW, replacesKeyId: "3f2a9c1e-0000-4000-8000-0000000000d0" }), NOW);
  assert.deepEqual(Object.keys(line).sort(), ["avvisata", "creata", "motivo", "prefisso", "repository", "revocata", "scade", "sostituisceUnaChiave", "stato", "ultimoUso"]);
  assert.equal(line.prefisso, "ub_ci_ab12");
  assert.equal(line.sostituisceUnaChiave, true);
  assert.equal(line.ultimoUso, NOW.toISOString());
});

test("repo-unregister: con la 0042 revoca le chiavi della CI, per ultime, solo se non restano casi del repository", () => {
  assert.match(REPO_UNREGISTER_SCHEMA_SQL, /to_regclass\('public\.use_case_ci_keys'\) IS NOT NULL AS ci_keys/);
  const facts = {
    workspaceId: WS,
    repo: "Voltaen/esempio-rosa",
    registrations: REG,
    tables: { proposals: false, factoryRepos: true, pullRequests: false, ciKeys: true },
    pendingProposals: 0,
    openPullRequests: 0,
    tasksInReview: 0,
    remaining: 0,
    unrevokedCiKeys: 2,
  };
  const plan = repoUnregisterPlan(facts);
  assert.equal(plan.ciKeysAt, plan.statements.length - 1, "dopo le registrazioni: il NOT EXISTS le vede già tolte");
  const revoke = plan.statements[plan.statements.length - 1];
  assert.match(revoke.text, /^UPDATE use_case_ci_keys k SET revoked_at = now\(\), revoked_reason = 'senza_casi'/);
  assert.match(revoke.text, /AND NOT EXISTS \(SELECT 1 FROM use_case_repos r WHERE r\.workspace_id = \$\d+::uuid AND lower\(r\.repo\) = lower\(\$\d+::text\)\)/);
  assert.equal(plan.report.chiaviCiDaRevocare, 2);
  assert.equal(repoUnregisterPlan({ ...facts, remaining: 1 }).report.chiaviCiDaRevocare, 0, "restano casi: le chiavi restano");
  assert.deepEqual(repoUnregisterOutcome(plan, plan.statements.map((_, i) => (i === plan.ciKeysAt ? [{ id: "a" }, { id: "b" }] : []))), { prChiuse: 0, compitiTornati: 0, chiaviCiRevocate: 2 });
  // Senza la 0042: niente di nuovo nel piano, nel riepilogo e nell'esito.
  const before = repoUnregisterPlan({ ...facts, tables: { proposals: false, factoryRepos: true, pullRequests: false } });
  assert.equal(before.ciKeysAt, null);
  assert.ok(!("chiaviCiDaRevocare" in before.report));
  assert.ok(!before.statements.some((s) => /use_case_ci_keys/.test(s.text)));
  assert.deepEqual(repoUnregisterOutcome(before, [[], []]), { prChiuse: 0, compitiTornati: 0 });
});

test("il cron: il passo delle chiavi nella finestra d'invio, dopo gli eventi di GitHub e prima dell'invio della coda", () => {
  const cron = readFileSync(new URL("../../db/queries/uc-cron.ts", import.meta.url), "utf8");
  const body = cron.slice(cron.indexOf("export async function runRemindersCron("), cron.indexOf("// ── Cron della freschezza"));
  const github = body.indexOf("await pruneGithubDeliveries(executor);");
  const ours = body.indexOf("s.ciKeys = await runCiKeysSweep(executor, {");
  const send = body.indexOf("// 5. Invio della coda.");
  assert.ok(github > 0 && ours > github && send > ours, "4c, poi 4d, poi l'invio");
  assert.match(body.slice(body.lastIndexOf("if (s.inWindow && timeLeft()) {", ours), ours), /^if \(s\.inWindow && timeLeft\(\)\) \{\s+try \{\s+$/);
  assert.match(body, /logFailure\("uc-reminders", "chiavi della ci", errorCode\(error\)\);/);
  assert.match(cron, /ciKeys: null,/);
});
