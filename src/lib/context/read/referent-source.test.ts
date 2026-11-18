import test from "node:test";
import assert from "node:assert/strict";
import { answersSourceTitle, referentSourceSql, referentSourcesEraseStatements } from "../../db/queries/context-referent.ts";
import { REFERENT_CONTEXT_NOTICE_VERSIONS, noticeAllowsContext } from "../../use-cases/referent/labels.ts";
import { CONTEXT_LIMITS } from "../vocab.ts";

// Le risposte del referente come fonte di «Contesto» (RILASCIO-9b-COSTRUZIONE.md §2.11, §3.2, D2): gli statement che
// la creano, la rimettono da leggere e la svuotano. Id inventati. Le prove sul database stanno in
// read-work.integration.test.ts.

const WS = "3f2a9c1e-0000-4000-8000-0000000000a1";
const REQ = "3f2a9c1e-0000-4000-8000-0000000000e1";
const CONTACT = "3f2a9c1e-0000-4000-8000-0000000000c1";
const flat = (text: string) => text.replace(/\s+/g, " ");

test("solo l'informativa nuova lascia leggere le risposte: ucq-2026-11-3 sì, quella di prima no", () => {
  assert.deepEqual([...REFERENT_CONTEXT_NOTICE_VERSIONS], ["ucq-2026-11-3"]);
  assert.equal(noticeAllowsContext("ucq-2026-11-3"), true);
  for (const old of ["ucq-2026-11-2", "ucq-2026-11-1", "", null, undefined]) assert.equal(noticeAllowsContext(old), false, String(old));
});

test("la fonte: una per richiesta, «Solo Lateral Space», senza testo, da leggere; solo con l'informativa che lo dice e qualcosa di scritto dopo", () => {
  const st = referentSourceSql({ workspaceId: WS, requestId: REQ, title: answersSourceTitle("XX-0012", "Ordini") });
  const text = flat(st.text);
  assert.match(text, /INSERT INTO context_sources \(workspace_id, kind, origin, title, occurred_on, body, body_chars, external_id, visibility, read_status, parts_total, parts_read\)/);
  assert.match(text, /SELECT r\.workspace_id, 'risposta', 'rispondi', \$1::text, \(now\(\) AT TIME ZONE 'Europe\/Rome'\)::date, NULL, 0, r\.id::text, 'ls', 'da_leggere', 1, 0/);
  assert.equal(st.params[0], "Risposte del referente · XX-0012");
  // La richiesta del workspace, viva, con l'informativa che lo permette: le versioni come parametro, mai quella di prima.
  assert.match(text, /WHERE r\.id = \$2::uuid AND r\.workspace_id = \$3::uuid AND r\.purged_at IS NULL AND r\.privacy_accepted_at IS NOT NULL AND r\.privacy_notice_version = ANY\(\$4::text\[\]\)/);
  assert.deepEqual(st.params.slice(1), [REQ, WS, ["ucq-2026-11-3"]]);
  // Qualcosa di scritto dal referente dopo l'informativa: un testo, un commento che non sia «Non ce l'ho», il filo.
  assert.match(text, /a\.source = 'referente' AND a\.status = 'inviata' AND a\.removed_at IS NULL AND coalesce\(a\.edited_at, a\.submitted_at\) >= r\.privacy_accepted_at/);
  assert.match(text, /btrim\(coalesce\(a\.body, ''\)\) <> '' OR \(NOT a\.dont_know AND btrim\(coalesce\(a\.comment, ''\)\) <> ''\)/);
  assert.match(text, /m\.side = 'referente' AND m\.kind IN \('risposta', 'aggiunta'\) AND m\.anchor = 'domanda' AND m\.removed_at IS NULL AND m\.created_at >= r\.privacy_accepted_at/);
  // Una risposta cambiata: la fonte torna da leggere dalla prima parte, mai una fonte con il testo già cancellato.
  assert.match(text, /ON CONFLICT \(workspace_id, origin, external_id\) WHERE external_id IS NOT NULL DO UPDATE SET read_status = 'da_leggere', read_reason = NULL, read_attempts = 0, read_started_at = NULL, read_at = NULL, parts_read = 0/);
  assert.match(text, /WHERE context_sources\.kind = 'risposta' AND context_sources\.text_purged_at IS NULL/);
  // Le proposte aperte non corrette diventano «superate», come una call cambiata su Granola.
  assert.match(text, /UPDATE context_proposals p SET status = 'superata'[^;]*FROM up WHERE NOT up\.created AND p\.source_id = up\.id AND p\.workspace_id = up\.workspace_id AND p\.status = 'aperta' AND NOT p\.edited/);
  // La storia: il canale del referente, nessun attore, solo codici e numeri.
  assert.match(text, /INSERT INTO context_events \(workspace_id, action, channel, source_id, detail\)/);
  assert.match(text, /CASE WHEN up\.created THEN 'fonte_aggiunta' ELSE 'fonte_aggiornata' END, 'rispondi', up\.id/);
  assert.doesNotMatch(text, /actor_user_id|contact_id|requester|email/);
  assert.throws(() => referentSourceSql({ workspaceId: "x", requestId: REQ, title: "t" }));
  assert.throws(() => referentSourceSql({ workspaceId: WS, requestId: "1; DROP TABLE x", title: "t" }));
});

