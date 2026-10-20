import test from "node:test";
import assert from "node:assert/strict";
import {
  checkTables,
  classifyHeader,
  compileForbiddenColumns,
  findHealthTerms,
  forbiddenMatches,
  isValidCodiceFiscale,
  isValidIban,
  personalValueKind,
  sensitiveColumns,
  textTokens,
} from "./header-check.ts";

const categories = (header: string) => classifyHeader(header).map((m) => m.category);
const terms = (header: string) => classifyHeader(header).map((m) => m.term);

// Synthetic identifiers built for the tests: an invented fiscal code with a valid
// check character and the IBAN example published in the ISO 13616 documentation.
const FAKE_CF = "RSSMRA80A01H501U";
const SAMPLE_IBAN = "IT60X0542811101000000123456";

test("headers are split into accent-free lowercase tokens", () => {
  assert.deepEqual(textTokens("Data di Nascita"), ["data", "di", "nascita"]);
  assert.deepEqual(textTokens("dataNascita"), ["data", "nascita"]);
  assert.deepEqual(textTokens("IDONEITÀ_MEDICA"), ["idoneita", "medica"]);
  assert.deepEqual(textTokens("E-mail referente"), ["email", "referente"]);
  assert.deepEqual(textTokens("PDFDocument2026"), ["pdf", "document", "2026"]);
  assert.deepEqual(textTokens("nome1"), ["nome", "1"]);
  assert.deepEqual(textTokens(""), []);
});

test("health headers are always recognised", () => {
  for (const header of [
    "visita medica",
    "Visita_Medica",
    "data visita medica",
    "visitaMedica",
    "Idoneità medica",
    "certificato medico",
    "esito visita di idoneità",
    "giorni di malattia",
    "diagnosi",
    "patologie note",
    "terapia in corso",
    "farmaci",
    "invalidità",
    "invalido civile",
    "Invalido",
    "disabilità",
    "allergie",
    "idoneità psicofisica",
    "ricovero ospedaliero",
    "gravidanza",
    "infortuni",
    "medical certificate",
    "sick leave",
    // Words the answer scanner blocks: the file check never lets them through.
    "Gruppo sanguigno",
    "Giorni malato",
    "Esito tampone Covid",
    "stato di salute",
    "condizioni di salute",
    "ricovero",
    "cartella clinica",
    "supporto terapeutico",
  ]) {
    assert.ok(categories(header).includes("sanitario"), header);
  }
  assert.ok(terms("Gruppo sanguigno").includes("gruppo sanguigno"));
  assert.ok(terms("Esito tampone Covid").includes("covid"));
  assert.ok(terms("visita medica").includes("visita medica"));
});

test("token rules avoid the obvious false positives", () => {
  for (const header of [
    "nome_aeroporto",
    "nome base",
    "Nome file",
    "ETA",
    "eta_arrivo",
    "cf_mensile",
    "data invalida",
    "valore invalid",
    "account disabilitato",
    "indirizzo IP",
    "IP address",
    "media mensile",
    "codice_tratta",
    "aeroporto di origine",
    "nazionalità aeromobile",
    "ricovero aeromobile",
    "ricovero in hangar",
    "salute e sicurezza",
    "accordo",
  ]) {
    assert.deepEqual(classifyHeader(header), [], header);
  }
});

test("personal headers are recognised, «nome» only alone or about a person", () => {
  for (const [header, term] of [
    ["Nome", "nome"],
    ["nome pilota", "nome"],
    ["nome del passeggero", "nome"],
    ["Nome completo", "nome"],
    ["first name", "nome"],
    ["Cognome", "cognome"],
    ["Nominativo", "nominativo"],
    ["numero passaporto", "passaporto"],
    ["data di nascita", "data di nascita"],
    ["DOB", "data di nascita"],
    ["Codice fiscale", "codice fiscale"],
    ["CF", "codice fiscale"],
    ["cf pilota", "codice fiscale"],
    ["E-mail", "email"],
    ["telefono", "telefono"],
    ["cellulare referente", "telefono"],
    ["indirizzo di residenza", "indirizzo"],
    ["IBAN", "iban"],
    ["sesso", "sesso"],
  ] as const) {
    const found = classifyHeader(header);
    assert.ok(
      found.some((m) => m.category === "personale" && m.term === term),
      `${header} → ${JSON.stringify(found)}`,
    );
  }
});

