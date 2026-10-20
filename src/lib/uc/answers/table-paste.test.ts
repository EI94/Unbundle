import test from "node:test";
import assert from "node:assert/strict";
import {
  TABLE_LIMITS,
  buildTable,
  detectSeparator,
  inferColumnType,
  isFormulaLike,
  normalizeNewlines,
  normalizeTabella,
  parseCell,
  parsePastedTable,
  splitRecords,
} from "./table-paste.ts";

const codes = (list: { code: string }[]) => list.map((i) => i.code);

function table(text: string, opts = {}) {
  const r = parsePastedTable(text, opts);
  assert.ok(r.table, `tabella non letta: ${codes(r.errors).join(", ")}`);
  return { ...r, table: r.table };
}

test("BOM and CRLF/CR become LF", () => {
  assert.equal(normalizeNewlines("﻿a\r\nb\rc"), "a\nb\nc");
});

test("splitRecords handles Excel quotes, inner tabs, newlines and doubled quotes", () => {
  const { records, unterminated } = splitRecords('a\t"b\tc"\n"riga\nnuova"\t"con ""virgolette"""\n', "\t");
  assert.equal(unterminated, false);
  assert.deepEqual(records, [
    ["a", "b\tc"],
    ["riga\nnuova", 'con "virgolette"'],
  ]);
  // Una virgoletta in mezzo alla cella è un carattere normale.
  assert.deepEqual(splitRecords('5" pollici\tx', "\t").records, [['5" pollici', "x"]]);
  assert.equal(splitRecords('"aperta\tx', "\t").unterminated, true);
});

test("separator: TAB first, then ; or , only if consistent; Italian decimal commas are not separators", () => {
  assert.equal(detectSeparator("a\tb\n1\t2"), "\t");
  assert.equal(detectSeparator("a;b\n1;2"), ";");
  assert.equal(detectSeparator("a,b\nx,y"), ",");
  assert.equal(detectSeparator("a;b\n1;2;3"), null);
  assert.equal(detectSeparator("1,5\n2,5"), null);
  assert.equal(detectSeparator("solo testo"), null);
  assert.equal(detectSeparator('"a;b"\n"c;d"'), null);
});

test("a typical Excel paste: header, Italian numbers, percentages", () => {
  const r = table("﻿Canale\tQuota\tRichieste\r\nWhatsApp\t30%\t1.200\r\nEmail\t20,5%\t850\r\n");
  assert.equal(r.table.separator, "\t");
  assert.equal(r.table.headerDetected, true);
  assert.deepEqual(r.table.columns, [
    { key: "canale", label: "Canale", type: "testo" },
    { key: "quota", label: "Quota", type: "percentuale" },
    { key: "richieste", label: "Richieste", type: "numero" },
  ]);
  assert.deepEqual(r.table.typedRows, [
    { canale: "WhatsApp", quota: 0.3, richieste: 1200 },
    { canale: "Email", quota: 0.205, richieste: 850 },
  ]);
  assert.deepEqual(r.errors, []);
});

test("cells with newlines inside quotes stay in one row", () => {
  const r = table('Voce\tNote\nA\t"riga uno\nriga due"\nB\tsemplice\n');
  assert.deepEqual(r.table.rows, [
    ["A", "riga uno\nriga due"],
    ["B", "semplice"],
  ]);
});

test("short rows are padded with a warning; long rows are an error", () => {
  const short = table("A\tB\tC\nx\ty\nz\n");
  assert.deepEqual(short.table.rows, [
    ["x", "y", ""],
    ["z", "", ""],
  ]);
  assert.ok(codes(short.warnings).includes("righe_completate"));
  const long = parsePastedTable("A\tB\n1\t2\t3\n");
  assert.deepEqual(codes(long.errors), ["riga_troppo_lunga"]);
  assert.equal(long.table?.typedRows, null);
});

test("trailing empty rows and columns are removed; blank rows inside are skipped", () => {
  const r = table("A\tB\t\t\n1\t2\t\t\n\n\t\t\n3\t4\t\t\n\n\n");
  assert.equal(r.table.columns.length, 2);
  assert.deepEqual(r.table.rows, [
    ["1", "2"],
    ["3", "4"],
  ]);
  assert.ok(codes(r.warnings).includes("righe_vuote_saltate"));
});

