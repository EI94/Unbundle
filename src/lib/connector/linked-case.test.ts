import test from "node:test";
import assert from "node:assert/strict";
import {
  LINKED_CASE_CODES_SQL,
  linkedCaseCodeOf,
  linkedCaseCodes,
  linkedCases,
  UC_CASES_PRESENT_QUERY,
  UC_CASES_PRESENT_SQL,
  ucCasesEnabled,
} from "./linked-case.ts";
import type { SqlExecutor } from "./rate-limit.ts";

// Dossier dei Casi d'uso collegati (prompt WP6, DESIGN §10.4) con un esecutore finto.
// La stessa SQL sul database locale è in `status-search.integration.test.ts`.

const WS = "11111111-1111-4111-8111-111111111111";
const UC1 = "33333333-3333-4333-8333-333333333333";
const UC2 = "44444444-4444-4444-8444-444444444444";

function recorder(answer: (text: string) => Array<Record<string, unknown>> | Error) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const exec: SqlExecutor = async (text, params) => {
    calls.push({ text, params });
    const out = answer(text);
    if (out instanceof Error) throw out;
    return out;
  };
  return { exec, calls };
}

const ON = { enabled: true };

test("interruttore: solo UC_ENABLED uguale a true", () => {
  assert.equal(ucCasesEnabled({ UC_ENABLED: "true" }), true);
  for (const value of [undefined, "", "TRUE", "1", "yes", " true"]) assert.equal(ucCasesEnabled({ UC_ENABLED: value }), false, String(value));
});

test("SQL: solo dossier completi dello stesso workspace, il più vecchio per segnalazione", () => {
  assert.match(LINKED_CASE_CODES_SQL, /FROM uc_cases c/);
  assert.match(LINKED_CASE_CODES_SQL, /c\.workspace_id = \$1/);
  assert.match(LINKED_CASE_CODES_SQL, /c\.portfolio_use_case_id = ANY\(\$2::uuid\[\]\)/);
  assert.match(LINKED_CASE_CODES_SQL, /c\.setup_completed_at IS NOT NULL/);
  assert.match(LINKED_CASE_CODES_SQL, /DISTINCT ON \(c\.portfolio_use_case_id\)/);
  assert.match(LINKED_CASE_CODES_SQL, /ORDER BY c\.portfolio_use_case_id, c\.created_at, c\.id/);
  // Giorno dell'avvio in ora italiana (setup_completed_at è timestamptz).
  assert.match(LINKED_CASE_CODES_SQL, /to_char\(c\.setup_completed_at AT TIME ZONE 'Europe\/Rome', 'YYYY-MM-DD'\) AS started_on/);
  assert.equal(UC_CASES_PRESENT_SQL, "to_regclass('public.uc_cases') IS NOT NULL");
  assert.equal(UC_CASES_PRESENT_QUERY, `SELECT ${UC_CASES_PRESENT_SQL} AS uc_present`);
});

test("senza sezione, senza tabella o senza id validi il database non si tocca", async () => {
  const r = recorder(() => [{ use_case_id: UC1, code: "AB-UC-01" }]);
  assert.equal((await linkedCaseCodes(r.exec, { workspaceId: WS, useCaseIds: [UC1], ucPresent: true }, { enabled: false })).size, 0);
  assert.equal((await linkedCaseCodes(r.exec, { workspaceId: WS, useCaseIds: [UC1], ucPresent: false }, ON)).size, 0);
  assert.equal((await linkedCaseCodes(r.exec, { workspaceId: WS, useCaseIds: ["non-un-id", ""], ucPresent: true }, ON)).size, 0);
  assert.equal((await linkedCaseCodes(r.exec, { workspaceId: "ws", useCaseIds: [UC1], ucPresent: true }, ON)).size, 0);
  assert.equal(r.calls.length, 0);
});

test("codici per segnalazione; un valore che non è un codice di caso non esce", async () => {
  const r = recorder(() => [
    { use_case_id: UC1.toUpperCase(), code: "AB-UC-01" },
    { use_case_id: UC2, code: "testo libero con spazi" },
  ]);
  const codes = await linkedCaseCodes(r.exec, { workspaceId: WS, useCaseIds: [UC1, UC2, UC1], ucPresent: true }, ON);
  assert.deepEqual([...codes], [[UC1, "AB-UC-01"]]);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].text, LINKED_CASE_CODES_SQL);
  assert.deepEqual(r.calls[0].params, [WS, [UC1, UC2]]);
});

test("dossier con il giorno dell'avvio; un giorno illeggibile diventa null", async () => {
  const r = recorder(() => [
    { use_case_id: UC1, code: "AB-UC-01", started_on: "2026-10-16" },
    { use_case_id: UC2, code: "AB-UC-02", started_on: "ieri" },
  ]);
  const cases = await linkedCases(r.exec, { workspaceId: WS, useCaseIds: [UC1, UC2], ucPresent: true }, ON);
  assert.deepEqual([...cases], [
    [UC1, { code: "AB-UC-01", startedOn: "2026-10-16" }],
    [UC2, { code: "AB-UC-02", startedOn: null }],
  ]);
});

test("un errore della lettura uc non rompe il tool: nessun codice, log senza dati", async () => {
  const logs: string[] = [];
  const log = { error: (...args: unknown[]) => logs.push(args.map(String).join(" ")) };
  const r = recorder(() => Object.assign(new Error(`relation "uc_cases" ... ${UC1} AB-UC-01`), { code: "42P01" }));
  const codes = await linkedCaseCodes(r.exec, { workspaceId: WS, useCaseIds: [UC1], ucPresent: true }, { enabled: true, log });
  assert.equal(codes.size, 0);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /\[connector\] linked_case_failed/);
  assert.match(logs[0], /42P01/);
  assert.equal(logs[0].includes(UC1) || logs[0].includes("AB-UC-01"), false);
});

test("una sola segnalazione (invio ritrovato): verifica della tabella, poi il codice", async () => {
  const present = recorder((text) => (text === UC_CASES_PRESENT_QUERY ? [{ uc_present: true }] : [{ use_case_id: UC1, code: "AB-UC-01" }]));
  assert.equal(await linkedCaseCodeOf(present.exec, { workspaceId: WS, useCaseId: UC1 }, ON), "AB-UC-01");
  assert.deepEqual(present.calls.map((c) => c.text), [UC_CASES_PRESENT_QUERY, LINKED_CASE_CODES_SQL]);

  const absent = recorder(() => [{ uc_present: false }]);
  assert.equal(await linkedCaseCodeOf(absent.exec, { workspaceId: WS, useCaseId: UC1 }, ON), null);
  assert.equal(absent.calls.length, 1, "senza tabella nessuna query su uc_cases");

  const off = recorder(() => [{ uc_present: true }]);
  assert.equal(await linkedCaseCodeOf(off.exec, { workspaceId: WS, useCaseId: UC1 }, { enabled: false }), null);
  assert.equal(off.calls.length, 0);

  const logs: string[] = [];
  const broken = recorder(() => new Error("connessione persa"));
  assert.equal(await linkedCaseCodeOf(broken.exec, { workspaceId: WS, useCaseId: UC1 }, { enabled: true, log: { error: (...a: unknown[]) => logs.push(a.map(String).join(" ")) } }), null);
  assert.equal(logs.length, 1);
  assert.doesNotMatch(logs[0], /connessione persa/);
});
