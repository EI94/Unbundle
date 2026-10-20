import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeSubmission,
  findSensitiveKinds,
  hasHealthTerms,
  hasProperNameHint,
  ibanChecksumOk,
  luhnOk,
  sensitiveContentError,
  SUBMISSION_TEXT_FIELDS,
  submissionTexts,
  taxCodeCheckChar,
  type SensitiveKind,
} from "./sensitive-content.ts";
import { connectorErrorResult } from "./contract.ts";
import { exampleSubmission } from "./contract.fixtures.ts";

// Contenuti sensibili (prompt WP3). Tutti i valori sono sintetici: codici fiscali,
// IBAN e carte d'esempio pubblici o calcolati, numeri di telefono inventati.

const kinds = (text: string, allowedEmails: string[] = []) => findSensitiveKinds(text, { allowedEmails });

test("codice fiscale: forma normale, minuscole, omocodia con il controllo giusto", () => {
  assert.equal(taxCodeCheckChar("RSSMRA85T10A562"), "S");
  assert.equal(taxCodeCheckChar("RSSMRA85T10A56N"), "H"); // omocodia sull'ultima cifra del comune
  for (const text of [
    "Il codice è RSSMRA85T10A562S.",
    "cf: rssmra85t10a562s",
    "RSSMRA85T10A56NH",
    "RSSMRA85T10A562X", // refuso nel controllo, forma normale: si blocca lo stesso
  ]) {
    assert.deepEqual(kinds(text), ["codice_fiscale"], text);
  }
});

test("codice fiscale: niente falsi positivi su parole e sigle di 16 caratteri", () => {
  for (const text of ["RSSMRA85T10A56NX", "PRECIPITEVOLISSI", "ABCDEFGHIJKLMNOP", "XXRSSMRA85T10A562S", "RSSMRA85T10A562SX"]) {
    assert.deepEqual(kinds(text), [], text);
  }
});

test("IBAN: compatto, a gruppi di quattro, in mezzo al testo, con mod-97", () => {
  assert.equal(ibanChecksumOk("IT60X0542811101000000123456"), true);
  assert.equal(ibanChecksumOk("IT61X0542811101000000123456"), false);
  for (const text of [
    "IT60X0542811101000000123456",
    "IBAN: IT60 X054 2811 1010 0000 0123 456 per il rimborso",
    "it60x0542811101000000123456",
    "DE89 3704 0044 0532 0130 00",
    "GB82 WEST 1234 5698 7654 32",
  ]) {
    assert.deepEqual(kinds(text), ["iban"], text);
  }
  for (const text of ["IT61X0542811101000000123456", "IT60 X054 2811", "QQ60X0542811101000000123456"]) {
    assert.deepEqual(kinds(text), [], text);
  }
});

test("carte: 13-19 cifre con Luhn, contigue o a gruppi", () => {
  assert.equal(luhnOk("4111111111111111"), true);
  assert.equal(luhnOk("4111111111111112"), false);
  for (const text of ["4111111111111111", "carta 4111 1111 1111 1111", "5500-0000-0000-0004", "3782 822463 10005", "4222222222222"]) {
    assert.deepEqual(kinds(text), ["carta"], text);
  }
  for (const text of ["4111 1111 1111 1112", "0000 0000 0000 0000", "1234 5678 9012", "41111 11111 11111 1"]) {
    assert.deepEqual(kinds(text), [], text);
  }
});

test("carte: bloccate anche se seguono scadenza, codice di sicurezza o altre cifre", () => {
  for (const text of [
    "carta 4111111111111111 12/27",
    "carta 4111 1111 1111 1111 12/27",
    "4111 1111 1111 1111 1/27",
    "carta 4111 1111 1111 1111 123",
    "carta 4111111111111111 123",
    "carta 4111-1111-1111-1111 12",
    "carta 4111 1111 1111 1111 2027",
    "5500-0000-0000-0004 scad. 12/27",
    "n. 2 4111 1111 1111 1111",
  ]) {
    assert.deepEqual(kinds(text), ["carta"], text);
  }
  // La carta si toglie dal testo: il telefono che segue si vede lo stesso.
  assert.deepEqual(kinds("4111 1111 1111 1111 347 1234567"), ["carta", "telefono"]);
  for (const text of ["anni 2023 2024 2025 2026", "4111 1111 1111 1111abc", "1234 5678 9012 3456 7890"]) {
    assert.deepEqual(kinds(text), [], text);
  }
});

