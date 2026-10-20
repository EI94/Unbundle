import test from "node:test";
import assert from "node:assert/strict";
import { connectorSearchVectorSql } from "../db/connector-ddl.ts";
import { LINKED_CASE_CODES_SQL, UC_CASES_PRESENT_SQL } from "./linked-case.ts";
import type { SqlExecutor } from "./rate-limit.ts";
import {
  COMPLETED_SUBMISSION_SQL,
  contributionStatusByCode,
  findCompletedSubmissionUseCaseId,
  relatedCodeExists,
  SEARCH_CONTRIBUTIONS_SQL,
  SEARCH_MAX_WORDS,
  SEARCH_TSQUERY_SQL,
  SEARCH_VECTOR_SQL,
  searchContributions,
  STATUS_BY_CODE_SQL,
  searchQueryText,
  searchWords,
  statusViewOfRow,
  SUBMITTED_ROME,
} from "./tool-queries.ts";

// Letture dei tool del connettore (prompt WP5) con un esecutore finto. La stessa SQL
// sul database locale è in `route.integration.test.ts`.

function recorder(rows: Array<Record<string, unknown>> = []) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const exec: SqlExecutor = async (text, params) => {
    calls.push({ text, params });
    return rows;
  };
  return { exec, calls };
}

const BASE_ROW = {
  code: "XA-0003",
  title: "Controllo delle fatture in arrivo",
  kind: "use_case_ai",
  area: "amministrazione",
  month: "2026-10",
  related_agent: null,
  status: "proposed",
  review_status: "in_review",
  reviewed_by: null,
  public_note: null,
  possible_duplicate_of: null,
  archive_reason: null,
  duplicate_of_code: null,
  review_by: null,
  hidden_from_search: null,
  status_changed_on: "2026-10-12",
};

test("ricerca: parole con accenti e apostrofi, senza simboli né doppioni", () => {
  assert.deepEqual(searchWords("Controllo dell'aereo: però ÈSTATO città"), ["Controllo", "dell", "aereo", "però", "ÈSTATO", "città"]);
  assert.deepEqual(searchWords("fattura  Fattura FATTURA"), ["fattura"]);
  assert.deepEqual(searchWords("a | b & !c <-> d:*"), ["a", "b", "c", "d"]);
  assert.deepEqual(searchWords("l’ordine `fornitori` «urgenti»"), ["l", "ordine", "fornitori", "urgenti"]);
  // Forma decomposta (e + accento) ricomposta prima di filtrare.
  assert.deepEqual(searchWords("perché"), ["perché"]);
  assert.deepEqual(searchWords("!!! ???"), []);
  assert.equal(searchWords(Array.from({ length: 30 }, (_, i) => `parola${i}`).join(" ")).length, SEARCH_MAX_WORDS);
  assert.equal(searchQueryText(["fatture", "fornitori", "città"]), "fatture or fornitori or città");
});