test("special categories are recognised as headers but not in prose", () => {
  for (const header of ["religione", "origine etnica", "orientamento sessuale", "iscritto al sindacato", "dati biometrici", "trade union member"]) {
    assert.ok(categories(header).includes("particolare"), header);
  }
  assert.deepEqual(findHealthTerms("Le regole di riposo vengono dall'accordo sindacale vigente."), []);
});

test("health terms in free text give labels and counts, never the text", () => {
  const found = findHealthTerms("Il turno salta per una visita medica. Dopo la visita medica il pilota rientra.");
  assert.deepEqual(
    found.find((f) => f.term === "visita medica"),
    { term: "visita medica", count: 2 },
  );
  assert.ok(found.every((f) => !f.term.includes("pilota") && !f.term.includes("turno")));
  assert.deepEqual(findHealthTerms("Il pilota è invalido."), [{ term: "invalidità", count: 1 }]);
  assert.deepEqual(findHealthTerms("Il valore inserito è invalido."), []);
  assert.deepEqual(findHealthTerms("Margine per tratta e costo orario."), []);
  // The answer lexicon is applied too, with labels instead of the words found.
  assert.deepEqual(findHealthTerms("Il collega è malato da tre giorni."), [{ term: "malattia", count: 1 }]);
  assert.deepEqual(findHealthTerms("Esito del tampone covid negativo."), [{ term: "covid", count: 1 }]);
  assert.deepEqual(findHealthTerms("Serve il gruppo sanguigno."), [{ term: "gruppo sanguigno", count: 1 }]);
  assert.deepEqual(findHealthTerms("Il velivolo resta in ricovero nell'hangar."), []);
  // A term on the 1 MB chunk border is still found.
  const long = `${"a ".repeat(500_000 - 3)}visita medica ${"b ".repeat(10)}`;
  assert.ok(findHealthTerms(long).some((f) => f.term === "visita medica"));
});

test("forbidden columns from the item and the template", () => {
  const compiled = compileForbiddenColumns(["sanitari", "personali", "data_nascita", "passaport*", "nome", "constructor", "", "  "]);
  assert.deepEqual([...compiled.categories].sort(), ["personale", "sanitario"]);
  assert.deepEqual(
    compiled.patterns.map((p) => p.label),
    ["data_nascita", "passaport*", "nome", "constructor"],
  );
  assert.deepEqual(forbiddenMatches("Data di nascita", compiled), ["data_nascita"]);
  assert.deepEqual(forbiddenMatches("numero passaporto", compiled), ["passaport*"]);
  assert.deepEqual(forbiddenMatches("nome_aeroporto", compiled), []);
  assert.deepEqual(forbiddenMatches("nome pilota", compiled), ["nome"]);
  assert.deepEqual(forbiddenMatches("nascita data", compiled), []);
  assert.equal(compileForbiddenColumns(null).patterns.length, 0);
});

test("fiscal codes and IBANs are recognised only with a valid check", () => {
  assert.equal(isValidCodiceFiscale(FAKE_CF), true);
  assert.equal(isValidCodiceFiscale(FAKE_CF.toLowerCase()), true);
  assert.equal(isValidCodiceFiscale(`${FAKE_CF.slice(0, 15)}A`), false);
  assert.equal(isValidCodiceFiscale("ABCDEF12G34H567"), false);
  assert.equal(isValidIban(SAMPLE_IBAN), true);
  assert.equal(isValidIban("IT60 X054 2811 1010 0000 0123 456"), true);
  assert.equal(isValidIban("IT61X0542811101000000123456"), false);
});