test("telefoni: +39 e 0039, cellulari che iniziano per 3, fissi con separatore, altri prefissi internazionali", () => {
  for (const text of [
    "+39 347 123 4567",
    "+393471234567",
    "0039 02 1234 5678",
    "chiamami al 347 1234567",
    "3471234567",
    "347-123-4567",
    "347.123.4567",
    "02 1234 5678",
    "0331-123456",
    "(02) 12345678",
    "06/12345678",
    "+41 79 123 45 67",
  ]) {
    assert.deepEqual(kinds(text), ["telefono"], text);
  }
});

test("telefoni: cellulari e fissi italiani a coppie, con la barra o con le parentesi", () => {
  for (const text of [
    "chiamami al 347 123 45 67",
    "347-123-45-67",
    "347.123.45.67",
    "cell. 347 12 34 567",
    "347 1234 567",
    "cell 347/1234567",
    "(347) 1234567",
    "chiamare il 347 1234567 2 volte",
    "tel. 06 12 34 56 78",
    "06-12-34-56-78",
    "02 12 34 56 78",
    "02 123 45 67",
    "0331 12 34 56",
    "02.1234.5678",
    "(0331) 123456",
    "06 1234567",
    "(2026) 0331 123456",
  ]) {
    assert.deepEqual(kinds(text), ["telefono"], text);
  }
});

test("nessun falso positivo sui numeri della rubrica, importi, date, orari e codici", () => {
  for (const text of [
    "20 min x 220",
    "220 volte l'anno",
    "20 min x 220 x 6 persone = 440 ore/anno -> 3",
    "ore annue <50, 50-200, 200-1.000, 1.000-3.000, >3.000",
    "euro annui <2.000, 2.000-20.000, >500.000",
    "frequenze 220, 50, 12, 4, 1 e tetto 100 persone",
    "350.000 €",
    "350 000 000",
    "347.123.456 €",
    "330 000 000",
    "tra 10.000 e 10.001 euro",
    "il 03/11/2026 e poi a 03/2026",
    "dalle 08-12 e 14-18",
    "XX-0012 e XX-10013, poi XX-0012 2026",
    "versione 2026-11.1, T1 2027",
    "+20% di richieste e +220 volte",
    "1234 5678",
    "fattura n. 2026/000123",
    "fattura n. 0012/2026",
    "DDT 0007/2026",
    "prot. 0045/2026 del registro",
    "fattura n. 0123/2026 e 0123-2026",
    "01 10 2026",
    "dal 01.10.2026 al 31.12.2026",
    "31 10 2026",
    "320 ore, 340 ore",
    "350.000.000,50 €",
    "dalle 08.30-12.30 e 14.00-18.00",
    "valori 32000 45000",
    "P.IVA 01234567890",
    "CAP 00187",
  ]) {
    assert.deepEqual(kinds(text), [], text);
  }
});

test("email: bloccate quelle diverse da chi propone, senza distinguere maiuscole", () => {
  assert.deepEqual(kinds("scrivere a collega@esempio.test"), ["email"]);
  assert.deepEqual(kinds("scrivere a Proponente@Esempio.test", ["proponente@esempio.test"]), []);
  assert.deepEqual(kinds("a proponente@esempio.test e a altro@esempio.test", ["proponente@esempio.test"]), ["email"]);
  assert.deepEqual(kinds("la chiocciola @ da sola, o nome@dominio"), []);
});

test("più tipi nello stesso testo, ognuno una volta", () => {
  const found = kinds("cf RSSMRA85T10A562S, tel 347 1234567, IBAN IT60X0542811101000000123456, x@y.test, 3471234568");
  assert.deepEqual([...found].sort(), ["codice_fiscale", "email", "iban", "telefono"] as SensitiveKind[]);
});

test("avviso sanitario: parole e locuzioni, con accenti e maiuscole; non su parole simili", () => {
  for (const text of [
    "Serve la visita medica annuale",
    "Certificato Medico allegato",
    "controllo dell'idoneità medica",
    "giorni di malattia",
    "diagnosi e terapia",
    "elenco dei farmaci",
    "dopo il ricovero",
    "pratiche di invalidità",
    "comunicazione di gravidanza",
  ]) {
    assert.equal(hasHealthTerms(text), true, text);
  }
  for (const text of ["rimedio rapido ai guasti", "farmacia aziendale? no: fornitore", "terapeutico", "visita al cliente"]) {
    assert.equal(hasHealthTerms(text), false, text);
  }
});

test("avviso sanitario: «disabilità» con l'accento, non il verbo «disabilita»", () => {
  for (const text of ["persona con disabilità", "DISABILITÀ certificata", "disabilita\u0300 (forma scomposta)", "una disabilita' grave"]) {
    assert.equal(hasHealthTerms(text), true, text);
  }
  for (const text of [
    "il sistema disabilita l'utente scaduto",
    "l'assistente disabilita l'invio se il controllo fallisce",
    "Disabilita il pulsante",
    "disabilitato",
  ]) {
    assert.equal(hasHealthTerms(text), false, text);
  }
});

