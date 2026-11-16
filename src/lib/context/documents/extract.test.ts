import test from "node:test";
import assert from "node:assert/strict";
import { buildDocx, buildPdf, buildPptx, buildXlsx, pdfTextContent } from "../../uc/files/fixtures.ts";
import { CONTEXT_LIMITS } from "../vocab.ts";
import { extractDocumentText } from "./extract.ts";

// Il testo dei file caricati, senza modello (RILASCIO-9a-COSTRUZIONE.md §10.3). File costruiti qui, con testi inventati.

const text = (result: ReturnType<typeof extractDocumentText>) => {
  assert.equal(result.ok, true, result.ok ? "" : `${result.code}: ${result.message}`);
  return result.ok ? result : (undefined as never);
};

test("Word, Excel e PowerPoint danno il loro testo, senza modello", () => {
  const docx = text(extractDocumentText(buildDocx(["Il gestionale è SAP Business One.", "Gli ordini si inseriscono a mano."], [[["Fornitore", "Città"], ["Legnami Udine", "Udine"]]]), "verbale.docx"));
  assert.equal(docx.via, "office");
  assert.equal(docx.lowText, false);
  assert.equal(docx.kind, "docx");
  assert.match(docx.text, /Il gestionale è SAP Business One\./);
  assert.match(docx.text, /Legnami Udine/);

  const xlsx = text(extractDocumentText(buildXlsx([{ name: "Ordini", rows: [["Cliente", "Importo"], ["Mobili Verdi", 1200]] }]), "ordini.xlsx"));
  assert.equal(xlsx.via, "office");
  assert.match(xlsx.text, /Mobili Verdi/);
  assert.match(xlsx.text, /1200/);

  const pptx = text(extractDocumentText(buildPptx([["Piano 2027", "Ridurre i tempi di consegna"], ["Prossimi passi"]]), "piano.pptx"));
  assert.equal(pptx.via, "office");
  assert.match(pptx.text, /Ridurre i tempi di consegna/);
  assert.match(pptx.text, /Prossimi passi/);
});

test("un PDF con testo si legge senza modello; una scansione dice lowText", () => {
  const lines = Array.from({ length: 12 }, (_, i) => `Riga ${i + 1}: il magazzino riceve gli ordini e prepara le spedizioni ogni mattina.`);
  const pdf = text(extractDocumentText(buildPdf([{ content: pdfTextContent(lines) }]), "procedura.pdf"));
  assert.equal(pdf.via, "pdf");
  assert.equal(pdf.lowText, false);
  assert.match(pdf.text, /il magazzino riceve gli ordini/);
  // Una pagina quasi senza testo: il testo trovato non basta, e chi chiama decide se chiedere il modello (con l'ok).
  const scan = text(extractDocumentText(buildPdf([{ content: pdfTextContent(["pag. 1"]) }]), "scansione.pdf"));
  assert.equal(scan.via, "pdf");
  assert.equal(scan.lowText, true);
});

test("i file di testo: UTF-8 e Windows-1252, con gli a capo normalizzati", () => {
  const utf8 = text(extractDocumentText(new TextEncoder().encode("Qualità\r\nè alta\r\n"), "note.txt"));
  assert.deepEqual([utf8.via, utf8.text], ["testo", "Qualità\nè alta"]);
  const cp1252 = text(extractDocumentText(Uint8Array.from([0x51, 0x75, 0x61, 0x6c, 0x69, 0x74, 0xe0, 0x20, 0xe8, 0x20, 0x61, 0x6c, 0x74, 0x61]), "note.md"));
  assert.equal(cp1252.text, "Qualità è alta");
  const csv = text(extractDocumentText(new TextEncoder().encode("cliente;importo\nMobili Verdi;1200\n"), "ordini.csv"));
  assert.equal(csv.text, "cliente;importo\nMobili Verdi;1200");
});

test("un file con l'estensione sbagliata, vuoto, di un vecchio formato o troppo grande non si legge, con il suo messaggio", () => {
  const docx = buildDocx(["Testo"]);
  for (const [bytes, name, code] of [
    [docx, "verbale.pdf", "tipo_non_coincide"],
    [docx, "verbale.xlsx", "tipo_non_coincide"],
    [new TextEncoder().encode("solo testo"), "finto.docx", "tipo_non_coincide"],
    [new Uint8Array(0), "vuoto.txt", "file_vuoto"],
    [new TextEncoder().encode("ciao"), "programma.exe", "estensione_non_ammessa"],
    [Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]), "vecchio.doc", "estensione_non_ammessa"],
    [Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]), "vecchio.docx", "formato_office_vecchio"],
    [new Uint8Array(CONTEXT_LIMITS.uploadMaxBytes + 1).fill(0x61), "grande.txt", "file_troppo_grande"],
  ] as const) {
    const result = extractDocumentText(bytes, name);
    assert.equal(result.ok, false, name);
    assert.equal(!result.ok && result.code, code, name);
    assert.ok(!result.ok && result.message.length > 10, name);
  }
  // Un PDF cifrato torna il suo messaggio e non si salva.
  const locked = extractDocumentText(buildPdf([{ content: pdfTextContent(["Segreto"]) }], { encrypt: true }), "protetto.pdf");
  assert.deepEqual([locked.ok, !locked.ok && locked.code], [false, "pdf_cifrato"]);
});

test("il tetto: al massimo 100.000 caratteri di testo", () => {
  const long = "parola ".repeat(30_000); // 210.000 caratteri
  const result = text(extractDocumentText(new TextEncoder().encode(long), "lungo.txt"));
  assert.equal(result.text.length, CONTEXT_LIMITS.documentTextMax);
  assert.equal(CONTEXT_LIMITS.documentTextMax, 100_000);
  assert.equal(CONTEXT_LIMITS.uploadMaxBytes, 4 * 1024 * 1024);
});
