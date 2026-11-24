import test from "node:test";
import assert from "node:assert/strict";
import {
  AIR_EMAIL_CLAIM_LOCK,
  airEmailFactsSql,
  airEmailMembersSql,
  beginAirEmailAttemptSql,
  cancelInterruptedAirEmailsSql,
  claimAirEmailsStatements,
  markAirEmailCancelledSql,
  markAirEmailFailedSql,
  markAirEmailSentStatements,
  markAirEmailUncertainSql,
  queueAirEmailStatements,
  setAirEmailSwitchSql,
} from "./email-sql.ts";

// Le regole che il database applica alla coda delle email dell'AI Readiness (0044), lette nelle istruzioni: una riga in
// attesa per rilevazione, persona e tipo; i risultati una volta; un'email al giorno per rilevazione e persona, prima i
// risultati; il conteggio delle risposte nuove; il segno del tentativo; la riga del giorno dopo. La stessa cosa sul
// database: src/lib/db/queries/ai-readiness-email.integration.test.ts. Id inventati.

const WS = "3f2a9c1e-0000-4000-8000-0000000000a1";
const AS = "3f2a9c1e-0000-4000-8000-0000000000c1";
const U1 = "3f2a9c1e-0000-4000-8000-0000000000d1";
const U2 = "3f2a9c1e-0000-4000-8000-0000000000d2";
const ROW = "3f2a9c1e-0000-4000-8000-0000000000e1";
const flat = (text: string) => text.replace(/\s+/g, " ").trim();

test("chi: il ruolo di adesso come la porta del workspace (l'organizzazione, mai «Solo questo use case», poi il workspace), l'email verificata e la scelta", () => {
  const s = airEmailMembersSql(WS);
  const text = flat(s.text);
  assert.match(text, /m\.organization_id = w\.organization_id AND m\.role::text <> 'esterno_caso' LIMIT 1\), \(SELECT wm\.role::text FROM workspace_memberships wm WHERE wm\.user_id = u\.id AND wm\.workspace_id = w\.id LIMIT 1\) \) AS role/);
  assert.match(text, /u\.email_verified IS NOT NULL AS verified/);
  assert.match(text, /coalesce\(b\.ai_readiness_emails, true\) AS switch_on/, "accesa senza riga");
  assert.deepEqual(s.params, [WS]);
});

test("in coda: «risultati» solo quando nasce la soglia, poi «risposte»; un doppione non scrive niente; mai fuori dal workspace", () => {
  const countsFrom = new Date("2026-11-24T09:00:00Z");
  assert.deepEqual(queueAirEmailStatements({ workspaceId: WS, assessmentId: AS, recipients: [], countsFrom, resultsReady: true }), [], "nessuno: niente");
  const answers = queueAirEmailStatements({ workspaceId: WS, assessmentId: AS, recipients: [U1, U2], countsFrom, resultsReady: false });
  assert.equal(answers.length, 1);
  assert.deepEqual(answers[0].params, ["risposte", countsFrom.toISOString(), [U1, U2], AS, WS]);
  const both = queueAirEmailStatements({ workspaceId: WS, assessmentId: AS, recipients: [U1], countsFrom, resultsReady: true });
  assert.deepEqual(both.map((s) => s.params[0]), ["risultati", "risposte"]);
  for (const s of both) {
    const text = flat(s.text);
    assert.match(text, /ON CONFLICT DO NOTHING$/, "una riga in attesa per tipo, i risultati una volta: gli indici unici decidono");
    assert.match(text, /least\(\$2::timestamptz, now\(\)\)/, "le risposte nuove si contano dall'invio, mai da dopo l'orologio del database");
    assert.match(text, /JOIN ai_readiness_assessments a ON a\.id = \$4::uuid AND a\.workspace_id = \$5::uuid/, "solo una rilevazione di questo workspace");
  }
});

test("il giro: uno alla volta (advisory lock), una riga per rilevazione e persona (prima i risultati), mai due email nello stesso giorno", () => {
  const now = new Date("2026-11-24T09:30:00Z");
  const dayStart = new Date("2026-11-23T23:00:00Z");
  const [lock, claim] = claimAirEmailsStatements({ now, dayStart, limit: 50 });
  assert.equal(flat(lock.text), "SELECT pg_advisory_xact_lock(hashtext($1::text))");
  assert.deepEqual(lock.params, [AIR_EMAIL_CLAIM_LOCK]);
  const text = flat(claim.text);
  assert.match(text, /row_number\(\) OVER \(PARTITION BY e\.assessment_id, e\.recipient_user_id ORDER BY \(e\.kind = 'risultati'\) DESC, e\.scheduled_at, e\.id\) AS n/);
  assert.match(text, /JOIN ranked r ON r\.id = e\.id AND r\.n = 1/, "una sola per coppia");
  // Il limite del giorno: un'email partita oggi, o dall'esito incerto oggi, ferma la coppia fino a domani.
  assert.match(text, /\(x\.status = 'inviata' AND x\.sent_at >= \$\d+::timestamptz\)/);
  assert.match(text, /\(x\.cancel_reason = 'esito_incerto' AND x\.counted_until >= \$\d+::timestamptz\)/);
  // Una riga della stessa coppia presa o con un tentativo segnato: la coppia aspetta.
  assert.match(text, /x\.status IN \('in_coda', 'errore'\) AND \(x\.lease_until > \$\d+::timestamptz OR x\.attempt_started_at IS NOT NULL\)/);
  assert.match(text, /e\.attempt_started_at IS NULL/);
  assert.match(text, /\(e\.status = 'in_coda' OR \(e\.status = 'errore' AND e\.attempts < 3\)\)/);
  assert.match(text, /FOR UPDATE OF e SKIP LOCKED/);
  assert.ok(claim.params.includes(dayStart.toISOString()) && claim.params.includes(now.toISOString()) && claim.params.includes(50));
});

