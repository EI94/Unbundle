import test from "node:test";
import assert from "node:assert/strict";
import { buildPdf, pdfTextContent } from "../../uc/files/fixtures.ts";
import { inspectFile } from "../../uc/files/inspect.ts";
import { textForScan } from "../../uc/files/upload.ts";
import { scanText } from "../../uc/text/scan.ts";
import {
  PERSONAL_WARNING_CODES,
  isReferentBlobPath,
  isReferentQuarantinePath,
  referentBlobPath,
  referentFileDecision,
  referentUploadCheck,
  rejectionMessage,
} from "./files.ts";
import { REFERENT_ERROR_MESSAGES, REFERENT_PUBLIC_TEXT } from "./labels.ts";

// I file di «Chiedi al referente» (SPEC §2.1, §2.3). Contenuti inventati.
const WS = "3f2a9c1e-0000-4000-8000-0000000000a1";
const UC = "3f2a9c1e-0000-4000-8000-0000000000b1";
const FILE = "3f2a9c1e-0000-4000-8000-0000000000f1";
const LINES = Array.from({ length: 6 }, (_, i) => `Regola ${i + 1}: il margine per tratta si calcola dal costo orario e dal prezzo proposto`);
const decide = (bytes: Uint8Array, name: string) => {
  const report = inspectFile(bytes, name, { zone: "standard", a8Resolved: false });
  return referentFileDecision(report, report.extractedText ? scanText(textForScan(report.extractedText), { context: "commento" }) : null);
};

test("un CSV pulito è pulito, senza avvisi", () => {
  const out = decide(Buffer.from(`colonna;valore\n${LINES.join("\n")}\n`), "regole.csv");
  assert.equal(out.status, "pulito");
  assert.equal(out.personalWarning, false);
  assert.equal(out.message, null);
});

test("nomi, email o telefoni: pulito con l'avviso «Può contenere dati personali»", () => {
  const out = decide(Buffer.from(`Referente Mario Rossi, mario.rossi@example.com\n${LINES.join("\n")}\n`), "contatti.txt");
  assert.equal(out.status, "pulito");
  assert.equal(out.personalWarning, true);
  assert.equal(out.message, REFERENT_PUBLIC_TEXT.fileWarning);
  assert.ok((out.findings.avvisi ?? []).some((c) => (PERSONAL_WARNING_CODES as readonly string[]).includes(c)));
});

test("un PDF con poco testo non si rifiuta: va in revisione", () => {
  const pdf = buildPdf([{ content: pdfTextContent(["Pagina quasi vuota"]) }]);
  const out = decide(pdf, "scansione.pdf");
  assert.equal(out.status, "in_revisione");
  assert.equal(out.reason, null);
  assert.equal(out.message, REFERENT_ERROR_MESSAGES.pdf_in_revisione);
});

test("dati sanitari o discriminatori: rifiutato, con il motivo", () => {
  const health = decide(Buffer.from(`${LINES.join("\n")}\nIl dipendente ha una diagnosi di diabete e una visita medica.\n`), "note.txt");
  assert.equal(health.status, "rifiutato");
  assert.ok(health.reason, "il motivo resta");
  const disc = decide(Buffer.from(`${LINES.join("\n")}\nIl cliente preferisce solo piloti donne\n`), "note.txt");
  assert.equal(disc.status, "rifiutato");
  assert.equal(disc.reason, "testo_discriminatorio");
});

test("percorsi: solo questa scheda di questo workspace", () => {
  const std = referentBlobPath("standard", WS, UC, FILE);
  const q = referentBlobPath("quarantena", WS, UC, FILE);
  assert.ok(std.startsWith(`uc/s/${WS}/${UC}/`));
  assert.ok(q.startsWith(`uc/q/${WS}/${UC}/`));
  assert.ok(isReferentBlobPath(std, WS, UC));
  assert.ok(isReferentBlobPath(std, WS.toUpperCase(), UC.toUpperCase()));
  assert.equal(isReferentBlobPath(std, "3f2a9c1e-0000-4000-8000-0000000000a2", UC), false, "un altro workspace");
  assert.equal(isReferentBlobPath(std, WS, "3f2a9c1e-0000-4000-8000-0000000000b2"), false, "un'altra scheda");
  assert.equal(isReferentBlobPath(q, WS, UC), false, "la quarantena non si scarica");
  assert.equal(isReferentBlobPath(`uc/s/${WS}/${UC}/../x`, WS, UC), false);
  assert.ok(isReferentQuarantinePath(q, WS, UC));
  assert.equal(isReferentQuarantinePath(std, WS, UC), false);
});

test("richiesta di caricamento: dichiarazione, estensione e dimensione", () => {
  assert.equal(referentUploadCheck({ fileName: "a.csv", size: 10, declaration: true, mode: "server" }).ok, true);
  assert.equal(referentUploadCheck({ fileName: "a.csv", size: 10, declaration: false, mode: "server" }).ok, false);
  assert.equal(referentUploadCheck({ fileName: "a.exe", size: 10, declaration: true, mode: "server" }).ok, false);
  assert.equal(referentUploadCheck({ fileName: "a.png", size: 10, declaration: true, mode: "server" }).ok, false, "niente immagini");
  assert.equal(referentUploadCheck({ fileName: "a.pdf", size: 5 * 1024 * 1024, declaration: true, mode: "server" }).ok, false, "oltre 4 MB dal server");
  assert.equal(referentUploadCheck({ fileName: "a.pdf", size: 5 * 1024 * 1024, declaration: true, mode: "client" }).ok, true);
});

test("messaggi dei motivi salvati", () => {
  assert.equal(rejectionMessage(null), null);
  assert.equal(rejectionMessage("revisione_rifiutata"), REFERENT_ERROR_MESSAGES.revisione_rifiutata);
  assert.equal(rejectionMessage("revisione_scaduta"), REFERENT_ERROR_MESSAGES.revisione_scaduta);
  assert.equal(rejectionMessage("quarantena_scaduta"), REFERENT_ERROR_MESSAGES.quarantena_scaduta);
});
