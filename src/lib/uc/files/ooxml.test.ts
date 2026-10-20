import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { buildDocx, buildPptx, buildXlsx, buildZip } from "./fixtures.ts";
import {
  OOXML_LIMITS,
  ZIP_LIMITS,
  columnIndex,
  crc32,
  decodeXmlEntities,
  ooxmlKind,
  openZip,
  readOoxml,
  readZipEntry,
  zipEntry,
} from "./ooxml.ts";

function code(result: { ok: boolean; code?: string }): string | undefined {
  return result.ok ? undefined : result.code;
}

const SHEET = [
  ["codice_tratta", "aeromobile", "minuti"],
  ["AAA-BBB", "Tipo A", 95],
  ["CCC-DDD", "Tipo B", 140],
];

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test("column references become zero-based indexes", () => {
  assert.equal(columnIndex("A1"), 0);
  assert.equal(columnIndex("Z9"), 25);
  assert.equal(columnIndex("AA10"), 26);
  assert.equal(columnIndex("XFD1048576"), 16383);
  assert.equal(columnIndex("1A"), null);
});

test("XML entities are decoded without custom entities", () => {
  assert.equal(decodeXmlEntities("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;"), `a & b <c> "d" 'e'`);
  assert.equal(decodeXmlEntities("caff&#232; &#x1F600;"), "caffè 😀");
  assert.equal(decodeXmlEntities("&#xD800;"), "\ufffd");
  assert.equal(decodeXmlEntities("&custom;"), "&custom;");
});

test("a synthetic XLSX is read sheet by sheet with shared strings", () => {
  const bytes = buildXlsx([
    { name: "Voli", rows: SHEET },
    { name: "Note", rows: [["nota"], ["prova"]] },
  ]);
  const result = readOoxml(bytes, "xlsx");
  assert.ok(result.ok, code(result));
  const doc = result.value;
  assert.equal(doc.kind, "xlsx");
  assert.deepEqual(
    doc.tables.map((t) => t.name),
    ["Voli", "Note"],
  );
  assert.deepEqual(doc.tables[0].rows, [
    ["codice_tratta", "aeromobile", "minuti"],
    ["AAA-BBB", "Tipo A", "95"],
    ["CCC-DDD", "Tipo B", "140"],
  ]);
  assert.match(doc.text, /codice_tratta\taeromobile\tminuti/);
  assert.match(doc.text, /Note/);
  assert.equal(doc.embedded, 0);
});

test("inline strings, booleans and sparse cells keep their columns", () => {
  const bytes = buildXlsx([{ name: "S", rows: [[null, null, "terza"], ["a", true, 1.5]] }], { inlineStrings: true });
  const result = readOoxml(bytes, "xlsx");
  assert.ok(result.ok, code(result));
  assert.deepEqual(result.value.tables[0].rows, [
    ["", "", "terza"],
    ["a", "TRUE", "1.5"],
  ]);
});