test("ricerca: SQL chiusa nel workspace, parametri, solo le colonne del contratto", async () => {
  const { exec, calls } = recorder([{ ...BASE_ROW, proposed_by: "Persona Inventata", review_notes: "interna" }]);
  const results = await searchContributions(exec, {
    workspaceId: "ws-a",
    input: { query: "fatture dell'anno", area: "amministrazione", limit: 5 },
  });
  assert.equal(calls[0].text, SEARCH_CONTRIBUTIONS_SQL);
  assert.deepEqual(calls[0].params, ["ws-a", "fatture or dell or anno", "amministrazione", null, 5]);
  assert.deepEqual(results, [
    {
      code: "XA-0003",
      title: "Controllo delle fatture in arrivo",
      area: "amministrazione",
      kind: "use_case_ai",
      statusCode: "IN_VALUTAZIONE",
      statusLabel: "In valutazione",
      month: "2026-10",
      relatedAgent: null,
    },
  ]);
  for (const forbidden of ["proposed_by", "submitter", "review_notes", "overall", "custom_scores", "reviewed_at", "public_note IS"]) {
    assert.equal(SEARCH_CONTRIBUTIONS_SQL.includes(forbidden), false, forbidden);
  }
  assert.match(SEARCH_CONTRIBUTIONS_SQL, /u\.workspace_id = \$1/);
  assert.match(SEARCH_CONTRIBUTIONS_SQL, /u\.code IS NOT NULL/);
  assert.match(SEARCH_CONTRIBUTIONS_SQL, /hiddenFromSearch/);
  assert.match(SEARCH_CONTRIBUTIONS_SQL, /'duplicato'/);
  // Ricerca senza accenti (coda della 0019): documento e query passano da connector_unaccent,
  // con l'espressione dell'indice use_cases_search_italian_unaccent_idx.
  assert.equal(SEARCH_VECTOR_SQL, connectorSearchVectorSql("u."));
  assert.equal(SEARCH_TSQUERY_SQL, "websearch_to_tsquery('italian', public.connector_unaccent($2))");
  assert.ok(SEARCH_CONTRIBUTIONS_SQL.includes(`SELECT ${SEARCH_TSQUERY_SQL} AS query`));
  assert.ok(SEARCH_CONTRIBUTIONS_SQL.includes(`AND ${SEARCH_VECTOR_SQL} @@ q.query`));
  assert.ok(SEARCH_CONTRIBUTIONS_SQL.includes(`ts_rank_cd(${SEARCH_VECTOR_SQL}, q.query)`));
  // Il mese in ora italiana, come il giorno dello stato (le colonne sono in UTC senza fuso).
  assert.ok(SEARCH_CONTRIBUTIONS_SQL.includes(`to_char(${SUBMITTED_ROME}, 'YYYY-MM') AS month`));
  assert.match(SUBMITTED_ROME, /AT TIME ZONE 'UTC'\) AT TIME ZONE 'Europe\/Rome'/);
  // Una ricerca senza parole non tocca il database.
  const empty = recorder();
  assert.deepEqual(await searchContributions(empty.exec, { workspaceId: "ws-a", input: { query: "?!?", limit: 5 } }), []);
  assert.equal(empty.calls.length, 0);
});

test("stato: vista completa, oppure ridotta per una segnalazione nascosta", () => {
  const full = statusViewOfRow({ ...BASE_ROW, public_note: "Ne parliamo al prossimo incontro.", duplicate_of_code: "testo libero" });
  assert.deepEqual(full, {
    code: "XA-0003",
    title: "Controllo delle fatture in arrivo",
    kind: "use_case_ai",
    area: "amministrazione",
    statusCode: "IN_VALUTAZIONE",
    statusLabel: "In valutazione",
    statusChangedAt: "2026-10-12",
    publicNote: "Ne parliamo al prossimo incontro.",
    linkedCaseCode: null,
    duplicateOfCode: null,
  });
  const hidden = statusViewOfRow({ ...BASE_ROW, hidden_from_search: "true", public_note: "Nota", review_status: "archived", archive_reason: "duplicato", duplicate_of_code: "XA-0001" });
  assert.deepEqual(hidden, {
    code: "XA-0003",
    title: null,
    kind: null,
    area: null,
    statusCode: "DOPPIONE",
    statusLabel: "Unita a XA-0001",
    statusChangedAt: "2026-10-12",
    publicNote: null,
    linkedCaseCode: null,
    duplicateOfCode: null,
  });
  // review_by (0020) presente: la scheda rimandata si legge «Valutata».
  assert.equal(statusViewOfRow({ ...BASE_ROW, review_by: "2027-01-15" })?.statusCode, "VALUTATA");
  assert.equal(statusViewOfRow({ ...BASE_ROW, public_note: "x".repeat(1500) })?.publicNote?.length, 1000);
  assert.equal(statusViewOfRow({ ...BASE_ROW, code: null }), null);
});

const UC_ID = "33333333-3333-4333-8333-333333333333";

/** Esecutore finto con due risposte: la riga della segnalazione e i dossier collegati. */
function withCases(row: Record<string, unknown>, cases: Array<Record<string, unknown>>) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const exec: SqlExecutor = async (text, params) => {
    calls.push({ text, params });
    return text === LINKED_CASE_CODES_SQL ? cases : [row];
  };
  return { exec, calls };
}

