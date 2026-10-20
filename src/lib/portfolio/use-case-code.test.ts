import test from "node:test";
import assert from "node:assert/strict";
import {
  ASSIGN_USE_CASE_CODE_SQL,
  formatUseCaseCode,
  USE_CASE_CODE_MAX_SEQ,
  USE_CASE_CODE_PATTERN,
} from "./use-case-code.ts";

test("formato: prefisso, trattino, 4 cifre con zeri davanti", () => {
  assert.equal(formatUseCaseCode("TJ", 1), "TJ-0001");
  assert.equal(formatUseCaseCode("TJ", 12), "TJ-0012");
  assert.equal(formatUseCaseCode("ABCD", 9999), "ABCD-9999");
});

test("oltre 9999 il numero resta intero, fino a 99999", () => {
  assert.equal(formatUseCaseCode("TJ", 10000), "TJ-10000");
  assert.equal(formatUseCaseCode("TJ", 12345), "TJ-12345");
  assert.equal(formatUseCaseCode("TJ", USE_CASE_CODE_MAX_SEQ), "TJ-99999");
  assert.throws(() => formatUseCaseCode("TJ", USE_CASE_CODE_MAX_SEQ + 1));
});

test("ogni codice rispetta il pattern del contratto", () => {
  for (const seq of [1, 9, 99, 999, 9999, 10000, 54321, 99999]) {
    for (const prefix of ["TJ", "ABC", "WXYZ"]) {
      assert.match(formatUseCaseCode(prefix, seq), USE_CASE_CODE_PATTERN);
    }
  }
  assert.equal(USE_CASE_CODE_PATTERN.source, "^[A-Z]{2,4}-[0-9]{4,5}$");
});

test("prefissi e numeri non validi sono rifiutati", () => {
  for (const prefix of ["T", "tj", "ABCDE", "T1", ""]) assert.throws(() => formatUseCaseCode(prefix, 1), prefix);
  for (const seq of [0, -1, 1.5, Number.NaN]) assert.throws(() => formatUseCaseCode("TJ", seq));
});

test("SQL: un solo statement con CTE, contatore e codice insieme, nessun lpad oltre 9999", () => {
  const sql = ASSIGN_USE_CASE_CODE_SQL;
  assert.equal(sql.split(";").length, 1, "un solo statement");
  assert.match(sql, /^WITH next_code AS \(\s*UPDATE workspace_connector_configs/);
  assert.match(sql, /SET next_code_seq = c\.next_code_seq \+ 1/);
  assert.match(sql, /c\.next_code_seq < 99999/);
  assert.match(sql, /WHEN n\.next_code_seq < 10000 THEN lpad\(n\.next_code_seq::text, 4, '0'\)\s+ELSE n\.next_code_seq::text/);
  // Il contatore non avanza se la segnalazione ha già un codice o è di un altro workspace.
  assert.match(sql, /EXISTS \(\s*SELECT 1 FROM use_cases u\s+WHERE u\.id = \$2::uuid AND u\.workspace_id = \$1::uuid AND u\.code IS NULL/);
  assert.match(sql, /WHERE u\.id = \$2::uuid AND u\.workspace_id = \$1::uuid AND u\.code IS NULL\s+RETURNING u\.code$/);
});