test("il conteggio: le risposte inviate dall'ultima email (partita o dall'esito incerto) o dall'invio della riga, fino all'orologio del database", () => {
  const text = flat(airEmailFactsSql(ROW).text);
  assert.match(text, /x\.counted_until IS NOT NULL AND \(x\.status = 'inviata' OR x\.cancel_reason = 'esito_incerto'\)/);
  assert.match(text, /since AS \(SELECT coalesce\(\(SELECT until FROM last\), \(SELECT counts_from FROM e\)\) AS at\)/);
  assert.match(text, /\(r\.submitted_at AT TIME ZONE 'UTC'\) >= s\.at AND \(r\.submitted_at AT TIME ZONE 'UTC'\) < now\(\)\) AS new_answers/);
  assert.match(text, /SELECT now\(\) AS counted_until/);
  assert.match(text, /LEFT JOIN ai_readiness_assessments a ON a\.id = e\.assessment_id AND a\.workspace_id = e\.workspace_id/, "la rilevazione solo di questo workspace");
  // Mai un dato di una persona che ha risposto: solo conteggi.
  assert.doesNotMatch(text, /\br\.(answers|free_text_answers|derived_scores|respondent_id|pseudonymous_id|metadata)\b|ai_readiness_respondents/);
});

test("mai due volte: il segno del tentativo su una riga ancora in attesa, una volta; un esito incerto annulla; tre errori certi annullano", () => {
  const begin = flat(beginAirEmailAttemptSql(ROW, new Date("2026-11-24T09:30:00Z")).text);
  assert.match(begin, /SET attempt_started_at = now\(\), counted_until = \$1::timestamptz, attempts = least\(3, attempts \+ 1\)/);
  assert.match(begin, /WHERE id = \$2::uuid AND status IN \('in_coda', 'errore'\) AND attempt_started_at IS NULL RETURNING attempts$/);
  assert.match(flat(markAirEmailUncertainSql(ROW, "timeout").text), /SET status = 'annullata', cancel_reason = 'esito_incerto'/);
  const failed = flat(markAirEmailFailedSql(ROW, "validation_error").text);
  assert.match(failed, /status = CASE WHEN attempts >= 3 THEN 'annullata' ELSE 'errore' END/);
  assert.match(failed, /cancel_reason = CASE WHEN attempts >= 3 THEN 'tentativi_finiti' ELSE cancel_reason END/);
  assert.match(failed, /attempt_started_at = NULL/, "un errore certo: l'email non è partita, si può riprovare");
  assert.match(flat(cancelInterruptedAirEmailsSql(new Date()).text), /attempt_started_at IS NOT NULL AND \(lease_until IS NULL OR lease_until <= \$1::timestamptz\)/, "un processo interrotto a metà: mai ripetuto");
  assert.match(flat(markAirEmailCancelledSql(ROW, "email_spenta").text), /AND attempt_started_at IS NULL$/, "il piano non annulla una riga con un tentativo in corso");
});

test("partita: «inviata», e se intanto sono arrivate risposte la riga del giorno dopo le aspetta", () => {
  const [sent, follow] = markAirEmailSentStatements(ROW);
  assert.match(flat(sent.text), /SET status = 'inviata', sent_at = now\(\)/);
  assert.match(flat(sent.text), /AND attempt_started_at IS NOT NULL$/);
  const text = flat(follow.text);
  assert.match(text, /SELECT e\.workspace_id, e\.assessment_id, e\.recipient_user_id, 'risposte', e\.counted_until, now\(\)/);
  assert.match(text, /\(r\.submitted_at AT TIME ZONE 'UTC'\) >= e\.counted_until\)/);
  assert.match(text, /ON CONFLICT DO NOTHING$/);
});

test("la scelta: una sola colonna, accesa per default, la riga nasce se manca", () => {
  const s = setAirEmailSwitchSql(WS, U1, false);
  const text = flat(s.text);
  assert.match(text, /INSERT INTO workspace_bell_state \(workspace_id, user_id, ai_readiness_emails, updated_at\)/);
  assert.match(text, /ON CONFLICT \(workspace_id, user_id\) DO UPDATE SET ai_readiness_emails = EXCLUDED\.ai_readiness_emails, updated_at = now\(\)/);
  assert.deepEqual(s.params, [WS, U1, false]);
});
