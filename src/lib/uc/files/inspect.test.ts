import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildDocx, buildPdf, buildXlsx, pdfTextContent } from "./fixtures.ts";
import { INSPECT_MESSAGES, inspectFile, type InspectOptions } from "./inspect.ts";
import { MASK } from "./mask.ts";
import { UC_UPLOAD_LIMITS } from "./sniff.ts";

// Invented content only: no client values.
const STANDARD: InspectOptions = { zone: "standard", a8Resolved: false };
const PERSONAL_OPEN: InspectOptions = { zone: "personale", a8Resolved: true };
const PERSONAL_CLOSED: InspectOptions = { zone: "personale", a8Resolved: false };
const LINES = Array.from({ length: 6 }, (_, i) => `Regola ${i + 1}: il margine per tratta si calcola dal costo orario e dal prezzo proposto al cliente`);

const csv = (text: string) => Buffer.from(text, "utf8");

test("a clean CSV passes with a masked preview, hash and kind", () => {
  const bytes = csv("codice_tratta;nome_aeroporto;minuti\nAAA-BBB;Aeroporto Uno;95\nCCC-DDD;Aeroporto Due;140\n");
  const report = inspectFile(bytes, "tratte.csv", STANDARD);
  assert.equal(report.status, "pulito");
  assert.equal(report.reason, null);
  assert.equal(report.kind, "csv");
  assert.equal(report.mime, "text/csv");
  assert.equal(report.sizeBytes, bytes.length);
  assert.equal(report.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(report.contentScanned, true);
  assert.equal(report.personalDetected, false);
  assert.deepEqual(report.findings, {});
  assert.deepEqual(report.preview?.columns, ["codice_tratta", "nome_aeroporto", "minuti"]);
  assert.equal(report.preview?.total_rows, 2);
  assert.match(report.extractedText ?? "", /AAA-BBB/);
});

test("a «visita medica» column rejects the file with a content-free finding", () => {
  const report = inspectFile(csv("codice_equipaggio;visita medica\nC-001;scaduta\n"), "turni.csv", PERSONAL_OPEN);
  assert.equal(report.status, "rifiutato");
  assert.equal(report.reason, "sanitario");
  assert.equal(report.message, INSPECT_MESSAGES.sanitario);
  assert.equal(report.findings.categoria, "sanitario");
  assert.equal(report.findings.colonne, 1);
  assert.ok(report.findings.termini?.includes("visita medica"));
  assert.equal(report.preview, null);
  assert.equal(JSON.stringify(report.findings).includes("C-001"), false);
  assert.equal(JSON.stringify(report.findings).includes("scaduta"), false);
});

test("health words kept in a pivot cache reject the workbook", () => {
  const pivot = `<?xml version="1.0" encoding="UTF-8"?><pivotCacheDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cacheFields count="1"><cacheField name="Esito"><sharedItems><s v="Visita medica"/><s v="Malattia"/></sharedItems></cacheField></cacheFields></pivotCacheDefinition>`;
  const bytes = buildXlsx([{ name: "Dati", rows: [["codice", "minuti"], ["A", 10]] }], { extraFiles: [{ name: "xl/pivotCache/pivotCacheDefinition1.xml", data: pivot }] });
  const report = inspectFile(bytes, "dati.xlsx", STANDARD);
  assert.equal(report.status, "rifiutato");
  assert.equal(report.reason, "sanitario");
});

test("health columns blocked in answers are blocked in files too", () => {
  for (const header of ["Gruppo sanguigno", "Giorni malato", "Esito tampone Covid", "Stato di salute", "Ricovero"]) {
    const report = inspectFile(csv(`codice;${header}\nC-001;x\n`), "dati.csv", STANDARD);
    assert.equal(report.status, "rifiutato", header);
    assert.equal(report.reason, "sanitario", header);
    assert.equal(report.findings.colonne, 1, header);
  }
});

test("health words in the values or in documents reject the file too", () => {
  // Below the rows read as headers, the word is still found in the text.
  const rows = Array.from({ length: 15 }, (_, i) => `C-${i};${i === 13 ? "visita medica" : "turno"}`).join("\n");
  const cell = inspectFile(csv(`codice;motivo assenza\n${rows}\n`), "assenze.csv", STANDARD);
  assert.equal(cell.reason, "sanitario");
  assert.equal(cell.findings.colonne, 0);
  assert.ok((cell.findings.nel_testo ?? 0) > 0);
  const docx = inspectFile(buildDocx(["Procedura interna", "Prima del volo serve la visita medica valida."]), "procedura.docx", STANDARD);
  assert.equal(docx.reason, "sanitario");
  const xlsxComment = inspectFile(
    buildXlsx([{ name: "S", rows: [["codice"], ["A"]] }], {
      extraFiles: [{ name: "xl/comments1.xml", data: "<comments><commentList><comment><text><t>idoneità medica da verificare</t></text></comment></commentList></comments>" }],
    }),
    "commento.xlsx",
    STANDARD,
  );
  assert.equal(xlsxComment.reason, "sanitario");
});

test("a PDF with «visita medica» inside a FlateDecode stream is rejected", () => {
  const pdf = buildPdf([{ content: pdfTextContent([...LINES, "Il pilota rientra dopo la visita medica periodica."]) }]);
  const report = inspectFile(pdf, "regole.pdf", STANDARD);
  assert.equal(report.status, "rifiutato");
  assert.equal(report.reason, "sanitario");
  assert.equal(report.kind, "pdf");
});

test("a PDF with little text waits for manual review, or is refused in the personal zone", () => {
  const pdf = buildPdf([{ content: pdfTextContent(["Pagina quasi vuota"]) }]);
  const standard = inspectFile(pdf, "scansione.pdf", STANDARD);
  assert.equal(standard.status, "revisione_manuale");
  assert.equal(standard.contentScanned, false);
  assert.deepEqual(standard.findings, { revisione_manuale: true, motivi_revisione: ["poche_lettere"] });
  assert.equal(standard.message, INSPECT_MESSAGES.revisione_manuale);
  const personal = inspectFile(pdf, "scansione.pdf", PERSONAL_OPEN);
  assert.equal(personal.status, "rifiutato");
  assert.equal(personal.reason, "testo_scarso");
  assert.match(personal.message ?? "", /carica un CSV o un XLSX/);
  const readable = inspectFile(buildPdf([{ content: pdfTextContent(LINES) }]), "regole.pdf", STANDARD);
  assert.equal(readable.status, "pulito");
  assert.equal(readable.preview, null);
});

test("personal columns: refused before A.8 and in the standard zone, kept in the open personal zone", () => {
  const bytes = csv("codice_pilota;nome;cognome;tipo_abilitato\nP-01;Nome Inventato;Cognome Inventato;Tipo A\n");
  for (const options of [STANDARD, { zone: "standard", a8Resolved: true } as const, PERSONAL_CLOSED]) {
    const report = inspectFile(bytes, "piloti.csv", options);
    assert.equal(report.status, "rifiutato", JSON.stringify(options));
    assert.equal(report.reason, "dati_personali");
    assert.deepEqual(report.findings.termini, ["cognome", "nome"]);
    assert.equal(report.findings.colonne, 2);
  }
  const open = inspectFile(bytes, "piloti.csv", PERSONAL_OPEN);
  assert.equal(open.status, "pulito");
  assert.equal(open.personalDetected, true);
  // No preview in the personal zone: only metadata.
  assert.equal(open.preview, null);
});

test("personal values are found in XLSX cells and counted by kind", () => {
  const rows = [["codice", "recapito"], ...Array.from({ length: 5 }, (_, i) => [`R-${i}`, `persona${i}@esempio.it`])];
  const report = inspectFile(buildXlsx([{ name: "Contatti", rows }]), "contatti.xlsx", STANDARD);
  assert.equal(report.reason, "dati_personali");
  assert.deepEqual(report.findings.valori, { email: 5 });
  assert.equal(JSON.stringify(report.findings).includes("esempio.it"), false);
});

test("special categories and forbidden columns", () => {
  const special = inspectFile(csv("codice;religione\nA;x\n"), "x.csv", PERSONAL_OPEN);
  assert.equal(special.reason, "dati_particolari");
  const forbidden = inspectFile(csv("codice_pilota;data_nascita_inventata\nP-1;x\n"), "x.csv", { ...PERSONAL_OPEN, forbiddenColumns: ["data_nascita*"] });
  // «nascita» is personal too, but the item forbids the column outright: it is refused even in the open personal zone.
  assert.equal(forbidden.reason, "colonne_vietate");
  assert.deepEqual(forbidden.findings.termini, ["data_nascita*"]);
  const health = inspectFile(csv("codice_pilota;idoneità medica\nP-1;sì\n"), "x.csv", { ...PERSONAL_OPEN, forbiddenColumns: ["sanitari"] });
  assert.equal(health.reason, "sanitario");
});

test("type and readability failures carry the technical code", () => {
  const xlsx = buildXlsx([{ name: "S", rows: [["a"]] }]);
  const mismatch = inspectFile(xlsx, "finto.pdf", STANDARD);
  assert.equal(mismatch.reason, "file_non_ammesso");
  assert.equal(mismatch.code, "tipo_non_coincide");
  assert.deepEqual(mismatch.findings, { codice: "tipo_non_coincide" });
  assert.equal(mismatch.kind, null);
  const broken = Buffer.from(xlsx);
  broken[broken.length - 30] ^= 0xff;
  const unreadable = inspectFile(broken, "rotto.xlsx", STANDARD);
  assert.equal(unreadable.status, "rifiutato");
  assert.ok(["file_non_ammesso", "file_non_leggibile"].includes(unreadable.reason ?? ""));
  const encrypted = inspectFile(buildPdf([{ content: pdfTextContent(LINES) }], { encrypt: true }), "protetto.pdf", STANDARD);
  assert.equal(encrypted.reason, "file_non_leggibile");
  assert.equal(encrypted.code, "pdf_cifrato");
});

test("the personal zone takes at most 4 MB (server upload)", () => {
  const big = Buffer.alloc(UC_UPLOAD_LIMITS.serverMaxBytes + 1, 0x61);
  assert.equal(inspectFile(big, "grande.txt", PERSONAL_OPEN).code, "file_troppo_grande");
  assert.equal(inspectFile(big, "grande.txt", STANDARD).status, "pulito");
});

test("findings and messages never echo file content", () => {
  const secret = "ValoreSegretoInventato";
  const reports = [
    inspectFile(csv(`nome;visita medica\n${secret};x\n`), "a.csv", STANDARD),
    inspectFile(csv(`cognome;b\n${secret};x\n`), "b.csv", STANDARD),
    inspectFile(csv(`codice;${secret}@esempio.it\nA;1\n`), "c.csv", STANDARD),
  ];
  for (const report of reports) {
    assert.equal(report.status, "rifiutato");
    // A rejected file never hands back its text: the whole report is free of content.
    assert.equal(report.extractedText, null);
    assert.equal(JSON.stringify(report).includes(secret), false);
  }
  const healthPdf = inspectFile(buildPdf([{ content: pdfTextContent([...LINES, "Esito della visita medica del collega"]) }]), "e.pdf", STANDARD);
  assert.equal(healthPdf.status, "rifiutato");
  assert.equal(healthPdf.extractedText, null);
  const masked = inspectFile(csv(`codice;contatto\nA;${secret}@esempio.it\n`), "d.csv", PERSONAL_OPEN);
  assert.equal(masked.status, "pulito");
  assert.equal(masked.preview, null);
  const standardPreview = inspectFile(csv(`codice;nota\nA;testo\n`), "e.csv", STANDARD).preview;
  assert.deepEqual(standardPreview?.rows, [["A", "testo"]]);
  assert.notEqual(standardPreview?.rows[0][1], MASK);
});