test("il titolo della fonte: «Risposte del referente · codice», o il titolo dello use case; mai oltre 200 caratteri", () => {
  assert.equal(answersSourceTitle("XX-0012", "Ordini"), "Risposte del referente · XX-0012");
  assert.equal(answersSourceTitle(null, "  Ordini\nautomatici "), "Risposte del referente · Ordini automatici");
  assert.equal(answersSourceTitle(null, "x".repeat(400)).length, CONTEXT_LIMITS.titleMax);
});

test("conservazione e cancellazione: la fonte non si legge più, le proposte aperte superate, le citazioni nate da lei tolte", () => {
  for (const [scope, filter, param] of [
    [{ requestId: REQ }, /r\.id = \$\d+::uuid/, REQ],
    [{ contactId: CONTACT }, /r\.contact_id = \$\d+::uuid/, CONTACT],
  ] as const) {
    const statements = referentSourcesEraseStatements({ workspaceId: WS, ...scope });
    const texts = statements.map((s) => flat(s.text));
    assert.equal(statements.length, 6);
    for (const [index, text] of texts.entries()) {
      // Solo le fonti delle risposte del workspace, legate alle richieste giuste.
      assert.match(text, /JOIN use_case_referent_requests r ON r\.workspace_id = cs\.workspace_id AND cs\.external_id = r\.id::text/, String(index));
      assert.match(text, /cs\.origin = 'rispondi' AND cs\.kind = 'risposta'/, String(index));
      assert.match(text, filter, String(index));
      assert.ok(statements[index].params.includes(WS) && statements[index].params.includes(param), String(index));
    }
    assert.match(texts[0], /UPDATE context_sources s SET text_purged_at = now\(\)/);
    assert.match(texts[0], /read_status = CASE WHEN s\.read_status IN \('da_leggere', 'in_lettura'\) THEN 'non_letto' ELSE s\.read_status END/);
    assert.match(texts[0], /WHERE s\.workspace_id = \$\d+::uuid AND s\.text_purged_at IS NULL/, "una seconda volta non cambia niente");
    assert.match(texts[0], /SELECT workspace_id, 'testo_cancellato', 'rispondi', id FROM purged/);
    assert.match(texts[1], /UPDATE context_proposals p SET status = 'superata', decided_at = now\(\), quote = NULL/);
    assert.match(texts[1], /p\.status = 'aperta'/);
    for (const [index, table] of ["context_proposals", "context_facts", "context_commitments", "context_questions"].entries()) {
      assert.match(texts[index + 2], new RegExp(`^UPDATE ${table} x SET quote = NULL WHERE x\\.workspace_id = \\$\\d+::uuid AND x\\.quote IS NOT NULL AND x\\.source_id IN \\(`), table);
    }
    // I fatti restano: si toglie solo la citazione.
    assert.ok(!texts.some((t) => /DELETE FROM context_|status = 'ritirato'|UPDATE context_facts[^;]*statement/.test(t)));
  }
  assert.throws(() => referentSourcesEraseStatements({ workspaceId: WS }));
  assert.throws(() => referentSourcesEraseStatements({ workspaceId: WS, requestId: REQ, contactId: CONTACT }));
  assert.throws(() => referentSourcesEraseStatements({ workspaceId: WS, contactId: "mario@example.test" }));
});