test("worksheets the workbook does not list, comments and charts are still read", () => {
  const orphan = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>colonna_nascosta</t></is></c></row></sheetData></worksheet>`;
  const comments = `<?xml version="1.0"?><comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><commentList><comment ref="A1"><text><r><t>testo del commento</t></r></text></comment></commentList></comments>`;
  const chart = `<?xml version="1.0"?><c:chartSpace xmlns:c="c" xmlns:a="a"><c:chart><c:title><a:t>titolo del grafico</a:t></c:title></c:chart></c:chartSpace>`;
  const core = `<?xml version="1.0"?><cp:coreProperties xmlns:cp="cp" xmlns:dc="dc"><dc:creator>Autore Inventato</dc:creator></cp:coreProperties>`;
  const bytes = buildXlsx([{ name: "S", rows: SHEET }], {
    extraFiles: [
      { name: "xl/worksheets/sheet9.xml", data: orphan },
      { name: "xl/comments1.xml", data: comments },
      { name: "xl/charts/chart1.xml", data: chart },
      { name: "docProps/core.xml", data: core },
    ],
  });
  const result = readOoxml(bytes, "xlsx");
  assert.ok(result.ok, code(result));
  assert.equal(result.value.tables.length, 2);
  assert.deepEqual(result.value.tables[1].rows, [["colonna_nascosta"]]);
  assert.match(result.value.text, /testo del commento/);
  assert.match(result.value.text, /titolo del grafico/);
  // File metadata (author, title) is not user content and is not scanned.
  assert.doesNotMatch(result.value.text, /Autore Inventato/);
});

test("shared strings that no cell uses are still scanned", () => {
  const bytes = buildXlsx([{ name: "S", rows: [["visibile"]] }]);
  const archive = openZip(bytes);
  assert.ok(archive.ok);
  // Rebuild the workbook with an extra shared string that no cell references.
  const files = archive.value.entries.map((entry) => {
    const read = readZipEntry(archive.value, entry);
    assert.ok(read.ok);
    const data = entry.name === "xl/sharedStrings.xml" ? read.value.toString("utf8").replace("</sst>", "<si><t>stringa orfana</t></si></sst>") : read.value;
    return { name: entry.name, data };
  });
  const result = readOoxml(buildZip(files), "xlsx");
  assert.ok(result.ok, code(result));
  assert.deepEqual(result.value.tables[0].rows, [["visibile"]]);
  assert.match(result.value.text, /stringa orfana/);
});

test("a synthetic DOCX gives paragraphs, tables and deleted revisions", () => {
  const bytes = buildDocx(["Primo paragrafo", "Secondo & ultimo"], [[["colonna_a", "colonna_b"], ["1", "2"]]], { deletedText: "testo cancellato" });
  const result = readOoxml(bytes, "docx");
  assert.ok(result.ok, code(result));
  assert.equal(result.value.kind, "docx");
  assert.match(result.value.text, /Primo paragrafo\nSecondo & ultimo/);
  assert.match(result.value.text, /testo cancellato/);
  assert.deepEqual(result.value.tables, [{ name: "Tabella 1", rows: [["colonna_a", "colonna_b"], ["1", "2"]] }]);
});

test("a synthetic PPTX gives the slide text", () => {
  const bytes = buildPptx([["Titolo", "Punto uno"], ["Seconda diapositiva"]]);
  const result = readOoxml(bytes, "pptx");
  assert.ok(result.ok, code(result));
  assert.equal(result.value.kind, "pptx");
  assert.match(result.value.text, /Titolo\nPunto uno/);
  assert.match(result.value.text, /Seconda diapositiva/);
});

test("an embedded workbook (chart data) is read one level down", () => {
  const inner = buildXlsx([{ name: "Dati", rows: [["serie", "valore"], ["a", 1]] }]);
  const bytes = buildPptx([["Grafico"]], { extraFiles: [{ name: "ppt/embeddings/Microsoft_Excel_Worksheet.xlsx", data: inner }] });
  const result = readOoxml(bytes, "pptx");
  assert.ok(result.ok, code(result));
  assert.equal(result.value.embedded, 1);
  assert.deepEqual(result.value.tables, [{ name: "Incorporato: Dati", rows: [["serie", "valore"], ["a", "1"]] }]);
  assert.match(result.value.text, /serie\tvalore/);
});

test("embedded objects that cannot be checked reject the file", () => {
  const ole = buildDocx(["x"], [], { extraFiles: [{ name: "word/embeddings/oleObject1.bin", data: randomBytes(64) }] });
  assert.equal(code(readOoxml(ole, "docx")), "oggetto_incorporato");
  const inner = buildDocx(["livello due"], [], {
    extraFiles: [{ name: "word/embeddings/x.xlsx", data: buildXlsx([{ name: "S", rows: [["a"]] }]) }],
  });
  const twoLevels = buildDocx(["x"], [], { extraFiles: [{ name: "word/embeddings/doc.docx", data: inner }] });
  assert.equal(code(readOoxml(twoLevels, "docx")), "oggetto_incorporato");
});

test("embedded documents share one decompression budget with the whole file", () => {
  // Each embedded document alone fits the limit; together they do not (before, every one got the full remainder).
  const limits = { ...OOXML_LIMITS, maxTotalUncompressedBytes: 300_000, ratioCheckFromBytes: 10 * 1024 * 1024 };
  const filler = Array.from({ length: 2_000 }, (_, i) => `riga ${i} del documento di prova`);
  const inner = buildDocx(filler);
  const one = buildDocx(["x"], [], { extraFiles: [{ name: "word/embeddings/d0.docx", data: inner }] });
  assert.equal(code(readOoxml(one, "docx", limits)), undefined);
  const many = buildDocx(["x"], [], {
    extraFiles: Array.from({ length: 8 }, (_, i) => ({ name: `word/embeddings/d${i}.docx`, data: inner })),
  });
  assert.equal(code(readOoxml(many, "docx", limits)), "zip_troppo_grande");
  // At most 20 embedded documents in the whole file, however small.
  const tiny = buildDocx(["piccolo"]);
  const crowd = buildDocx(["x"], [], {
    extraFiles: Array.from({ length: 21 }, (_, i) => ({ name: `word/embeddings/t${i}.docx`, data: tiny })),
  });
  assert.equal(code(readOoxml(crowd, "docx")), "zip_troppe_voci");
  const twenty = buildDocx(["x"], [], {
    extraFiles: Array.from({ length: 20 }, (_, i) => ({ name: `word/embeddings/t${i}.docx`, data: tiny })),
  });
  const read = readOoxml(twenty, "docx");
  assert.ok(read.ok, code(read));
  assert.equal(read.value.embedded, 20);
});

test("text kept in attributes, formulas, validations, headers and named formulas is read", () => {
  const pivot = `<?xml version="1.0" encoding="UTF-8"?><pivotCacheDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"><cacheFields count="1"><cacheField name="Campo pivot inventato"><sharedItems><s v="Voce pivot inventata"/><n v="3"/></sharedItems></cacheField></cacheFields></pivotCacheDefinition>`;
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><f>CONCATENATE("Formula inventata",B1)</f><v>0</v></c></row></sheetData><dataValidations count="1"><dataValidation type="list" prompt="Messaggio inventato" sqref="A1"><formula1>"Lista inventata,Altro"</formula1></dataValidation></dataValidations><headerFooter><oddHeader>&amp;CIntestazione inventata</oddHeader><oddFooter>Piede inventato</oddFooter></headerFooter></worksheet>`;
  const bytes = buildXlsx([{ name: "S", rows: SHEET }], {
    extraFiles: [
      { name: "xl/pivotCache/pivotCacheDefinition1.xml", data: pivot },
      { name: "xl/worksheets/sheet9.xml", data: sheet },
    ],
  });
  const result = readOoxml(bytes, "xlsx");
  assert.ok(result.ok, code(result));
  for (const expected of ["Campo pivot inventato", "Voce pivot inventata", "Formula inventata", "Lista inventata", "Messaggio inventato", "Intestazione inventata", "Piede inventato"]) {
    assert.ok(result.value.text.includes(expected), expected);
  }
  // Namespaces, relationship ids and numbers are not text.
  assert.equal(result.value.text.includes("schemas.openxmlformats.org"), false);
  assert.equal(/\brId1\b/.test(result.value.text), false);
});

test("macros are refused, by part or by content type", () => {
  const vba = buildXlsx([{ name: "S", rows: SHEET }], { extraFiles: [{ name: "xl/vbaProject.bin", data: randomBytes(32) }] });
  assert.equal(code(readOoxml(vba, "xlsx")), "macro_non_ammesse");
  const xlsm = buildXlsx([{ name: "S", rows: SHEET }], { mainContentType: "application/vnd.ms-excel.sheet.macroEnabled.main+xml" });
  assert.equal(code(readOoxml(xlsm, "xlsx")), "macro_non_ammesse");
});

test("the kind must match the extension", () => {
  const docx = buildDocx(["x"]);
  assert.equal(code(readOoxml(docx, "xlsx")), "ooxml_tipo_sconosciuto");
  const notOffice = buildZip([{ name: "a.txt", data: "ciao" }]);
  assert.equal(code(readOoxml(notOffice)), "ooxml_tipo_sconosciuto");
  const opened = openZip(docx);
  assert.ok(opened.ok);
  assert.equal(ooxmlKind(opened.value), "docx");
});

test("a DOCTYPE in a part rejects the document", () => {
  const withDoctype = buildZip([
    { name: "[Content_Types].xml", data: "<Types/>" },
    { name: "word/document.xml", data: `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><w:document xmlns:w="w"><w:body><w:p><w:r><w:t>&a;</w:t></w:r></w:p></w:body></w:document>` },
  ]);
  assert.equal(code(readOoxml(withDoctype, "docx")), "ooxml_non_valido");
});

test("paths with .., absolute paths, backslashes and duplicates are refused", () => {
  for (const name of ["../evil.xml", "word/../../evil.xml", "/etc/evil.xml", "word\\evil.xml", "C:/evil.xml", "word//x.xml", "./x.xml"]) {
    const zip = buildZip([
      { name: "[Content_Types].xml", data: "<Types/>" },
      { name, data: "x" },
    ]);
    assert.equal(code(openZip(zip)), "zip_percorso_non_valido", name);
  }
  const duplicate = buildZip([
    { name: "word/document.xml", data: "a" },
    { name: "WORD/Document.xml", data: "b" },
  ]);
  assert.equal(code(openZip(duplicate)), "zip_percorso_non_valido");
});

test("a zip bomb is refused before inflating", () => {
  const bomb = buildZip([
    { name: "[Content_Types].xml", data: "<Types/>" },
    { name: "xl/workbook.xml", data: Buffer.alloc(5 * 1024 * 1024) },
  ]);
  assert.ok(bomb.length < 64 * 1024);
  assert.equal(code(openZip(bomb)), "zip_bomba");
  assert.equal(code(readOoxml(bomb)), "zip_bomba");
});

test("the declared total is capped", () => {
  const limits = { ...ZIP_LIMITS, maxTotalUncompressedBytes: 1000, ratioCheckFromBytes: 10_000 };
  const zip = buildZip([
    { name: "a.bin", data: randomBytes(600) },
    { name: "b.bin", data: randomBytes(600) },
  ]);
  assert.equal(code(openZip(zip, limits)), "zip_troppo_grande");
  assert.ok(openZip(zip).ok);
  assert.equal(ZIP_LIMITS.maxTotalUncompressedBytes, 50 * 1024 * 1024);
  assert.equal(ZIP_LIMITS.maxEntries, 2000);
  assert.equal(ZIP_LIMITS.maxRatio, 100);
});

test("too many entries are refused", () => {
  const files = Array.from({ length: 2001 }, (_, i) => ({ name: `f${i}.txt`, data: "x", method: 0 as const }));
  assert.equal(code(openZip(buildZip(files))), "zip_troppe_voci");
});

test("headers that lie about sizes or CRC are caught when inflating", () => {
  const data = randomBytes(4096);
  const smaller = buildZip([{ name: "a.bin", data, declaredUncompressedSize: 100 }]);
  const opened = openZip(smaller);
  assert.ok(opened.ok);
  assert.equal(code(readZipEntry(opened.value, opened.value.entries[0])), "zip_non_valido");
  const larger = buildZip([{ name: "a.bin", data, declaredUncompressedSize: 5000 }]);
  const openedLarger = openZip(larger);
  assert.ok(openedLarger.ok);
  assert.equal(code(readZipEntry(openedLarger.value, openedLarger.value.entries[0])), "zip_non_valido");
  const badCrc = buildZip([{ name: "a.bin", data, crc: 12345 }]);
  const openedCrc = openZip(badCrc);
  assert.ok(openedCrc.ok);
  assert.equal(code(readZipEntry(openedCrc.value, openedCrc.value.entries[0])), "zip_non_valido");
  const good = buildZip([{ name: "a.bin", data }]);
  const openedGood = openZip(good);
  assert.ok(openedGood.ok);
  const read = readZipEntry(openedGood.value, zipEntry(openedGood.value, "A.BIN")!);
  assert.ok(read.ok);
  assert.deepEqual(read.value, data);
});

test("encrypted entries, zip64, trailing data and non-zips are refused", () => {
  assert.equal(code(openZip(buildZip([{ name: "a.txt", data: "x", flags: 0x0001 }]))), "zip_cifrato");
  assert.equal(code(openZip(buildZip([{ name: "a.txt", data: "x" }], { zip64Locator: true }))), "zip64_non_ammesso");
  assert.equal(code(openZip(buildZip([{ name: "a.txt", data: "x" }], { trailing: Buffer.from("tail") }))), "zip_non_valido");
  assert.equal(code(openZip(Buffer.from("not a zip at all, just text"))), "zip_non_valido");
  assert.equal(code(openZip(Buffer.alloc(0))), "zip_non_valido");
  const truncated = buildZip([{ name: "a.txt", data: "x" }]);
  assert.equal(code(openZip(truncated.subarray(0, truncated.length - 5))), "zip_non_valido");
});

test("the cell budget stops oversized sheets", () => {
  const rows = Array.from({ length: 20 }, (_, r) => [`r${r}`, r, r * 2]);
  const bytes = buildXlsx([{ name: "S", rows }]);
  assert.equal(code(readOoxml(bytes, "xlsx", { ...OOXML_LIMITS, maxCells: 10 })), "foglio_troppo_grande");
  assert.ok(readOoxml(bytes, "xlsx").ok);
});