test("dossier avviato: stato AVVIATA_COME_CASO e linkedCaseCode, solo con UC_ENABLED e la tabella", async () => {
  const row = { ...BASE_ROW, id: UC_ID, uc_present: true, status: "accepted", review_status: "scored" };
  const cases = [{ use_case_id: UC_ID, code: "XA-UC-01" }];
  const on = withCases(row, cases);
  const view = await contributionStatusByCode(on.exec, { workspaceId: "11111111-1111-4111-8111-111111111111", code: "XA-0003" }, { enabled: true });
  assert.equal(view?.statusCode, "AVVIATA_COME_CASO");
  assert.equal(view?.statusLabel, "Avviata come caso d'uso");
  assert.equal(view?.linkedCaseCode, "XA-UC-01");
  assert.deepEqual(on.calls.map((c) => c.text), [STATUS_BY_CODE_SQL, LINKED_CASE_CODES_SQL]);
  assert.deepEqual(on.calls[1].params, ["11111111-1111-4111-8111-111111111111", [UC_ID]]);
  // La ricerca usa lo stesso stato.
  const search = withCases(row, cases);
  const [hit] = await searchContributions(search.exec, { workspaceId: "11111111-1111-4111-8111-111111111111", input: { query: "fatture", limit: 5 } }, { enabled: true });
  assert.equal(hit.statusCode, "AVVIATA_COME_CASO");
  assert.equal(Object.hasOwn(hit, "linkedCaseCode"), false, "la ricerca non ha linkedCaseCode");
  // Sezione spenta (predefinito) o tabella assente: nessuna query su uc_cases, stato APPROVATA.
  for (const [opts, present] of [[undefined, true], [{ enabled: true }, false]] as const) {
    const off = withCases({ ...row, uc_present: present }, cases);
    const plain = await contributionStatusByCode(off.exec, { workspaceId: "11111111-1111-4111-8111-111111111111", code: "XA-0003" }, opts);
    assert.equal(plain?.statusCode, "APPROVATA");
    assert.equal(plain?.linkedCaseCode, null);
    assert.equal(off.calls.length, 1);
  }
  // Senza il giorno del dossier (valore non leggibile) resta il giorno della scheda.
  assert.equal(view?.statusChangedAt, "2026-10-12");
  // Nascosta: forma ridotta, linkedCaseCode null, ma lo stato resta quello del caso avviato.
  const hidden = withCases({ ...row, hidden_from_search: "true" }, cases);
  const reduced = await contributionStatusByCode(hidden.exec, { workspaceId: "11111111-1111-4111-8111-111111111111", code: "XA-0003" }, { enabled: true });
  assert.deepEqual(reduced, {
    code: "XA-0003",
    title: null,
    kind: null,
    area: null,
    statusCode: "AVVIATA_COME_CASO",
    statusLabel: "Avviata come caso d'uso",
    statusChangedAt: "2026-10-12",
    publicNote: null,
    linkedCaseCode: null,
    duplicateOfCode: null,
  });
});

test("AVVIATA_COME_CASO: statusChangedAt è il giorno dell'avvio del dossier (setup_completed_at, ora italiana)", async () => {
  const ws = "11111111-1111-4111-8111-111111111111";
  const row = { ...BASE_ROW, id: UC_ID, uc_present: true, status: "accepted", review_status: "scored", status_changed_on: "2026-10-01" };
  const cases = [{ use_case_id: UC_ID, code: "XA-UC-01", started_on: "2026-10-16" }];
  const started = await contributionStatusByCode(withCases(row, cases).exec, { workspaceId: ws, code: "XA-0003" }, { enabled: true });
  assert.equal(started?.statusCode, "AVVIATA_COME_CASO");
  assert.equal(started?.statusChangedAt, "2026-10-16");
  // Anche nella forma ridotta di una nascosta.
  const hidden = await contributionStatusByCode(withCases({ ...row, hidden_from_search: "true" }, cases).exec, { workspaceId: ws, code: "XA-0003" }, { enabled: true });
  assert.equal(hidden?.statusChangedAt, "2026-10-16");
  // Uno stato che vince sul dossier (REALIZZATA) tiene il giorno della scheda.
  const done = await contributionStatusByCode(withCases({ ...row, status: "implemented" }, cases).exec, { workspaceId: ws, code: "XA-0003" }, { enabled: true });
  assert.equal(done?.statusCode, "REALIZZATA");
  assert.equal(done?.statusChangedAt, "2026-10-01");
  // Senza sezione accesa il dossier non conta: APPROVATA con il giorno della scheda.
  const off = await contributionStatusByCode(withCases(row, cases).exec, { workspaceId: ws, code: "XA-0003" });
  assert.equal(off?.statusCode, "APPROVATA");
  assert.equal(off?.statusChangedAt, "2026-10-01");
  // Un valore che non è un giorno non esce.
  const odd = await contributionStatusByCode(withCases(row, [{ ...cases[0], started_on: "16/10/2026" }]).exec, { workspaceId: ws, code: "XA-0003" }, { enabled: true });
  assert.equal(odd?.statusChangedAt, "2026-10-01");
  // Le fasi d'esempio della funzione pura.
  assert.equal(statusViewOfRow(row, { code: "XA-UC-01", startedOn: "2026-10-16" })?.statusChangedAt, "2026-10-16");
  assert.equal(statusViewOfRow(row, null)?.statusChangedAt, "2026-10-01");
});