test("duplicate or missing keys are errors (first column or keyColumn)", () => {
  assert.deepEqual(codes(parsePastedTable("Aereo\tCosto\nAAA\t1\naaa\t2\n").errors), ["chiave_doppia"]);
  assert.deepEqual(codes(parsePastedTable("Aereo\tCosto\n\t1\n").errors), ["chiave_mancante"]);
  const byKey = parsePastedTable("Note\tCodice\nx\tA1\nx\tA2\n", { keyColumn: "codice" });
  assert.deepEqual(byKey.errors, []);
  assert.deepEqual(codes(parsePastedTable("A\tB\n1\t2\n", { keyColumn: "Z" }).errors), ["colonna_chiave_mancante"]);
});

test("formula-like cells are saved as text and flagged; signed numbers stay numbers", () => {
  const r = table("Voce\tValore\tNota\nA\t-5\t=SUM(B1:B3)\nB\t+3,5\t@cmd\nC\t2\t-giusto\n");
  assert.equal(r.table.columns[1].type, "numero");
  assert.deepEqual(
    r.table.typedRows?.map((row) => row.valore),
    [-5, 3.5, 2],
  );
  assert.deepEqual(
    r.table.typedRows?.map((row) => row.nota),
    ["=SUM(B1:B3)", "@cmd", "-giusto"],
  );
  assert.deepEqual(
    r.warnings.filter((w) => w.code === "formula_in_cella").map((w) => w.field),
    ["rows[0][2]", "rows[1][2]", "rows[2][2]"],
  );
  assert.ok(isFormulaLike("=1+1", true));
  assert.ok(isFormulaLike("@x", false));
  assert.ok(!isFormulaLike("-5", true));
  assert.ok(isFormulaLike("-5", false));
  assert.ok(!isFormulaLike("5", false));
});

test("fewer rows than min_rows give a partial answer", () => {
  const r = table("A\tB\nx\t1\n", { minRows: 3 });
  assert.equal(r.table.partial, true);
  assert.ok(codes(r.warnings).includes("righe_insufficienti"));
  assert.equal(table("A\tB\nx\t1\ny\t2\nz\t3\n", { minRows: 3 }).table.partial, false);
});

test("header detection: a first row of values is data, year headers are titles", () => {
  const noHeader = table("AAA\t1.200\t3,5\nBBB\t900\t2\n");
  assert.equal(noHeader.table.headerDetected, false);
  assert.deepEqual(
    noHeader.table.columns.map((c) => c.label),
    ["Colonna 1", "Colonna 2", "Colonna 3"],
  );
  assert.ok(codes(noHeader.warnings).includes("intestazione_assente"));
  const years = table("Aereo\t2023\t2024\nAAA\t10\t12\n");
  assert.equal(years.table.headerDetected, true);
  assert.deepEqual(
    years.table.columns.map((c) => c.key),
    ["aereo", "2023", "2024"],
  );
  const single = table("1,5\n2,5\n");
  assert.deepEqual(single.table.typedRows, [{ colonna_1: 1.5 }, { colonna_1: 2.5 }]);
});

test("duplicate or empty header titles get unique keys", () => {
  const r = table("Costo\tCosto\t\nA\t1\t2\n");
  assert.deepEqual(
    r.table.columns.map((c) => [c.key, c.label]),
    [
      ["costo", "Costo"],
      ["costo_2", "Costo"],
      ["colonna_3", "Colonna 3"],
    ],
  );
  assert.ok(codes(r.warnings).includes("intestazione_doppia"));
  // Dati sotto un titolo vuoto in fondo: la riga è più lunga dei titoli.
  assert.deepEqual(codes(r.errors), ["riga_troppo_lunga"]);
  assert.deepEqual(table("Costo\t\tNote\nA\t1\tx\n").errors, []);
});

test("columns from the template: matched by key or label, typed by the template", () => {
  const columns = [
    { key: "aeroporto", label: "Aeroporto", type: "codice" as const },
    { key: "costo", label: "Costo handling", type: "valuta" as const },
    { key: "attesa", label: "Attesa", type: "durata" as const, unit: "minuti" },
  ];
  const r = table("aeroporto\tCOSTO HANDLING\tattesa\tnote\nabcd\t€ 1.200\t45\tx\nwxyz\t900\t1 ora\ty\n", { columns });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.table.typedRows, [
    { aeroporto: "ABCD", costo: { amount: 1200, currency: "EUR" }, attesa: 45 },
    { aeroporto: "WXYZ", costo: { amount: 900, currency: "EUR" }, attesa: 60 },
  ]);
  assert.ok(codes(r.warnings).includes("colonna_ignorata"));
  // Senza intestazione, solo se le colonne sono esattamente quelle del template.
  const noHeader = table("ABCD\t€ 1.200\t45\n", { columns });
  assert.equal(noHeader.table.headerDetected, false);
  assert.deepEqual(codes(parsePastedTable("ABCD\t1\n", { columns }).errors), ["intestazione_non_riconosciuta"]);
  assert.deepEqual(codes(parsePastedTable("aeroporto\tattesa\nABCD\t4\n", { columns }).errors), ["colonna_mancante"]);
  assert.deepEqual(codes(parsePastedTable("aeroporto\tAeroporto\tcosto\tattesa\nA\tB\t1\t2\n", { columns }).errors), ["colonna_doppia"]);
});

