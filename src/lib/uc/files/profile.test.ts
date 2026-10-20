import test from "node:test";
import assert from "node:assert/strict";
import { buildDocx, buildXlsx } from "./fixtures.ts";
import { normalizeColumnName, profileDataset, profileJson, proposeColumnMapping, readTabularFile } from "./profile.ts";

// Invented content only: no client values.
const csv = (text: string) => Buffer.from(text, "utf8");

test("reads CSV and the first non-empty XLSX sheet; documents are not tables", () => {
  const c = readTabularFile(csv("codice;minuti\nA;1\n\nB;2\n"), "tratte.csv");
  assert.ok(c.ok);
  assert.equal(c.value.kind, "csv");
  assert.deepEqual(c.value.rows, [["codice", "minuti"], ["A", "1"], ["B", "2"]]);
  const x = readTabularFile(
    buildXlsx([
      { name: "Vuoto", rows: [] },
      { name: "Dati", rows: [["codice", "minuti"], ["A", 1]] },
    ]),
    "tratte.xlsx",
  );
  assert.ok(x.ok);
  assert.equal(x.value.sheet, "Dati");
  assert.equal(x.value.rows.length, 2);
  const doc = readTabularFile(buildDocx(["Solo testo"]), "nota.docx");
  assert.equal(doc.ok ? null : doc.code, "non_tabellare");
});

test("profile: rows, column types, empty columns, mixed time zones; never values", () => {
  const rows = [
    ["codice_tratta", "minuti", "partenza", "giorno", "vuota", "note"],
    ["AAA-BBB", "95", "2026-03-01T10:00:00Z", "01/03/2026", "", "ok"],
    ["CCC-DDD", "1.200", "2026-03-02 11:30", "02/03/2026", "", ""],
    ["EEE-FFF", "12,5", "2026-03-03T08:15:00+01:00", "03/03/2026", "", "da rivedere"],
  ];
  const p = profileDataset({ rows, truncated: false });
  assert.ok(p.ok);
  assert.equal(p.value.rowCount, 3);
  assert.deepEqual(
    p.value.columns.map((c) => [c.name, c.type, c.empty_pct]),
    [
      ["codice_tratta", "testo", 0],
      ["minuti", "numero", 0],
      ["partenza", "data_ora", 0],
      ["giorno", "data", 0],
      ["vuota", "vuota", 100],
      ["note", "testo", 33],
    ],
  );
  assert.equal(p.value.quality.fusi_orari_misti, true);
  assert.deepEqual(p.value.quality.avvisi, ["dq.fusi_orari", "dq.colonne_vuote"]);
  assert.deepEqual(p.value.quality.colonne_vuote, ["vuota"]);
  assert.equal(p.value.personalData, "no");
  const json = JSON.stringify(profileJson(p.value));
  for (const value of ["AAA-BBB", "da rivedere", "1.200"]) assert.equal(json.includes(value), false, `no value ${value}`);
});

test("profile: personal columns from headers, pseudonymized flag, empty table refused", () => {
  const rows = [
    ["codice", "cognome", "email"],
    ["P1", "Cognome Uno", "persona@esempio.test"],
  ];
  const p = profileDataset({ rows, truncated: false });
  assert.ok(p.ok);
  assert.deepEqual(p.value.personalColumns, ["cognome", "email"]);
  assert.equal(p.value.personalData, "identificativi");
  const pseudo = profileDataset({ rows, truncated: false }, { pseudonymized: true });
  assert.ok(pseudo.ok && pseudo.value.personalData === "pseudonimizzati");
  const empty = profileDataset({ rows: [["solo", "intestazione"]], truncated: false });
  assert.equal(empty.ok ? null : empty.code, "tabella_vuota");
});

test("duplicate or missing headers get stable names; truncated reads are flagged", () => {
  const p = profileDataset({ rows: [["a", "a", ""], ["1", "2", "3"]], truncated: true });
  assert.ok(p.ok);
  assert.deepEqual(
    p.value.columns.map((c) => c.name),
    ["a", "a (2)", "Colonna 3"],
  );
  assert.ok(p.value.quality.avvisi.includes("tabella_troncata"));
  assert.equal(p.value.schema.truncated, true);
});

test("column mapping by name onto linked fields: key tail, full key or title, each field once", () => {
  assert.equal(normalizeColumnName("Data di Apertura "), "data_di_apertura");
  const mapping = proposeColumnMapping(
    ["Canale", "data_apertura", "Priorità", "canale"],
    [
      { key: "richiesta.canale", title: "Canale della richiesta" },
      { key: "richiesta.data_apertura", title: "Data di apertura" },
      { key: "richiesta.priorita", title: null },
    ],
  );
  assert.deepEqual(mapping, { Canale: "richiesta.canale", data_apertura: "richiesta.data_apertura", "Priorità": "richiesta.priorita" });
});