test("personal values in cells", () => {
  assert.equal(personalValueKind("scrivi a nome.cognome@esempio.it"), "email");
  assert.equal(personalValueKind(`CF: ${FAKE_CF}`), "codice_fiscale");
  assert.equal(personalValueKind(SAMPLE_IBAN), "iban");
  assert.equal(personalValueKind(`${SAMPLE_IBAN} pagato`), "iban");
  assert.equal(personalValueKind("IT60 X054 2811 1010 0000 0123 456"), "iban");
  assert.equal(personalValueKind("+39 06 1234 5678"), "telefono");
  assert.equal(personalValueKind("0039 347 123 4567"), "telefono");
  assert.equal(personalValueKind("347 1234567"), "telefono");
  assert.equal(personalValueKind("06 12345678"), "telefono");
  for (const value of ["2026-07-01", "01/07/2026", "1.200.000", "12:30", "00123456", "Tipo A", "AAA-BBB", "ABCDEFGHIJKLMNOP", "IT60X0542811101000000123457"]) {
    assert.equal(personalValueKind(value), null, value);
  }
});

test("tables: health always blocks, personal blocks before A.8 or in the standard zone", () => {
  const rows = [
    ["Prospetto turni (dati sintetici)"],
    [],
    ["codice_equipaggio", "nome", "data visita medica", "base"],
    ["C-001", "Inventato", "2026-01-01", "AAA"],
  ];
  const before = checkTables([{ name: "S", rows }], { personalAllowed: false });
  assert.deepEqual(
    before.blocking.map((f) => [f.category, f.term, f.column, f.source]).sort(),
    [
      ["personale", "nome", 1, "intestazione"],
      ["sanitario", "medico", 2, "intestazione"],
      ["sanitario", "visita medica", 2, "intestazione"],
    ],
  );
  const after = checkTables([{ name: "S", rows }], { personalAllowed: true });
  assert.deepEqual(
    after.blocking.map((f) => f.category),
    ["sanitario", "sanitario"],
  );
  assert.equal(after.findings.length, 3);
  // A forbidden «personali» category blocks personal columns even after A.8.
  const minimised = checkTables([{ name: "S", rows }], { personalAllowed: true, forbiddenColumns: ["personali"] });
  assert.ok(minimised.blocking.some((f) => f.category === "personale"));
});

test("an item that forbids health columns rejects «idoneità medica»", () => {
  const rows = [["codice_pilota", "tipo_abilitato", "idoneità medica"], ["P-01", "Tipo A", "sì"]];
  const result = checkTables([{ rows }], { personalAllowed: true, forbiddenColumns: ["sanitari"] });
  assert.ok(result.blocking.some((f) => f.category === "sanitario" && f.column === 2));
});

test("value checks look at the first 200 rows; phones need half the column", () => {
  const header = ["codice", "contatto", "valore"];
  const emails = [header, ...Array.from({ length: 50 }, (_, i) => [`C${i}`, i === 7 ? "x@esempio.it" : "", String(i)])];
  const found = checkTables([{ rows: emails }], { personalAllowed: false });
  assert.deepEqual(
    found.blocking.map((f) => [f.term, f.column, f.source, f.count]),
    [["email", 1, "valori", 1]],
  );
  const late = [header, ...Array.from({ length: 300 }, (_, i) => [`C${i}`, i === 250 ? "x@esempio.it" : "", String(i)])];
  assert.deepEqual(checkTables([{ rows: late }], { personalAllowed: false }).findings, []);
  const fewPhones = [["codice"], ...Array.from({ length: 10 }, (_, i) => [i < 3 ? "347 1234567" : `ID-${i}`])];
  assert.deepEqual(checkTables([{ rows: fewPhones }], { personalAllowed: false }).findings, []);
  const phones = [["recapito"], ...Array.from({ length: 10 }, (_, i) => [i < 6 ? "347 1234567" : `ID-${i}`])];
  assert.deepEqual(
    checkTables([{ rows: phones }], { personalAllowed: false }).findings.map((f) => [f.term, f.count]),
    [["telefono", 6]],
  );
});

test("sensitive columns for masking", () => {
  assert.deepEqual([...sensitiveColumns(["codice", "Cognome", "nome_aeroporto", "visita medica", "religione", "note"], ["note"])].sort(), [1, 3, 4, 5]);
});
