import test from "node:test";
import assert from "node:assert/strict";
import { findForbiddenIn } from "./copy-guard.ts";
import {
  answerValueView,
  formatBytes,
  formatCountIt,
  formatDateIt,
  formatDayIt,
  formatEuro,
  formatLongDayIt,
  formatRelativeIt,
  provenanceText,
  specText,
  stripFactCodes,
  plainGateWord,
  plainPriorityWords,
  stripLegalRefs,
} from "./format.ts";

test("value visibility: health never, personal never here, otherwise by value_visibility", () => {
  const base = { encrypted: false, erased: false, valueVisibility: "owner_e_ls" as const };
  assert.deepEqual(answerValueView({ ...base, value: { value: 12, unit: "h" }, privacyClass: "riservato_azienda", roles: ["ls_analista"] }), { kind: "value", text: "12 h" });
  assert.equal(answerValueView({ ...base, value: { value: 12, unit: "h" }, privacyClass: "riservato_azienda", roles: ["osservatore"] }).kind, "hidden");
  assert.equal(answerValueView({ ...base, value: "testo", privacyClass: "nessuna", valueVisibility: "tutti_i_ruoli_del_caso", roles: ["osservatore"] }).kind, "value");
  assert.equal(answerValueView({ ...base, value: "testo", privacyClass: "riservato_azienda", valueVisibility: "solo_ls", roles: ["owner_cliente"] }).kind, "hidden");
  const personal = answerValueView({ ...base, value: null, encrypted: true, privacyClass: "personale", roles: ["ls_lead"] });
  assert.equal(personal.kind, "hidden");
  assert.equal(personal.kind === "hidden" ? personal.reason : null, "personale");
  const health = answerValueView({ ...base, value: "x", privacyClass: "escluso_sanitario", roles: ["ls_lead"] });
  assert.equal(health.kind === "hidden" ? health.reason : null, "sanitario");
  const erased = answerValueView({ ...base, value: null, erased: true, privacyClass: "riservato_azienda", roles: ["ls_lead"] });
  assert.equal(erased.kind === "hidden" ? erased.reason : null, "cancellato");
  assert.deepEqual(answerValueView({ ...base, value: null, privacyClass: "nessuna", roles: ["ls_lead"] }), { kind: "none" });
});

test("provenance, dates, money and sizes in Italian", () => {
  assert.equal(provenanceText("dichiarato_in_call", "F012"), "Dichiarato in call · F012");
  assert.equal(provenanceText("referente", null), "Referente");
  assert.equal(formatDateIt("2026-10-07"), "7 ott 2026");
  assert.equal(formatDateIt(null), null);
  assert.equal(formatDateIt("non una data"), null);
  assert.match(formatEuro(1200) ?? "", /1\.200\s€/);
  assert.equal(formatEuro(null), null);
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2 KB");
  assert.equal(formatBytes(3.5 * 1024 * 1024), "3,5 MB");
});

test("spec text", () => {
  assert.equal(specText({ unit: "minuti" }, "unita", "unit"), "minuti");
  assert.equal(specText({ dimensioni: ["canale", "priorita"] }, "dimensioni"), "canale, priorita");
  assert.equal(specText({ obbligatorio: true }, "obbligatorio"), "sì");
  assert.equal(specText({ x: "  " }, "x"), null);
});

test("days in rows and panels, relative under 7 days, Rome calendar", () => {
  const now = new Date("2026-10-14T10:00:00Z"); // 12:00 a Roma
  assert.equal(formatDayIt("2026-10-23"), "23 ott");
  assert.equal(formatDayIt("2026-10-23", { now }), "23 ott");
  assert.equal(formatDayIt("2025-12-31", { now }), "31 dic 2025");
  assert.equal(formatDayIt(null), null);
  assert.equal(formatLongDayIt("2026-10-23"), "23 ottobre 2026");
  assert.equal(formatLongDayIt("non una data"), null);
  assert.equal(formatRelativeIt(new Date("2026-10-14T09:59:40Z"), now), "adesso");
  assert.equal(formatRelativeIt(new Date("2026-10-14T09:59:00Z"), now), "1 minuto fa");
  assert.equal(formatRelativeIt(new Date("2026-10-14T09:15:00Z"), now), "45 minuti fa");
  assert.equal(formatRelativeIt(new Date("2026-10-14T09:00:00Z"), now), "1 ora fa");
  assert.equal(formatRelativeIt(new Date("2026-10-13T22:30:00Z"), now), "11 ore fa", "00:30 in Rome is still today");
  assert.equal(formatRelativeIt(new Date("2026-10-13T21:30:00Z"), now), "ieri", "23:30 in Rome is yesterday");
  assert.equal(formatRelativeIt(new Date("2026-10-11T10:00:00Z"), now), "3 giorni fa");
  assert.equal(formatRelativeIt(new Date("2026-10-08T10:00:00Z"), now), "6 giorni fa");
  assert.equal(formatRelativeIt(new Date("2026-10-07T10:00:00Z"), now), "7 ott");
  assert.equal(formatRelativeIt(new Date("2026-10-20T10:00:00Z"), now), "20 ott", "a future date is a day");
  assert.equal(formatRelativeIt(null, now), null);
});

test("one number formatter: thousands separator from four digits", () => {
  assert.equal(formatCountIt(2812), "2.812");
  assert.equal(formatCountIt(245), "245");
  assert.equal(formatCountIt(12.6), "13");
  assert.equal(formatCountIt(Number.NaN), "0");
});

