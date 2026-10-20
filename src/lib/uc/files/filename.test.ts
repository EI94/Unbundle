import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MAX_FILE_NAME_LENGTH, fileExtension, isUcBlobPath, safeFileName, ucBlobPath } from "./filename.ts";

test("only the final name survives, without folders", () => {
  assert.equal(safeFileName("../../etc/passwd"), "passwd");
  assert.equal(safeFileName("C:\\Users\\x\\Desktop\\turni.xlsx"), "turni.xlsx");
  assert.equal(safeFileName("cartella/sotto/report.pdf"), "report.pdf");
});

test("names are NFC and lose control, bidi and invisible characters", () => {
  const decomposed = "cafe\u0301.csv";
  assert.equal(safeFileName(decomposed), "café.csv");
  assert.equal(safeFileName("fattura\u202Efdp.exe.txt"), "fatturafdp.exe.txt");
  assert.equal(safeFileName("a\u0000b\u0007c\u200b.md"), "abc.md");
  assert.equal(safeFileName("riga\nnuova\t.txt"), "riga nuova.txt");
});

test("reserved characters, dots and Windows device names are neutralised", () => {
  assert.equal(safeFileName('a<b>c:d"e|f?g*h.csv'), "a_b_c_d_e_f_g_h.csv");
  assert.equal(safeFileName("...nascosto.txt"), "nascosto.txt");
  assert.equal(safeFileName("finale. . ."), "finale");
  assert.equal(safeFileName("CON.txt"), "_CON.txt");
  assert.equal(safeFileName("lpt1"), "_lpt1");
  assert.equal(safeFileName("Report.XLSX"), "Report.xlsx");
});

test("empty or junk names fall back to a neutral name", () => {
  assert.equal(safeFileName(""), "file");
  assert.equal(safeFileName(null), "file");
  assert.equal(safeFileName("   "), "file");
  assert.equal(safeFileName("../"), "file");
  assert.equal(safeFileName("___.pdf"), "file.pdf");
  assert.equal(safeFileName("\u202e\u200b", "allegato"), "allegato");
});

test("long names are cut to 255 characters keeping the extension", () => {
  const long = `${"à".repeat(400)}.xlsx`;
  const safe = safeFileName(long);
  assert.equal(Array.from(safe).length, MAX_FILE_NAME_LENGTH);
  assert.ok(safe.endsWith(".xlsx"));
  const emoji = `${"😀".repeat(300)}.pdf`;
  const cut = safeFileName(emoji);
  assert.equal(Array.from(cut).length, MAX_FILE_NAME_LENGTH);
  assert.ok(!cut.includes("\ufffd"));
});

test("extensions are lowercase and must look like extensions", () => {
  assert.equal(fileExtension("dati.CSV"), "csv");
  assert.equal(fileExtension("archivio.tar.gz"), "gz");
  assert.equal(fileExtension("senza_estensione"), null);
  assert.equal(fileExtension(".bashrc"), null);
  assert.equal(fileExtension("punto."), null);
  assert.equal(fileExtension("file.x y"), null);
  assert.equal(fileExtension("dir.ext/file"), null);
});

test("blob paths are built only from uuids", () => {
  const ws = randomUUID();
  const kase = randomUUID();
  const id = randomUUID();
  assert.equal(ucBlobPath("quarantena", ws, kase, id), `uc/q/${ws}/${kase}/${id}`);
  assert.equal(ucBlobPath("standard", ws, kase, id), `uc/s/${ws}/${kase}/${id}`);
  assert.equal(ucBlobPath("personale", ws, kase, id), `uc/p/${ws}/${kase}/${id}.enc`);
  assert.equal(ucBlobPath("standard", ws.toUpperCase(), kase, id), `uc/s/${ws}/${kase}/${id}`);
  assert.throws(() => ucBlobPath("standard", ws, kase, "../../x"));
  assert.throws(() => ucBlobPath("standard", "report.xlsx", kase, id));
  assert.throws(() => ucBlobPath("altro" as never, ws, kase, id));
  assert.throws(() => ucBlobPath("toString" as never, ws, kase, id));
  assert.equal(isUcBlobPath(ucBlobPath("standard", ws, kase, id), "toString" as never), false);
  assert.equal(isUcBlobPath(ucBlobPath("quarantena", ws, kase, id), "quarantena"), true);
  assert.equal(isUcBlobPath(ucBlobPath("quarantena", ws, kase, id), "standard"), false);
  assert.equal(isUcBlobPath(ucBlobPath("personale", ws, kase, id)), true);
  assert.equal(isUcBlobPath(`uc/p/${ws}/${kase}/${id}`), false);
  assert.equal(isUcBlobPath(`uc/s/${ws}/${kase}/${id}.enc`), false);
  assert.equal(isUcBlobPath(`uc/s/${ws}/${kase}/${id}/../x`), false);
  assert.equal(isUcBlobPath(`documents/${id}`), false);
});