test("cells that do not match the column type are errors with their position", () => {
  const columns = [
    { key: "voce", type: "testo" as const },
    { key: "valore", type: "numero" as const },
    { key: "quota", type: "percentuale" as const },
    { key: "dal", type: "data" as const },
  ];
  const r = parsePastedTable("voce\tvalore\tquota\tdal\nA\t1.2.3\t120%\t31/02/2026\nB\t\t\t\n", { columns });
  assert.deepEqual(
    r.errors.map((e) => [e.code, e.field]),
    [
      ["numero_non_valido", "rows[0][1]"],
      ["percentuale_fuori_intervallo", "rows[0][2]"],
      ["data_inesistente", "rows[0][3]"],
    ],
  );
  assert.equal(r.table?.typedRows, null);
});

test("parseCell per type", () => {
  assert.deepEqual(parseCell("si_no", "sì", "f"), { ok: true, value: true, warnings: [] });
  assert.deepEqual(parseCell("ora", "23.30", "f"), { ok: true, value: "23:30", warnings: [] });
  assert.deepEqual(parseCell("codice", "abcd ", "f"), { ok: true, value: "ABCD ", warnings: [] });
  assert.deepEqual(parseCell("valuta", "CHF 300", "f"), { ok: true, value: { amount: 300, currency: "CHF" }, warnings: [] });
  assert.deepEqual(parseCell("durata", "2:30", "f"), { ok: true, value: 150, warnings: [] });
  assert.equal(parseCell("durata", "3", "f").ok, false);
  assert.deepEqual(parseCell("durata", "3", "f", "ore"), { ok: true, value: 180, warnings: [] });
  // «2.30» in a duration column is 2 hours 30 minutes, with a warning; Excel «02:30:00» too, without.
  const dotted = parseCell("durata", "2.30", "f");
  assert.ok(dotted.ok && dotted.value === 150);
  assert.deepEqual(dotted.ok && dotted.warnings.map((w) => w.code), ["letto_come_ore_minuti"]);
  assert.deepEqual(parseCell("durata", "02:30:00", "f"), { ok: true, value: 150, warnings: [] });
  assert.deepEqual(parseCell("numero", "", "f"), { ok: true, value: null, warnings: [] });
  const ambiguous = parseCell("numero", "1,200", "rows[0][1]");
  assert.ok(ambiguous.ok && ambiguous.warnings[0].code === "virgola_ambigua" && ambiguous.warnings[0].field === "rows[0][1]");
});

test("column type inference", () => {
  assert.equal(inferColumnType(["1.200", "-3,5", ""]), "numero");
  assert.equal(inferColumnType(["30%", "12,5 %"]), "percentuale");
  assert.equal(inferColumnType(["€ 1.200", "CHF 300"]), "valuta");
  assert.equal(inferColumnType(["01/10/2025", "2025-10-02"]), "data");
  assert.equal(inferColumnType(["23:30", "06:00"]), "ora");
  assert.equal(inferColumnType(["sì", "no"]), "si_no");
  assert.equal(inferColumnType(["1", "=1+1"]), "testo");
  assert.equal(inferColumnType(["", ""]), "testo");
  assert.equal(inferColumnType(["1", "due"]), "testo");
});

