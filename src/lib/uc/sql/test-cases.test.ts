import test from "node:test";
import assert from "node:assert/strict";
import type { TestCaseRow } from "../test-cases.ts";
import { testCasesImportStatements, testCasesImportSummary } from "./test-cases.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const CASE = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

const row = (over: Partial<TestCaseRow> = {}): TestCaseRow => ({
  key: "caso.sintetico.01",
  kind: "sintetico",
  input: { richiesta: "Due persone, sabato" },
  expected: { atteso: "Strategia A", regole: ["rule.esempio.priorita"] },
  covers: ["dato mancante"],
  serve_per: ["backtest"],
  ...over,
});

test("synthetic cases: case-open and lead guards, then one upsert with its audit event", () => {
  const s = testCasesImportStatements({ workspaceId: WS, caseId: CASE, actorUserId: USER, rows: [row(), row({ key: "caso.sintetico.02" })], format: "csv" });
  assert.equal(s.length, 3);
  assert.match(s[0].text, /uc_require\(EXISTS \([\s\S]*status <> 'chiuso'[\s\S]*'caso_chiuso'\)/);
  assert.match(s[1].text, /role = 'ls_lead'[\s\S]*'attore_non_ammesso'/);
  const upsert = s[2];
  assert.match(upsert.text, /INSERT INTO uc_test_cases AS t/);
  assert.match(upsert.text, /ON CONFLICT \(case_id, key\) DO UPDATE SET/);
  assert.match(upsert.text, /last_result = 'non_eseguito', last_run_id = NULL, approved_by_contact_id = NULL, approved_at = NULL/);
  assert.match(upsert.text, /IS DISTINCT FROM \(EXCLUDED\.kind/);
  assert.match(upsert.text, /ev AS \(\s*INSERT INTO uc_events/);
  assert.match(upsert.text, /jsonb_build_object\('counts', s\.counts\)/);
  // Texts travel only as parameters, never inside the SQL.
  assert.ok(!upsert.text.includes("Due persone"));
  const recordset = JSON.parse(upsert.params.find((p) => typeof p === "string" && p.includes("caso.sintetico.02")) as string) as unknown[];
  assert.equal(recordset.length, 2);
  // The event payload carries only counts and format.
  assert.ok(upsert.params.includes("casi_prova.importati"));
  const payload = upsert.params.map((p) => (typeof p === "string" && p.startsWith("{") ? (JSON.parse(p) as Record<string, unknown>) : null)).find((p) => p && "format" in p);
  assert.deepEqual(payload, { count: 2, format: "csv" });
});

test("pseudonymized cases add the A.8 guard in the same batch", () => {
  const s = testCasesImportStatements({ workspaceId: WS, caseId: CASE, actorUserId: USER, rows: [row(), row({ key: "caso.reale.01", kind: "pseudonimizzato" })], format: "json" });
  assert.equal(s.length, 4);
  assert.match(s[2].text, /key = 'a8' AND status = 'sciolto'[\s\S]*'a8_non_sciolto'/);
});

test("an empty import is a programming error; the summary counts unchanged rows", () => {
  assert.throws(() => testCasesImportStatements({ workspaceId: WS, caseId: CASE, actorUserId: USER, rows: [], format: "json" }));
  assert.deepEqual(testCasesImportSummary([{ inserted: 2, updated: "1" }], 5), { total: 5, inserted: 2, updated: 1, unchanged: 2 });
  assert.deepEqual(testCasesImportSummary(undefined, 3), { total: 3, inserted: 0, updated: 0, unchanged: 3 });
});
