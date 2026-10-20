import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, parseTestCases, type TestCaseScanner } from "./test-cases.ts";

/** Scanner finto: blocca «visita medica», avvisa su «Mario». La scansione vera è `text/scan.ts`. */
const scan: TestCaseScanner = (text) => ({
  blocking: /visita medica/i.test(text) ? [{ category: "sanitario", term: "visita medica" }] : [],
  warnings: /\bMario\b/.test(text) ? [{ category: "nome_persona", term: "Mario" }] : [],
});

const KNOWN = new Set(["rule.esempio.priorita", "hc.esempio.limite"]);

test("JSON rows are read with defaults and normalized keys", () => {
  const r = parseTestCases(
    JSON.stringify([
      { key: "Caso.Sintetico.01", input: { richiesta: "Due persone, sabato" }, expected: { atteso: "Strategia A", regole: ["rule.esempio.priorita"] }, covers: ["dato mancante"], serve_per: ["backtest", "backtest"] },
      { key: "caso.sintetico.02", kind: "sintetico", input: "Richiesta in testo", atteso: "Strategia B", regole: "hc.esempio.limite" },
    ]),
    { a8Resolved: false, scan, knownItemKeys: KNOWN },
  );
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.errors));
  assert.deepEqual(r.value[0], {
    key: "caso.sintetico.01",
    kind: "sintetico",
    input: { richiesta: "Due persone, sabato" },
    expected: { atteso: "Strategia A", regole: ["rule.esempio.priorita"] },
    covers: ["dato mancante"],
    serve_per: ["backtest"],
  });
  assert.deepEqual(r.value[1].expected, { atteso: "Strategia B", regole: ["hc.esempio.limite"] });
  assert.equal(r.value[1].input, "Richiesta in testo");
});

test("the wrapped JSON format checks its schema", () => {
  const ok = parseTestCases(JSON.stringify({ schema: "unbundle.uc-test-cases/1", cases: [{ key: "c1", input: { a: 1 }, atteso: "x" }] }), { a8Resolved: false, scan });
  assert.ok(ok.ok);
  const bad = parseTestCases(JSON.stringify({ schema: "altro/1", cases: [] }), { a8Resolved: false, scan });
  assert.equal(bad.ok, false);
});

test("CSV with Excel quotes, semicolons and list cells", () => {
  const csv = '﻿key;kind;input;atteso;regole;covers;serve_per\r\ncaso.01;sintetico;"{""tratta"": ""A-B""}";"Strategia A; poi B";rule.esempio.priorita|hc.esempio.limite;"dato mancante|un solo equipaggio";backtest, modello\r\ncaso.02;;"testo con\na capo";Strategia C;;;\r\n';
  const r = parseTestCases(csv, { a8Resolved: false, scan, knownItemKeys: KNOWN });
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.errors));
  assert.deepEqual(r.value[0].input, { tratta: "A-B" });
  assert.equal(r.value[0].expected.atteso, "Strategia A; poi B");
  assert.deepEqual(r.value[0].expected.regole, ["rule.esempio.priorita", "hc.esempio.limite"]);
  assert.deepEqual(r.value[0].covers, ["dato mancante", "un solo equipaggio"]);
  assert.deepEqual(r.value[0].serve_per, ["backtest", "modello"]);
  assert.deepEqual(r.value[1].input, { testo: "testo con\na capo" });
  assert.equal(r.value[1].kind, "sintetico");
});

test("parseCsv handles quotes, separators and unterminated quotes", () => {
  assert.deepEqual(parseCsv('a\tb\n"x\ty"\t"z""w"'), { rows: [["a", "b"], ["x\ty", 'z"w']], separator: "\t" });
  assert.ok("error" in parseCsv('a,b\n"aperto,b'));
});

test("pseudonymized cases need the A.8 sheet approved", () => {
  const rows = JSON.stringify([{ key: "p1", kind: "pseudonimizzato", input: { a: 1 }, atteso: "x" }]);
  const refused = parseTestCases(rows, { a8Resolved: false, scan });
  assert.equal(refused.ok, false);
  assert.equal(refused.ok ? "" : refused.errors[0].code, "a8_non_sciolto");
  assert.ok(parseTestCases(rows, { a8Resolved: true, scan }).ok);
});

test("every error is reported with row and field, never the text", () => {
  const r = parseTestCases(
    JSON.stringify([
      { key: "BAD KEY!", input: {}, atteso: "" },
      { key: "dup", input: { a: 1 }, atteso: "x", regole: ["non valida", "rule.esempio.assente"], serve_per: ["sempre"] },
      { key: "dup", kind: "reale", input: { a: 1 }, atteso: "x" },
      "riga",
    ]),
    { a8Resolved: false, scan, knownItemKeys: KNOWN },
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  const codes = r.errors.map((e) => `${e.row}:${e.code}`);
  for (const expected of ["1:chiave_non_valida", "1:atteso_mancante", "2:regola_non_valida", "2:regola_assente", "2:uso_non_valido", "3:chiave_doppia", "3:tipo_non_valido", "4:riga_non_valida"]) {
    assert.ok(codes.includes(expected), `${expected} in ${codes.join(", ")}`);
  }
  assert.ok(!r.errors.some((e) => e.message.includes("non valida»") || e.message.includes("sempre")));
  assert.match(r.message, /problemi/);
});

test("blocking scan findings stop the import and warnings pass through", () => {
  const blocked = parseTestCases(JSON.stringify([{ key: "c1", input: { note: ["ok", "dopo la visita medica"] }, atteso: "x" }]), { a8Resolved: true, scan });
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;
  assert.deepEqual(
    blocked.errors.map((e) => [e.field, e.code, e.category]),
    [["input.note[1]", "testo_non_ammesso", "sanitario"]],
  );
  assert.ok(!blocked.errors[0].message.includes("visita"));
  const keyBlocked = parseTestCases(JSON.stringify([{ key: "c1", input: { "esito della visita medica": "sì" }, atteso: "x" }]), { a8Resolved: true, scan });
  assert.equal(keyBlocked.ok, false);
  if (keyBlocked.ok) return;
  assert.deepEqual(keyBlocked.errors.map((e) => [e.field, e.category]), [["input.#1 (nome del campo)", "sanitario"]]);
  assert.ok(!JSON.stringify(keyBlocked.errors).includes("visita"));
  const warned = parseTestCases(JSON.stringify([{ key: "c1", input: { a: 1 }, atteso: "x", covers: ["chiede Mario"] }]), { a8Resolved: false, scan });
  assert.ok(warned.ok);
  assert.deepEqual(warned.warnings.map((w) => [w.field, w.category]), [["covers[0]", "nome_persona"]]);
});

test("limits on size, rows and empty files", () => {
  assert.equal(parseTestCases("[]", { a8Resolved: false, scan }).ok, false);
  assert.equal(parseTestCases("non json {", { a8Resolved: false, scan, format: "json" }).ok, false);
  const many = JSON.stringify(Array.from({ length: 3 }, (_, i) => ({ key: `c${i}`, input: { a: i }, atteso: "x" })));
  const r = parseTestCases(many, { a8Resolved: false, scan, maxRows: 2 });
  assert.equal(r.ok ? "" : r.errors[0].code, "troppi_casi");
  const big = parseTestCases(many, { a8Resolved: false, scan, maxBytes: 10 });
  assert.equal(big.ok ? "" : big.errors[0].code, "file_troppo_grande");
});