test("limits: empty, header only, bytes, rows and columns", () => {
  assert.deepEqual(codes(parsePastedTable("").errors), ["tabella_vuota"]);
  assert.deepEqual(codes(parsePastedTable(" \n\t\n").errors), ["tabella_vuota"]);
  assert.deepEqual(codes(parsePastedTable("Solo\tTitoli\n").errors), ["nessuna_riga"]);
  assert.deepEqual(codes(parsePastedTable("x".repeat(TABLE_LIMITS.maxBytes + 1)).errors), ["tabella_troppo_grande"]);
  const many = "k\n" + Array.from({ length: 11 }, (_, i) => `r${i}`).join("\n");
  assert.deepEqual(codes(parsePastedTable(many, { maxRows: 10 }).errors), ["troppe_righe"]);
  const wide = Array.from({ length: 6 }, (_, i) => `c${i}`).join("\t") + "\n" + Array.from({ length: 6 }, () => "1").join("\t");
  assert.deepEqual(codes(parsePastedTable(wide, { maxCols: 5 }).errors), ["troppe_colonne"]);
  assert.deepEqual(codes(parsePastedTable(`A\tB\nx\t${"y".repeat(TABLE_LIMITS.maxCellLength + 1)}\n`).errors), ["cella_troppo_lunga"]);
});

test("an unterminated quote is read as plain text with a warning", () => {
  const r = table('A\tB\n"aperta\tx\n');
  assert.deepEqual(r.table.rows, [['"aperta', "x"]]);
  assert.ok(codes(r.warnings).includes("virgolette_aperte"));
});

test("semicolon CSV with quotes, as exported by Italian Excel", () => {
  const r = table('Voce;Importo\n"Handling; notte";"1.200,50"\nTasse;300\n');
  assert.equal(r.table.separator, ";");
  assert.deepEqual(r.table.typedRows, [
    { voce: "Handling; notte", importo: 1200.5 },
    { voce: "Tasse", importo: 300 },
  ]);
});

test("normalizeTabella: pasted text, {text} and the grid of the page", () => {
  const pasted = normalizeTabella("A\tB\nx\t1\n", {});
  assert.deepEqual(pasted.value, {
    columns: [
      { key: "a", label: "A", type: "testo" },
      { key: "b", label: "B", type: "numero" },
    ],
    rows: [["x", "1"]],
  });
  assert.deepEqual(pasted.normalized, { rows: [{ a: "x", b: 1 }] });
  assert.deepEqual(normalizeTabella({ text: "A\tB\nx\t1\n" }, {}).normalized, { rows: [{ a: "x", b: 1 }] });
  const grid = normalizeTabella({ columns: [{ key: "aereo", label: "Aereo" }, { key: "posti", label: "Posti" }], rows: [["AAA", "8"], ["BBB", 6]] }, {});
  assert.deepEqual(grid.normalized, { rows: [{ aereo: "AAA", posti: 8 }, { aereo: "BBB", posti: 6 }] });
  // La griglia ha sempre i titoli: anche se sembrano valori, sono titoli.
  const numericTitles = normalizeTabella({ columns: [{ key: "1", label: "1" }], rows: [["x"]] }, {});
  assert.deepEqual(numericTitles.normalized, { rows: [{ "1": "x" }] });
  assert.equal(normalizeTabella({ rows: "x" }, {}).errors[0].code, "tabella_vuota");
  assert.equal(normalizeTabella(42, {}).errors[0].code, "tabella_vuota");
  const partial = normalizeTabella("A\tB\nx\t1\n", { min_rows: 2 });
  assert.equal(partial.partial, true);
  const dup = normalizeTabella("A\tB\nx\t1\nx\t2\n", {});
  assert.equal(dup.normalized, null);
  assert.ok(dup.value !== null);
});

test("buildTable accepts pre-split records", () => {
  const r = buildTable([["Voce", "Valore"], ["a", "1"]]);
  assert.deepEqual(r.table?.typedRows, [{ voce: "a", valore: 1 }]);
});

test("issue messages never repeat what the user pasted (they can be logged)", () => {
  const secret = "Ingrediente Segreto";
  const columns = [{ key: "aeroporto", label: "Aeroporto", type: "codice" as const }];
  const ignored = parsePastedTable(`aeroporto\t${secret}\nABCD\tx\n`, { columns });
  assert.ok(codes(ignored.warnings).includes("colonna_ignorata"));
  const duplicate = parsePastedTable(`${secret}\tCosto\nAAA\t1\naaa\t2\n`);
  assert.deepEqual(codes(duplicate.errors), ["chiave_doppia"]);
  const missingKey = parsePastedTable(`${secret}\tCosto\n\t1\n`);
  assert.ok(codes(missingKey.errors).includes("chiave_mancante"));
  for (const r of [ignored, duplicate, missingKey]) {
    const text = JSON.stringify([...r.errors, ...r.warnings].map((i) => i.message));
    assert.equal(text.includes("Segreto"), false, text);
  }
});
