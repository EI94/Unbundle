import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { buildDocx, buildPdf, buildPptx, buildXlsx, buildZip, pdfTextContent } from "./fixtures.ts";
import {
  TEXT_FILE_KINDS,
  UC_ALLOWED_UPLOAD_MIME_TYPES,
  UC_FILE_TYPES,
  UC_UPLOAD_LIMITS,
  decodeTextFile,
  detectTextEncoding,
  kindFromFileName,
  sniffFile,
} from "./sniff.ts";

function code(result: { ok: boolean; code?: string }): string | undefined {
  return result.ok ? undefined : result.code;
}

const PDF = buildPdf([{ content: pdfTextContent(["Documento di prova"]) }]);
const XLSX = buildXlsx([{ name: "S", rows: [["colonna_a", "colonna_b"], ["1", "2"]] }]);
const DOCX = buildDocx(["Paragrafo di prova"]);
const PPTX = buildPptx([["Diapositiva di prova"]]);
const CSV = Buffer.from("colonna_a;colonna_b\n1;2\n", "utf8");

test("the kind comes from the bytes and must match the extension", () => {
  const cases: [Buffer, string, string][] = [
    [PDF, "report.pdf", "pdf"],
    [XLSX, "dati.xlsx", "xlsx"],
    [DOCX, "nota.docx", "docx"],
    [PPTX, "slide.pptx", "pptx"],
    [CSV, "dati.csv", "csv"],
    [CSV, "dati.tsv", "tsv"],
    [Buffer.from("testo semplice\n"), "nota.txt", "txt"],
    [Buffer.from("# Titolo\n"), "nota.md", "md"],
    [Buffer.from("# Titolo\n"), "nota.markdown", "md"],
  ];
  for (const [bytes, name, kind] of cases) {
    const result = sniffFile(bytes, name);
    assert.ok(result.ok, `${name}: ${code(result)}`);
    assert.equal(result.value.kind, kind, name);
    assert.equal(result.value.mime, UC_FILE_TYPES[kind as keyof typeof UC_FILE_TYPES].mime);
  }
  assert.equal(sniffFile(PDF, "REPORT.PDF").ok, true);
});

test("the declared type never wins over the content", () => {
  assert.equal(code(sniffFile(XLSX, "finto.pdf")), "tipo_non_coincide");
  assert.equal(code(sniffFile(PDF, "finto.xlsx")), "tipo_non_coincide");
  assert.equal(code(sniffFile(DOCX, "finto.xlsx")), "tipo_non_coincide");
  assert.equal(code(sniffFile(XLSX, "finto.csv")), "tipo_non_coincide");
  assert.equal(code(sniffFile(CSV, "finto.pdf")), "tipo_non_coincide");
  assert.equal(code(sniffFile(CSV, "finto.docx")), "tipo_non_coincide");
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]);
  assert.equal(code(sniffFile(png, "immagine.csv")), "tipo_non_coincide");
  const plainZip = buildZip([{ name: "dati.csv", data: "a;b\n" }]);
  assert.equal(code(sniffFile(plainZip, "archivio.xlsx")), "tipo_non_coincide");
});

test("old Office files, unknown extensions and empty or huge files are refused", () => {
  const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), randomBytes(512)]);
  assert.equal(code(sniffFile(ole, "vecchio.xls")), "estensione_non_ammessa");
  assert.equal(code(sniffFile(ole, "protetto.xlsx")), "formato_office_vecchio");
  assert.equal(code(sniffFile(Buffer.from("MZ"), "programma.exe")), "estensione_non_ammessa");
  assert.equal(code(sniffFile(CSV, "senza_estensione")), "estensione_non_ammessa");
  assert.equal(code(sniffFile(Buffer.alloc(0), "vuoto.csv")), "file_vuoto");
  const big = sniffFile(Buffer.alloc(1024, 0x61), "grande.txt", { maxBytes: 1000 });
  assert.equal(code(big), "file_troppo_grande");
  const overText = Buffer.alloc(UC_UPLOAD_LIMITS.textScanMaxBytes + 1, 0x61);
  assert.equal(code(sniffFile(overText, "grande.csv")), "file_troppo_grande");
});

test("macros and unsafe zips are refused while sniffing", () => {
  const xlsm = buildXlsx([{ name: "S", rows: [["a"]] }], { mainContentType: "application/vnd.ms-excel.sheet.macroEnabled.main+xml" });
  assert.equal(code(sniffFile(xlsm, "macro.xlsx")), "macro_non_ammesse");
  const bomb = buildXlsx([{ name: "S", rows: [["a"]] }], { extraFiles: [{ name: "xl/media/zeri.bin", data: Buffer.alloc(5 * 1024 * 1024) }] });
  assert.equal(code(sniffFile(bomb, "bomba.xlsx")), "zip_bomba");
  const escape = buildZip([
    { name: "[Content_Types].xml", data: "<Types/>" },
    { name: "../fuori.xml", data: "x" },
  ]);
  assert.equal(code(sniffFile(escape, "fuga.docx")), "zip_percorso_non_valido");
});

test("text must be UTF-8 or Windows-1252, without NUL bytes or many control characters", () => {
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("città;età\r\n1;2\r\n", "utf8")]);
  const sniffed = sniffFile(bom, "bom.csv");
  assert.ok(sniffed.ok);
  assert.deepEqual(sniffed.value.text, { encoding: "utf-8", bom: true });
  assert.equal(decodeTextFile(bom, sniffed.value.text!), "città;età\n1;2\n");

  const cp1252 = Buffer.from([0x63, 0x69, 0x74, 0x74, 0xe0, 0x3b, 0x80, 0x0d, 0x0a]);
  const windows = sniffFile(cp1252, "excel.csv");
  assert.ok(windows.ok);
  assert.deepEqual(windows.value.text, { encoding: "windows-1252", bom: false });
  assert.equal(decodeTextFile(cp1252, windows.value.text!), "città;€\n");

  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("a;b\n", "utf16le")]);
  assert.equal(code(sniffFile(utf16, "utf16.csv")), "testo_non_leggibile");
  assert.equal(code(sniffFile(randomBytes(4096), "rumore.txt")), "testo_non_leggibile");
  assert.equal(detectTextEncoding(Buffer.from("a\u0000b")), null);
  const controls = Buffer.from(Array.from({ length: 200 }, (_, i) => (i % 10 === 0 ? 0x01 : 0x61)));
  assert.equal(detectTextEncoding(controls), null);
});

test("the allowed MIME list matches the accepted kinds", () => {
  assert.equal(kindFromFileName("a.XLSX"), "xlsx");
  assert.equal(kindFromFileName("a.xls"), null);
  assert.equal(kindFromFileName("a.tar.gz"), null);
  assert.deepEqual([...TEXT_FILE_KINDS], ["csv", "tsv", "txt", "md"]);
  assert.ok(UC_ALLOWED_UPLOAD_MIME_TYPES.includes("application/pdf"));
  assert.ok(UC_ALLOWED_UPLOAD_MIME_TYPES.includes("text/csv"));
  assert.equal(UC_ALLOWED_UPLOAD_MIME_TYPES.length, new Set(UC_ALLOWED_UPLOAD_MIME_TYPES).size);
  assert.equal(UC_UPLOAD_LIMITS.clientBlobMaxBytes, 20 * 1024 * 1024);
  assert.equal(UC_UPLOAD_LIMITS.serverMaxBytes, 4 * 1024 * 1024);
});
