// Il compito e la sua pull request (rilascio 8.1b; 8.0c per `use-case-admin repo-unregister`): il lock dei compiti di uno
// use case e la regola del compito dopo la PR stanno in un modulo solo, che usano il webhook di GitHub e lo script
// dell'operatore. Qui la forma dell'SQL; il comportamento sul database sta in github-webhook.integration.test.ts e in
// admin/repo-unregister.integration.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cast, ucSql } from "../../uc/sql/statement.ts";
import { byUseCaseId, taskAfterPullRequestSql, tasksLockOfUseCaseSql } from "./pull-request-sql.ts";

const A = "3f2a9c1e-0000-4000-8000-0000000000c1";
const B = "3f2a9c1e-0000-4000-8000-0000000000c2";
const C = "9f2a9c1e-0000-4000-8000-0000000000c0";
const source = (path: string) => readFileSync(fileURLToPath(new URL(`../../../../${path}`, import.meta.url)), "utf8");

test("il lock dei compiti di uno use case: una chiave sola, e un ordine solo quando gli use case sono più di uno", () => {
  const lock = tasksLockOfUseCaseSql(A);
  assert.equal(lock.text, "SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-tasks:' || $1::text))");
  assert.deepEqual(lock.params, [A]);
  assert.deepEqual([C, B, A].sort(byUseCaseId), [A, B, C]);
});

test("il compito dopo la sua PR: fatto se unita, in revisione con una PR pronta, altrimenti da in revisione torna in corso (da fare, se nessuno lo ha)", () => {
  const s = taskAfterPullRequestSql({ match: ucSql`p.number = ${cast(7, "int")} AND t.id = p.task_id`, url: cast("https://github.com/Prova/rondine/pull/7", "text"), signal: true });
  assert.match(
    s.text,
    /status = CASE\n    WHEN NOT p\.changed_at = now\(\) THEN t\.status\n    WHEN p\.state = 'unita' THEN 'fatto'\n    WHEN EXISTS \(SELECT 1 FROM use_case_pull_requests o WHERE o\.task_id = t\.id AND o\.state = 'aperta' AND NOT o\.draft\) THEN 'in_revisione'\n    WHEN t\.status = 'in_revisione' THEN CASE WHEN t\.holder_user_id IS NULL THEN 'da_fare' ELSE 'in_corso' END\n    ELSE t\.status END,/,
  );
  // L'indirizzo si scrive solo per una PR pronta o unita; il segnale di vita solo se lo dice chi chiama, o se è unita.
  assert.match(s.text, /pr_url = CASE WHEN p\.changed_at = now\(\) AND \(p\.state = 'unita' OR \(p\.state = 'aperta' AND NOT p\.draft\)\) THEN \$1::text ELSE t\.pr_url END,/);
  assert.match(s.text, /last_activity_at = CASE WHEN \$2::boolean OR \(p\.changed_at = now\(\) AND p\.state = 'unita'\) THEN now\(\) ELSE t\.last_activity_at END,/);
  // Un compito fatto o annullato non cambia più.
  assert.match(s.text, /\nFROM use_case_pull_requests p\nWHERE p\.number = \$3::int AND t\.id = p\.task_id AND t\.status IN \('da_fare', 'in_corso', 'in_revisione'\)\nRETURNING t\.id, t\.status$/);
  assert.deepEqual(s.params, ["https://github.com/Prova/rondine/pull/7", true, 7]);
});

test("una regola sola: il webhook e lo script dell'operatore la prendono da qui, e il lock dei compiti è lo stesso", () => {
  const webhook = source("src/lib/db/queries/use-case-github.ts");
  assert.match(webhook, /taskAfterPullRequestSql\(\{/);
  assert.doesNotMatch(webhook, /UPDATE use_case_tasks t SET/, "il webhook non tiene una sua copia della regola");
  const admin = source("src/lib/use-cases/admin/repo-unregister.ts");
  assert.match(admin, /taskAfterPullRequestSql\(\{/);
  assert.match(admin, /\.sort\(byUseCaseId\)\.map\(tasksLockOfUseCaseSql\)/);
  assert.doesNotMatch(admin, /UPDATE use_case_tasks/, "lo script non tiene una sua copia della regola");
  assert.match(source("src/lib/db/queries/use-case-tasks.ts"), /export const tasksLock = \(target: FactoryTarget\) => tasksLockOfUseCaseSql\(target\.useCaseId\);/);
  assert.match(webhook, /\.sort\(\(a, b\) => byUseCaseId\(a\.target\.useCaseId, b\.target\.useCaseId\)\)\.map\(\(p\) => tasksLock\(p\.target\)\)/);
});