test("fact codes leave the texts for the client", () => {
  assert.equal(stripFactCodes("Dichiarato in call · F010"), "Dichiarato in call");
  assert.equal(stripFactCodes("dichiarato in call · fonte F012"), "dichiarato in call");
  assert.equal(stripFactCodes("Il volume è stabile (F012, F013)."), "Il volume è stabile.");
  assert.equal(stripFactCodes("Valore da contratto (fonte F001)"), "Valore da contratto");
  assert.equal(stripFactCodes("Vedi F004 e F005 per i dettagli"), "Vedi per i dettagli");
  assert.equal(stripFactCodes("Fase 1 entro il 23 ott, volo F1"), "Fase 1 entro il 23 ott, volo F1", "only three-digit fact codes");
  assert.equal(stripFactCodes("Nessun codice qui."), "Nessun codice qui.");
});

test("contract articles leave the texts for the client", () => {
  assert.equal(stripLegalRefs("Costi da autorizzare (art. 8.4)"), "Costi da autorizzare");
  assert.equal(stripLegalRefs("Titolo sui dati (art. 15.2): sì"), "Titolo sui dati: sì");
  assert.equal(stripLegalRefs("Serve l'approvazione dei costi ai sensi dell'art. 8.4."), "Serve l'approvazione dei costi.");
  assert.equal(stripLegalRefs("Decisione dell'AI Board (artt. 7.2 e 8.4 del contratto)"), "Decisione dell'AI Board");
  assert.equal(stripLegalRefs("Scheda A.8 firmata"), "Scheda privacy firmata");
  assert.equal(stripLegalRefs("In attesa della scheda A.8"), "In attesa della scheda privacy");
  assert.equal(stripLegalRefs("Dati personali (A.8)"), "Dati personali");
  assert.equal(stripLegalRefs("Fase 1.2, articolo di prova"), "Fase 1.2, articolo di prova");
});

test("priorities in English become the words of §2.6 for the client", () => {
  assert.equal(plainPriorityWords("Tutte le voci «must» del modello dati a posto"), "Tutte le voci indispensabili del modello dati a posto");
  assert.equal(plainPriorityWords("Le domande should restano aperte"), "Le domande utili restano aperte");
  assert.equal(plainPriorityWords("La voce è must"), "La voce è indispensabile");
  assert.equal(plainPriorityWords("Priorità: could"), "Priorità: facoltativa");
  assert.equal(plainPriorityWords("MUST prima di tutto"), "Indispensabile prima di tutto", "the capital stays");
  for (const plain of ["Il mustang resta", "Nessuna priorità qui", "Il musta di Sardegna"]) assert.equal(plainPriorityWords(plain), plain);
  assert.deepEqual(findForbiddenIn([plainPriorityWords("voci must, should e could")], "cliente"), []);
});

test("a priority agrees in gender and number with what it refers to", () => {
  // Masculine nouns of the dossier: «facoltativo», not «facoltativa».
  assert.equal(plainPriorityWords("I campi could restano vuoti"), "I campi facoltativi restano vuoti");
  assert.equal(plainPriorityWords("Il dato could"), "Il dato facoltativo");
  assert.equal(plainPriorityWords("Il campo è could"), "Il campo è facoltativo", "after a verb, the nearest noun gives the gender");
  assert.equal(plainPriorityWords("I KPI could e il KPI should"), "I KPI facoltativi e il KPI utile", "an invariant noun takes the number of its article");
  assert.equal(plainPriorityWords("Gli scenari could"), "Gli scenari facoltativi", "an unknown noun takes its article's gender");
  assert.equal(plainPriorityWords("Le funzioni could"), "Le funzioni facoltative");
  // Coordinated priorities take the agreement of the first one.
  assert.equal(plainPriorityWords("Le domande must e should restano aperte"), "Le domande indispensabili e utili restano aperte");
  assert.equal(plainPriorityWords("voci must, should e could"), "voci indispensabili, utili e facoltative");
  assert.equal(plainPriorityWords("i dati must o could"), "i dati indispensabili o facoltativi");
  // After a plural verb plural, after a preposition singular.
  assert.equal(plainPriorityWords("Tutte le domande sono must"), "Tutte le domande sono indispensabili");
  assert.equal(plainPriorityWords("I campi restano could"), "I campi restano facoltativi");
  assert.equal(plainPriorityWords("Domande di must"), "Domande di indispensabile");
  assert.equal(plainPriorityWords("Segnata come could"), "Segnata come facoltativa", "with no noun in sight, «domanda»'s feminine");
});

test("«gate» in a schema text becomes «controllo» for the client, articles unchanged", () => {
  assert.equal(plainGateWord("La proposta va al gate di fattibilità."), "La proposta va al controllo di fattibilità.");
  assert.equal(plainGateWord("Il gate si apre dopo le firme; 8 proposte respinte dal gate."), "Il controllo si apre dopo le firme; 8 proposte respinte dal controllo.");
  assert.equal(plainGateWord("Gate di fattibilità: due gates su tre superati"), "Controllo di fattibilità: due controlli su tre superati");
  for (const plain of ["Il gateway resta", "Navigate tra le domande", "Nessun controllo qui"]) assert.equal(plainGateWord(plain), plain);
  assert.deepEqual(findForbiddenIn([plainGateWord("Il gate e i gate di fattibilità")], "cliente"), []);
});
