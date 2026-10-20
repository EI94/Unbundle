import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { EMPTY_GRID_ROWS, tableTemplateFileName, tableTemplateRows, tableTemplateWorkbook } from "./table-template.ts";

// Invented content only: no client values.

test("with the template columns the first row is the header to paste back", () => {
  const t = tableTemplateRows({ title: "Ripartizione per canale", config: { columns: [{ key: "canale", label: "Canale" }, { key: "su_100" }] } });
  assert.equal(t.hasColumns, true);
  assert.deepEqual(t.rows, [["Canale", "su_100"]]);
});

test("without columns: the question title and an empty grid", () => {
  const t = tableTemplateRows({ title: "  Elenco delle   tratte  ", config: {} });
  assert.equal(t.hasColumns, false);
  assert.deepEqual(t.rows[0], ["Elenco delle tratte"]);
  assert.equal(t.rows.length, 1 + EMPTY_GRID_ROWS);
});

test("texts are guarded against formulas", () => {
  const t = tableTemplateRows({ title: "=HYPERLINK(\"x\")", config: { columns: [{ key: "a", label: "+cmd" }] } });
  assert.deepEqual(t.rows, [["'+cmd"]]);
  assert.deepEqual(tableTemplateRows({ title: "@SUM(1)", config: {} }).rows[0], ["'@SUM(1)"]);
});

test("the workbook opens in Excel format with one «Modello» sheet; safe file name", () => {
  const buf = tableTemplateWorkbook({ title: "Domanda", config: { columns: [{ key: "a", label: "Colonna A" }, { key: "b", label: "Colonna B" }] } });
  const book = XLSX.read(buf, { type: "buffer" });
  assert.deepEqual(book.SheetNames, ["Modello"]);
  assert.deepEqual(XLSX.utils.sheet_to_json(book.Sheets.Modello, { header: 1 }), [["Colonna A", "Colonna B"]]);
  assert.equal(tableTemplateFileName("q.servizio.01"), "modello-q.servizio.01.xlsx");
  assert.equal(tableTemplateFileName('../x"; y'), "modello-.._x_y.xlsx");
});
