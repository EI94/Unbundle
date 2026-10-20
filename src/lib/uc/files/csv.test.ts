import test from "node:test";
import assert from "node:assert/strict";
import { CSV_LIMITS, detectDelimiter, parseDelimited, type CsvTable } from "./csv.ts";

function parse(text: string, options: Parameters<typeof parseDelimited>[1] = {}): CsvTable {
  const result = parseDelimited(text, options);
  assert.ok(result.ok, result.ok ? "" : result.code);
  return result.value;
}

test("the delimiter is recognised from the shape of the first lines", () => {
  assert.equal(detectDelimiter("a;b;c\n1;2;3\n"), ";");
  assert.equal(detectDelimiter("a,b,c\n1,2,3\n"), ",");
  assert.equal(detectDelimiter("a\tb\tc\n1\t2\t3\n"), "\t");
  assert.equal(detectDelimiter("a|b|c\n1|2|3\n"), "|");
  // Italian decimals with commas do not fool the detection.
  assert.equal(detectDelimiter("tratta;costo;margine\nA;1,5;2,75\nB;3,25;4,5\n"), ";");
  // Commas inside quotes do not count.
  assert.equal(detectDelimiter('nota;valore\n"a, b, c";1\n"d, e";2\n'), ";");
  assert.equal(detectDelimiter("sep=,\na;b,c\n"), ",");
  assert.equal(detectDelimiter("una sola colonna\nriga\n"), ";");
});

test("quoted fields keep delimiters, quotes and line breaks", () => {
  const table = parse('nome campo;nota\n"a;b";"riga 1\r\nriga 2"\n"virgolette ""doppie""";fine\n');
  assert.deepEqual(table.rows, [
    ["nome campo", "nota"],
    ["a;b", "riga 1\nriga 2"],
    ['virgolette "doppie"', "fine"],
  ]);
  assert.deepEqual(table.warnings, []);
});

test("BOM, CRLF, CR, blank lines and a missing final newline", () => {
  const table = parse("﻿a,b\r\n1,2\r\r\n\n3,4\r5,6");
  assert.equal(table.delimiter, ",");
  assert.deepEqual(table.rows, [
    ["a", "b"],
    ["1", "2"],
    ["3", "4"],
    ["5", "6"],
  ]);
});

test("empty trailing fields and stray quotes stay as text", () => {
  assert.deepEqual(parse("a;b;\n1;;\n").rows, [
    ["a", "b", ""],
    ["1", "", ""],
  ]);
  assert.deepEqual(parse('a;b\n12" pollici;x"y\n').rows, [
    ["a", "b"],
    ['12" pollici', 'x"y'],
  ]);
  assert.deepEqual(parse('a;b\n"";""').rows, [
    ["a", "b"],
    ["", ""],
  ]);
});

test("the sep= hint of Excel is honoured and removed", () => {
  const table = parse("sep=|\na|b\n1|2\n");
  assert.equal(table.delimiter, "|");
  assert.deepEqual(table.rows, [
    ["a", "b"],
    ["1", "2"],
  ]);
});

test("TSV files always use tabs", () => {
  const table = parse("a;b\tc\n1;2\t3\n", { kind: "tsv" });
  assert.deepEqual(table.rows, [
    ["a;b", "c"],
    ["1;2", "3"],
  ]);
});

test("formulas are not evaluated: cells stay text", () => {
  assert.deepEqual(parse("a;b\n=1+1;@SUM(A1)\n").rows[1], ["=1+1", "@SUM(A1)"]);
});

test("an unterminated quote is a warning, not a failure", () => {
  const table = parse('a;b\n1;"aperta\n2;3\n');
  assert.deepEqual(table.warnings, ["virgolette_non_chiuse"]);
  assert.deepEqual(table.rows[0], ["a", "b"]);
  assert.equal(table.rows.length, 2);
});

test("limits stop the reading and say so", () => {
  const text = Array.from({ length: 100 }, (_, i) => `${i};${i}`).join("\n");
  const rows = parse(text, { maxRows: 10 });
  assert.equal(rows.rows.length, 10);
  assert.equal(rows.truncated, true);
  const cells = parse(text, { maxCells: 21 });
  assert.equal(cells.rows.length, 10);
  assert.equal(cells.truncated, true);
  assert.equal(parse(text).truncated, false);
  const wide = `${";".repeat(CSV_LIMITS.maxColumns + 1)}\n`;
  const result = parseDelimited(wide);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "csv_troppe_colonne");
  const longField = `a\n${"x".repeat(CSV_LIMITS.maxFieldChars + 10)}\n`;
  const clipped = parse(longField);
  assert.equal(clipped.rows[1][0].length, CSV_LIMITS.maxFieldChars);
  assert.deepEqual(clipped.warnings, ["campo_troppo_lungo"]);
});