test("avviso sui nomi: titolo o ruolo seguito da una parola con l'iniziale maiuscola", () => {
  for (const text of ["ho parlato con il sig. Rossi", "Il comandante Verdi decide", "la dott.ssa Bianchi", "ing. Neri", "per il cliente Esposito", "Collega Ferrari"]) {
    assert.equal(hasProperNameHint(text), true, text);
  }
  for (const text of ["il cliente chiede un preventivo", "il comandante decide", "CAP 20100", "sig. rossi", "cliente IL", "vedi cap. 3"]) {
    assert.equal(hasProperNameHint(text), false, text);
  }
});

test("segnalazione: si analizzano tutti i campi di testo del contratto, anche i meno ovvi", () => {
  assert.equal(SUBMISSION_TEXT_FIELDS.length, 15);
  const base = exampleSubmission();
  assert.deepEqual(analyzeSubmission(base), { blocked: [], warnings: [] });
  const phone = "347 1234567";
  const payload = exampleSubmission({
    toolsOther: "Gestionale",
    sustainabilityImpact: "Meno carta stampata.",
    promptSnippet: `Rispondi e richiama il ${phone}`,
    sourceConversation: "Chat con RSSMRA85T10A562S",
    proposerEstimate: {
      ...base.proposerEstimate,
      effort: { score: 2, reasoning: `Serve l'accesso di altro@esempio.test` },
      impactFlag: { value: "giallo", reasoning: "Pagamento su IT60X0542811101000000123456." },
    },
    submittedBy: { name: "Persona 4111 1111 1111 1111", email: "proponente@esempio.test" },
    dataRequirements: "Export mensile; per dubbi scrivere a proponente@esempio.test.",
  });
  assert.equal(submissionTexts(payload).length, 15);
  const out = analyzeSubmission(payload);
  assert.deepEqual(out.blocked, [
    { field: "promptSnippet", kinds: ["telefono"] },
    { field: "sourceConversation", kinds: ["codice_fiscale"] },
    { field: "proposerEstimate.effort.reasoning", kinds: ["email"] },
    { field: "proposerEstimate.impactFlag.reasoning", kinds: ["iban"] },
    { field: "submittedBy.name", kinds: ["carta"] },
  ]);
});

test("segnalazione: avvisi sanitari e sui nomi con i campi, mai sul nome di chi propone", () => {
  const out = analyzeSubmission(
    exampleSubmission({
      problem: "Oggi la visita medica annuale si prenota a mano.",
      humanInTheLoop: "Il comandante Verdi approva ogni proposta.",
      submittedBy: { name: "Dott. Mario Bianchi" },
    })
  );
  assert.deepEqual(out.blocked, []);
  assert.deepEqual(
    out.warnings.map((w) => [w.code, w.fields]),
    [
      ["health_terms", ["problem"]],
      ["proper_names", ["humanInTheLoop"]],
    ]
  );
  for (const w of out.warnings) {
    assert.doesNotMatch(w.message, /Verdi|visita/);
  }
});

test("segnalazione: nel titolo, che vede tutta l'organizzazione, nessuna email, nemmeno quella di chi propone", () => {
  const submittedBy = { name: "Persona", email: "proponente@esempio.test" };
  const out = analyzeSubmission({
    title: "Proposta di Proponente@esempio.test",
    problem: "Per dubbi scrivere a proponente@esempio.test.",
    submittedBy,
  });
  assert.deepEqual(out.blocked, [{ field: "title", kinds: ["email"] }]);
  assert.deepEqual(sensitiveContentError(out.blocked).fieldErrors, {
    title: "Contiene un indirizzo email (questo campo lo vede tutta l'organizzazione): riscrivi il campo in modo generico.",
  });
});

test("sensitive_content: un messaggio per campo con i tipi di dato, mai i valori", () => {
  const error = sensitiveContentError([
    { field: "problem", kinds: ["telefono"] },
    { field: "guardrails", kinds: ["codice_fiscale", "iban", "email"] },
  ]);
  assert.equal(error.error, "sensitive_content");
  assert.deepEqual(error.fieldErrors, {
    problem: "Contiene un numero di telefono: riscrivi il campo in modo generico.",
    guardrails: "Contiene un codice fiscale, un IBAN e un indirizzo email di un'altra persona: riscrivi il campo in modo generico.",
  });
  const result = connectorErrorResult(error);
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error, "sensitive_content");
});
