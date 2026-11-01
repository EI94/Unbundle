import test from "node:test";
import assert from "node:assert/strict";
import { alertSchedule } from "../referent/alerts.ts";
import { infoCompleteSyncStatements } from "../referent/sql.ts";
import { toStatement } from "../../uc/sql/statement.ts";
import { cardSyncStatements, lsReviewerRecipientsSql, readinessSyncSql, readyNowSql, subprocessorsAckSql, type ReadinessSync } from "./sql.ts";
import { raw } from "../../uc/sql/statement.ts";

// I costruttori SQL di «Pronto da avviare» (0025), senza database. UUID inventati.
const WS = "3f2a9c1e-0000-4000-8000-0000000000a1";
const UC = "3f2a9c1e-0000-4000-8000-0000000000b1";
const ACTOR = "3f2a9c1e-0000-4000-8000-0000000000c1";
const now = new Date("2026-11-02T09:30:00Z");
const readiness: ReadinessSync = { lsDomains: ["lateralspace.ai", "voltaenergy.xyz", "x y"], dossiers: true, schedule: alertSchedule(now), now };

test("senza la 0025 (readiness null) le scritture mandano esattamente «Informazioni complete» di prima", () => {
  const before = infoCompleteSyncStatements({ workspaceId: WS, useCaseIds: [UC], actorUserId: ACTOR });
  assert.deepEqual(cardSyncStatements({ workspaceId: WS, useCaseIds: [UC], actorUserId: ACTOR, readiness: null }), before);
  assert.doesNotMatch(before[1].text, /pronto/);
});

test("con la 0025: il lock per scheda, poi il passaggio a «pronto», poi «Informazioni complete» senza doppioni per Lateral Space", () => {
  const [lock, ready, info, ...rest] = cardSyncStatements({ workspaceId: WS, useCaseIds: [UC], actorUserId: ACTOR, readiness });
  assert.equal(rest.length, 0);
  assert.equal(lock.text, infoCompleteSyncStatements({ workspaceId: WS, useCaseIds: [UC], actorUserId: ACTOR })[0].text, "lo stesso lock di «Informazioni complete»");
  assert.match(lock.text, /pg_advisory_xact_lock\(hashtext\('use-case-info:' \|\| u\.id::text\)\)/);
  assert.match(ready.text, /INSERT INTO use_case_ready_state/);
  assert.match(ready.text, /'pronto'/);
  assert.match(info.text, /NOT EXISTS \(SELECT 1 FROM use_case_notifications pr\s+WHERE pr\.recipient_user_id = r\.user_id AND pr\.use_case_id = b\.use_case_id AND pr\.kind = 'pronto'/);
  const noInfo = cardSyncStatements({ workspaceId: WS, useCaseIds: [UC], actorUserId: ACTOR, readiness, info: false });
  assert.deepEqual(noInfo.map((s) => s.text), [lock.text, ready.text]);
});

test("il passaggio: confronta lo stato salvato (valido solo per un trimestre non passato), niente ordinamenti o raggruppamenti per persona", () => {
  const s = readinessSyncSql({ workspaceId: WS, useCaseIds: [UC], actorUserId: ACTOR, readiness });
  assert.match(s.text, /s\.ready_quarter >= \(to_char\(now\(\) AT TIME ZONE 'Europe\/Rome', 'YYYY'\) \|\| '-Q' \|\| to_char\(now\(\) AT TIME ZONE 'Europe\/Rome', 'Q'\)\)/);
  assert.match(s.text, /WHERE t\.ready AND NOT p\.valid/);
  assert.match(s.text, /ON CONFLICT \(recipient_user_id, use_case_id, kind, rome_day\) DO UPDATE SET\s+last_event_at = greatest\(use_case_notifications\.last_event_at, EXCLUDED\.last_event_at\), read_at = NULL/);
  assert.match(s.text, /INSERT INTO use_case_alert_emails \(workspace_id, recipient_user_id, kind, send_on, scheduled_at, due_at\)/);
  assert.match(s.text, /WHERE em\.status IN \('in_coda', 'errore'\)/);
  assert.doesNotMatch(s.text, /ORDER BY|GROUP BY/);
  assert.match(s.text, /SELECT \(SELECT count\(\*\)::int FROM became\) AS announced$/, "conta le schede, non le persone");
  // Con l'orologio di prova il trimestre viene dall'orologio.
  const clocked = readinessSyncSql({ workspaceId: WS, useCaseIds: [UC], actorUserId: null, readiness: { ...readiness, clock: new Date("2027-02-01T10:00:00Z") } });
  assert.match(clocked.text, /s\.ready_quarter >= '2027-Q1'/);
});

test("destinatari: revisori di Lateral Space verificati, tranne chi ha agito; i domini non validi si scartano", () => {
  const s = toStatement(lsReviewerRecipientsSql(raw("b.workspace_id"), ACTOR, readiness.lsDomains));
  assert.match(s.text, /ru\.email_verified IS NOT NULL AND coalesce\(lower\(substring\(btrim\(ru\.email\) from '@\(\[\^@\]\+\)\$'\)\) = ANY\(\$\d+::text\[\]\), false\)/);
  assert.ok(s.params.some((p) => JSON.stringify(p) === JSON.stringify(["lateralspace.ai", "voltaenergy.xyz"])), JSON.stringify(s.params));
  assert.ok(s.params.includes(ACTOR));
  assert.ok(s.params.some((p) => JSON.stringify(p) === JSON.stringify(["exec_sponsor", "transformation_lead", "function_lead", "analyst"])));
  assert.match(s.text, /LIMIT 200$/);
  assert.doesNotMatch(s.text, /ORDER BY/);
  assert.throws(() => lsReviewerRecipientsSql(raw("x"), "non-un-uuid", []));
});

test("la regola e l'ok in SQL", () => {
  assert.match(toStatement(readyNowSql("u", { dossiers: true })).text, /uc_cases rc/);
  assert.doesNotMatch(toStatement(readyNowSql("u", { dossiers: false })).text, /uc_cases/);
  assert.throws(() => readyNowSql("u;", { dossiers: false }));
  assert.equal(toStatement(subprocessorsAckSql(raw("n.workspace_id"))).text, "EXISTS (SELECT 1 FROM uc_subprocessor_acks ak WHERE ak.workspace_id = n.workspace_id AND ak.list_version = '2026-10')");
});
