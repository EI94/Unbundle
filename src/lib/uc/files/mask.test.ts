import test from "node:test";
import assert from "node:assert/strict";
import { MASK, PREVIEW_LIMITS, PREVIEW_SCHEMA, maskedPreview } from "./mask.ts";

// Invented values only. The fiscal code is synthetic with a valid check character.
const FAKE_CF = "RSSMRA80A01H501U";

test("personal columns are masked by header, the rest is shown", () => {
  const preview = maskedPreview({
    name: "Turni",
    rows: [
      ["codice_equipaggio", "Cognome", "nome_aeroporto", "base", "visita medica"],
      ["C-001", "Inventato", "Aeroporto Uno", "AAA", "2026-01-01"],
      ["C-002", "Fittizio", "Aeroporto Due", "BBB", ""],
    ],
  });
  assert.equal(preview.schema, PREVIEW_SCHEMA);
  assert.equal(preview.sheet, "Turni");
  assert.deepEqual(preview.columns, ["codice_equipaggio", "Cognome", "nome_aeroporto", "base", "visita medica"]);
  assert.deepEqual(preview.rows, [
    ["C-001", MASK, "Aeroporto Uno", "AAA", MASK],
    ["C-002", MASK, "Aeroporto Due", "BBB", ""],
  ]);
  assert.deepEqual(preview.masked_columns, [1, 4]);
  assert.equal(preview.total_rows, 2);
  assert.equal(preview.total_columns, 5);
  assert.equal(preview.truncated, false);
  assert.equal(JSON.stringify(preview).includes("Inventato"), false);
});

test("values that look personal are masked in any column, header included", () => {
  const preview = maskedPreview({
    rows: [
      ["codice", "riferimento", "x@esempio.it"],
      ["A", "scrivere a y@esempio.it", "1"],
      ["B", FAKE_CF, "2"],
      ["C", "+39 06 1234 5678", "3"],
      ["D", "testo normale", "4"],
    ],
  });
  assert.deepEqual(preview.columns, ["codice", "riferimento", MASK]);
  assert.deepEqual(
    preview.rows.map((r) => r[1]),
    [MASK, MASK, MASK, "testo normale"],
  );
  assert.equal(preview.masked_cells, 4);
  assert.deepEqual(preview.masked_columns, []);
  const json = JSON.stringify(preview);
  for (const secret of ["esempio.it", FAKE_CF, "1234"]) assert.equal(json.includes(secret), false, secret);
});

test("only the first 20 data rows and 50 columns, with long cells clipped", () => {
  const header = Array.from({ length: 60 }, (_, c) => `colonna_${c}`);
  const rows = [header, ...Array.from({ length: 30 }, (_, r) => header.map((_, c) => (c === 0 ? "x".repeat(500) : `${r}-${c}`)))];
  const preview = maskedPreview({ rows });
  assert.equal(preview.rows.length, PREVIEW_LIMITS.rows);
  assert.equal(preview.columns.length, PREVIEW_LIMITS.columns);
  assert.equal(preview.rows[0].length, PREVIEW_LIMITS.columns);
  assert.equal(preview.total_rows, 30);
  assert.equal(preview.total_columns, 60);
  assert.equal(preview.truncated, true);
  assert.equal(Array.from(preview.rows[0][0]).length, PREVIEW_LIMITS.cellChars);
  assert.ok(preview.rows[0][0].endsWith("…"));
});

test("blank rows are skipped, the first non-empty row is the header", () => {
  const preview = maskedPreview({ rows: [[], ["", " "], ["a", "b"], ["1"], [" ", ""], ["2", "3"]], truncated: true });
  assert.deepEqual(preview.columns, ["a", "b"]);
  assert.deepEqual(preview.rows, [
    ["1", ""],
    ["2", "3"],
  ]);
  assert.equal(preview.truncated, true);
  const empty = maskedPreview({ rows: [] });
  assert.deepEqual(empty.columns, []);
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.total_rows, 0);
});

test("forbidden columns from the item are masked too", () => {
  const preview = maskedPreview({ rows: [["codice", "nota interna"], ["A", "testo"]] }, { forbiddenColumns: ["nota*"] });
  assert.deepEqual(preview.rows, [["A", MASK]]);
  assert.deepEqual(preview.masked_columns, [1]);
});
