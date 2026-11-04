import test from "node:test";
import assert from "node:assert/strict";
import { buildPdf, buildXlsx, pdfTextContent } from "../../uc/files/fixtures.ts";
import { inspectFile } from "../../uc/files/inspect.ts";
import {
  PERSONAL_WARNING_CODES,
  checkReferentFile,
  isReferentBlobPath,
  isReferentQuarantinePath,
  referentBlobPath,
  referentUploadCheck,
  rejectionMessage,
} from "./files.ts";
import { REFERENT_ERROR_MESSAGES, REFERENT_PUBLIC_TEXT } from "./labels.ts";

// I file di «Chiedi al referente» (SPEC §2.1, §2.3). Contenuti inventati.
const WS = "3f2a9c1e-0000-4000-8000-0000000000a1";
const UC = "3f2a9c1e-0000-4000-8000-0000000000b1";
const FILE = "3f2a9c1e-0000-4000-8000-0000000000f1";
const LINES = Array.from({ length: 6 }, (_, i) => `Regola ${i + 1}: il margine per tratta si calcola dal costo orario e dal prezzo proposto`);
/** Il controllo vero di un file del referente o del team (lo stesso di `receiveReferentFile`). */
const decide = (bytes: Uint8Array, name: string) => checkReferentFile(bytes, name, 4 * 1024 * 1024).outcome;

test("un CSV pulito è pulito, senza avvisi", () => {
  const out = decide(Buffer.from(`colonna;valore\n${LINES.join("\n")}\n`), "regole.csv");
  assert.equal(out.status, "pulito");
  assert.equal(out.personalWarning, false);
  assert.equal(out.message, null);
});

test("(rilascio 5.1) nomi, email o telefoni: pulito, senza messaggio; resta solo il fatto del controllo", () => {
  const out = decide(Buffer.from(`Referente Mario Rossi, mario.rossi@example.com\n${LINES.join("\n")}\n`), "contatti.txt");
  assert.equal(out.status, "pulito");
  assert.equal(out.message, null);
  assert.equal(out.personalWarning, true);
  assert.ok((out.findings.avvisi ?? []).some((c) => (PERSONAL_WARNING_CODES as readonly string[]).includes(c)));
});

test("(rilascio 5.1) un CSV o un XLSX con colonne di nomi, email e telefoni è pulito, come lo stesso testo in un .txt", () => {
  const rows = [
    ["Fornitore", "Nome", "Cognome", "Email", "Telefono", "Indirizzo"],
    ["Alfa Prova Srl", "Aldo", "Prova", "ordini@alfa-prova.test", "+39 000 0000001", "Via Esempio 1"],
    ["Beta Esempio Spa", "Bruna", "Esempio", "conti@beta-esempio.test", "+39 000 0000002", "Via Prova 2"],
  ];
  for (const [name, bytes] of [
    ["fornitori.csv", Buffer.from(`${rows.map((r) => r.join(";")).join("\n")}\n`)],
    ["fornitori.xlsx", buildXlsx([{ name: "Fornitori", rows }])],
  ] as const) {
    const out = decide(bytes, name);
    assert.equal(out.status, "pulito", name);
    assert.equal(out.message, null, name);
    assert.equal(out.personalWarning, true, `${name}: resta solo il fatto del controllo`);
    assert.deepEqual([...(out.findings.avvisi ?? [])].filter((c) => (PERSONAL_WARNING_CODES as readonly string[]).includes(c)).sort(), ["testo_contatti", "testo_nomi_persona"], name);
  }
  // I dossier (`/r`) non cambiano: senza `contactsAllowed` le stesse colonne si rifiutano come prima.
  const dossier = inspectFile(Buffer.from(`${rows.map((r) => r.join(";")).join("\n")}\n`), "fornitori.csv", { zone: "standard", a8Resolved: false });
  assert.deepEqual([dossier.status, dossier.reason], ["rifiutato", "dati_personali"]);
  // Una sola colonna di email (indirizzi di aziende): pulito.
  assert.equal(decide(Buffer.from("Fornitore;Email fornitore\nAlfa;ordini@alfa-prova.test\n"), "registro.csv").status, "pulito");
});

test("(rilascio 5.1) una colonna di codici fiscali o di date di nascita resta rifiutata con quel motivo; IBAN, documenti e sesso con il loro", () => {
  for (const csv of ["Nome;Codice fiscale\nAldo;RSSMRA80A01H501U\n", "Fornitore;Riferimento\nAlfa;RSSMRA80A01H501U\n", "Nome;Data di nascita\nAldo;01/01/1980\n"]) {
    const out = decide(Buffer.from(csv), "persone.csv");
    assert.equal(out.status, "rifiutato", csv);
    assert.equal(out.reason, "dati_personali", csv);
    assert.equal(out.message, REFERENT_PUBLIC_TEXT.fileRejected.identificativi, csv);
  }
  const xlsx = decide(buildXlsx([{ name: "Persone", rows: [["Nome", "Codice fiscale"], ["Aldo", "RSSMRA80A01H501U"]] }]), "persone.xlsx");
  assert.deepEqual([xlsx.status, xlsx.message], ["rifiutato", REFERENT_PUBLIC_TEXT.fileRejected.identificativi]);
  for (const csv of ["Fornitore;IBAN\nAlfa;IT60X0542811101000000123456\n", "Nome;Sesso\nAldo;M\n", "Nome;Passaporto\nAldo;YA0000000\n"]) {
    const out = decide(Buffer.from(csv), "altri.csv");
    assert.equal(out.status, "rifiutato", csv);
    assert.equal(out.message, REFERENT_PUBLIC_TEXT.fileRejected.altriDati, `${csv}: mai «codici fiscali» se non ci sono`);
  }
  for (const m of Object.values(REFERENT_PUBLIC_TEXT.fileRejected)) assert.doesNotMatch(m, /nomi|email|telefon/i);
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
  // (Rilascio 5.1) I messaggi calmi: mai «nomi, email, telefoni», che qui passano.
  assert.equal(health.message, REFERENT_PUBLIC_TEXT.fileRejected.sanitario);
  assert.equal(disc.message, REFERENT_PUBLIC_TEXT.fileRejected.discriminatorio);
  const taxCode = decide(Buffer.from(`${LINES.join("\n")}\nCodice RSSMRA80A01H501U\n`), "note.txt");
  assert.equal(taxCode.status, "rifiutato");
  assert.equal(taxCode.message, REFERENT_PUBLIC_TEXT.fileRejected.identificativi);
  for (const m of [health.message, disc.message, taxCode.message]) assert.doesNotMatch(String(m), /nomi|email|telefon/i);
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

test("richiesta di caricamento: estensione e dimensione (la dichiarazione non serve più)", () => {
  assert.equal(referentUploadCheck({ fileName: "a.csv", size: 10, declaration: true, mode: "server" }).ok, true);
  assert.equal(referentUploadCheck({ fileName: "a.csv", size: 10, declaration: false, mode: "server" }).ok, true, "(rilascio 5.1) la dichiarazione non serve più");
  assert.equal(referentUploadCheck({ fileName: "a.csv", size: 10, mode: "server" }).ok, true);
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