test("SQL dello stato: chiusa nel workspace, tabella uc letta con to_regclass, mai chi propone, note interne o punteggi", () => {
  assert.match(STATUS_BY_CODE_SQL, /u\.workspace_id = \$1 AND u\.code = \$2/);
  assert.ok(STATUS_BY_CODE_SQL.includes(`${UC_CASES_PRESENT_SQL} AS uc_present`));
  assert.ok(SEARCH_CONTRIBUTIONS_SQL.includes(`${UC_CASES_PRESENT_SQL} AS uc_present`));
  assert.match(STATUS_BY_CODE_SQL, /to_char\(u\.status_changed_at AT TIME ZONE 'Europe\/Rome', 'YYYY-MM-DD'\)/);
  assert.match(STATUS_BY_CODE_SQL, /to_jsonb\(u\) ->> 'review_by'/);
  for (const forbidden of ["proposed_by", "submitter", "review_notes", "overall", "custom_scores", "ai_suggestion", "impact_"]) {
    assert.equal(STATUS_BY_CODE_SQL.includes(forbidden), false, forbidden);
  }
});

test("stato per codice e codice collegato: un formato errato non tocca il database", async () => {
  const { exec, calls } = recorder();
  assert.equal(await contributionStatusByCode(exec, { workspaceId: "ws-a", code: "xa-1" }), null);
  assert.equal(await relatedCodeExists(exec, "ws-a", "XA-1"), false);
  assert.equal(calls.length, 0);
  assert.equal(await contributionStatusByCode(exec, { workspaceId: "ws-a", code: "XA-0003" }), null);
  assert.deepEqual(calls[0].params, ["ws-a", "XA-0003"]);
  const found = recorder([{ found: 1 }]);
  assert.equal(await relatedCodeExists(found.exec, "ws-a", "XA-0003"), true);
  assert.deepEqual(found.calls[0].params, ["ws-a", "XA-0003"]);
});

test("idempotenza: solo una chiave completata con lo stesso contenuto è un duplicato", async () => {
  const params = { workspaceId: "ws-a", principalKey: "token:t", idempotencyKey: "chiave-0001", requestHash: "h1" };
  const done = recorder([{ request_hash: "h1", status: "completed", use_case_id: "uc-1", reserved_use_case_id: "uc-1" }]);
  assert.equal(await findCompletedSubmissionUseCaseId(done.exec, params), "uc-1");
  assert.equal(done.calls[0].text, COMPLETED_SUBMISSION_SQL);
  assert.deepEqual(done.calls[0].params, ["ws-a", "token:t", "chiave-0001"]);
  for (const row of [
    { request_hash: "h2", status: "completed", use_case_id: "uc-1", reserved_use_case_id: "uc-1" },
    { request_hash: "h1", status: "pending", use_case_id: null, reserved_use_case_id: "uc-1" },
    { request_hash: "h1", status: "failed", use_case_id: null, reserved_use_case_id: "uc-1" },
  ]) {
    assert.equal(await findCompletedSubmissionUseCaseId(recorder([row]).exec, params), null);
  }
  assert.equal(await findCompletedSubmissionUseCaseId(recorder([]).exec, params), null);
});
