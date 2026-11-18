import test from "node:test";
import assert from "node:assert/strict";
import { CONTEXT_TEXT } from "./text.ts";
import { CONTEXT_EVENT_ACTIONS, CONTEXT_SECTIONS, PROPOSAL_ISSUES, READ_REASONS, READ_STATUSES, SOURCE_ORIGINS } from "./vocab.ts";

// I testi di «Contesto» (RILASCIO-9a-COSTRUZIONE.md §7.7): «use case» come nel resto della dashboard, nessuna chiave
// interna a schermo, singolare e plurale.

type Leaf = { path: string; value: string | ((...args: never[]) => unknown) };

function leaves(node: unknown, path: string, out: Leaf[] = []): Leaf[] {
  if (typeof node === "string" || typeof node === "function") out.push({ path, value: node as Leaf["value"] });
  else if (node && typeof node === "object") for (const [key, value] of Object.entries(node)) leaves(value, path ? `${path}.${key}` : key, out);
  return out;
}

const ALL = leaves(CONTEXT_TEXT, "");
/** Ogni testo che può arrivare a schermo: le stringhe e, per le funzioni, le loro risposte con valori di prova. */
function rendered(): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  for (const leaf of ALL) {
    if (typeof leaf.value === "string") {
      out.push({ path: leaf.path, text: leaf.value });
      continue;
    }
    const fn = leaf.value as (...args: unknown[]) => unknown;
    for (const args of [
      [1, 3, 5],
      [2, 3, 5],
      [0, 0, 0],
      [7, 9, 2],
      ["Alfa", "14 nov", "Call 14 nov"],
    ]) {
      const result = fn(...args);
      if (typeof result === "string") out.push({ path: `${leaf.path}(${args.join(", ")})`, text: result });
    }
  }
  return out;
}

test("ci sono tutti i gruppi, e i testi sono congelati", () => {
  assert.deepEqual(Object.keys(CONTEXT_TEXT), [
    "page", "sections", "brief", "live", "novelties", "fact", "writeFact", "nextSteps", "questions", "ask", "add", "read", "confirm", "notes", "documents", "consent", "granola", "errors",
    // (9b) La scheda e il dossier, «Cosa serve», «Da verificare», «Cerca una persona».
    "useCase", "needLink", "verify", "people",
  ]);
  assert.ok(ALL.length > 200, `${ALL.length} testi`);
  assert.ok(Object.isFrozen(CONTEXT_TEXT));
  for (const group of Object.values(CONTEXT_TEXT)) assert.ok(Object.isFrozen(group));
  assert.equal(CONTEXT_TEXT.page.title, "Contesto");
  assert.equal(CONTEXT_TEXT.page.addNotes, "Aggiungi appunti");
});

test("nessun «caso d'uso»: nella dashboard si dice «use case»; nessun testo vuoto", () => {
  for (const { path, text } of rendered()) {
    assert.ok(text.trim().length > 0, `${path} è vuoto`);
    assert.doesNotMatch(text, /cas[oi] d['’]uso/i, path);
    assert.doesNotMatch(text, /\buse cases\b/i, `${path}: «use case» non prende la s`);
  }
  assert.equal(CONTEXT_TEXT.fact.useCases, "Use case");
});

test("nessuna chiave interna a schermo: né i valori del database, né i codici degli esiti", () => {
  const internal = [
    ...READ_STATUSES,
    ...READ_REASONS,
    ...PROPOSAL_ISSUES,
    ...CONTEXT_EVENT_ACTIONS,
    "versione_superata", "permesso_mancante", "dati_non_validi", "area_spenta", "non_trovato", "solo_ricerca", "non_so", "da_confermare",
  ].filter((key) => key.includes("_"));
  assert.ok(internal.length > 20);
  for (const { path, text } of rendered()) {
    for (const key of internal) assert.equal(text.includes(key), false, `${path} contiene ${key}`);
    assert.doesNotMatch(text, /\b[a-z]+_[a-z_]+\b/, `${path}: una parola con il trattino basso`);
    assert.doesNotMatch(text, /\bnull\b|\bundefined\b|\bNaN\b|\[object/, path);
  }
});

test("ogni sezione, ogni origine e ogni stato di un appunto hanno la loro etichetta", () => {
  for (const section of CONTEXT_SECTIONS) assert.ok(CONTEXT_TEXT.sections[section].length > 0, section);
  assert.deepEqual(
    CONTEXT_SECTIONS.map((s) => CONTEXT_TEXT.sections[s]),
    ["Azienda", "Persone e ruoli", "Come lavorano", "Sistemi e dati", "Obiettivi e priorità", "Regole e vincoli", "Parole del cliente"],
  );
  for (const origin of SOURCE_ORIGINS) assert.ok(CONTEXT_TEXT.notes.origin[origin].length > 0, origin);
  for (const state of ["da_leggere", "in_lettura", "confermato", "letto", "non_letto"] as const) assert.ok(CONTEXT_TEXT.notes.state[state].length > 0, state);
  assert.equal(CONTEXT_TEXT.notes.state.da_confermare(4), "Da confermare (4)");
  for (const kind of ["fatto", "discovery", "appunti", "documento", "referente", "decisione"] as const) assert.ok(CONTEXT_TEXT.ask.kind[kind].length > 0, kind);
});

test("ogni funzione con un numero risponde al singolare e al plurale", () => {
  assert.equal(CONTEXT_TEXT.page.pending(1), "1 proposta da confermare");
  assert.equal(CONTEXT_TEXT.page.pending(12), "12 proposte da confermare");
  assert.equal(CONTEXT_TEXT.novelties.more(1), "e un'altra");
  assert.equal(CONTEXT_TEXT.novelties.more(3), "e altre 3");
  assert.equal(CONTEXT_TEXT.confirm.reconfirmed(1), "1 fatto riconfermato: si aggiorna la data");
  assert.equal(CONTEXT_TEXT.confirm.reconfirmed(6), "6 fatti riconfermati: si aggiorna la data");
  assert.equal(CONTEXT_TEXT.confirm.done(1), "1 proposta confermata.");
  assert.equal(CONTEXT_TEXT.confirm.done(12), "12 proposte confermate.");
  assert.equal(CONTEXT_TEXT.confirm.notReported(1), "1 passaggio non riportato");
  assert.equal(CONTEXT_TEXT.confirm.notReported(2), "2 passaggi non riportati");
  for (const why of ["persone", "sanitari", "altri_clienti", "clienti_del_cliente"] as const) {
    assert.notEqual(CONTEXT_TEXT.confirm.notReportedWhy[why](1), CONTEXT_TEXT.confirm.notReportedWhy[why](2), why);
  }
  assert.equal(`${CONTEXT_TEXT.confirm.notReported(2)}: ${CONTEXT_TEXT.confirm.notReportedWhy.persone(2)}`, "2 passaggi non riportati: parlavano di persone");
  assert.equal(CONTEXT_TEXT.granola.peopleKnown(1), "1 persona già nota a Unbundle");
  assert.equal(CONTEXT_TEXT.granola.peopleKnown(4), "4 persone già note a Unbundle");
  assert.equal(CONTEXT_TEXT.granola.imported(0), "Niente di nuovo da Granola.");
  assert.equal(CONTEXT_TEXT.granola.imported(1), "1 call nuova da Granola.");
  assert.equal(CONTEXT_TEXT.granola.imported(2), "2 call nuove da Granola.");
  assert.equal(CONTEXT_TEXT.granola.blocked(1), "1 call non è entrata: contiene dati sanitari.");
  assert.equal(CONTEXT_TEXT.granola.blocked(3), "3 call non sono entrate: contengono dati sanitari.");
  assert.equal(CONTEXT_TEXT.confirm.button(12), "Conferma (12)");
  assert.equal(CONTEXT_TEXT.confirm.fromMany(3), "Da 3 appunti");
  assert.equal(CONTEXT_TEXT.page.readingOf(1, 3), "Leggo gli appunti… 1 di 3");
});

test("le fonti e la storia di un fatto, come nella pagina", () => {
  assert.equal(CONTEXT_TEXT.fact.sourceCall("14 nov"), "Call 14 nov");
  assert.equal(CONTEXT_TEXT.fact.sourceDocument("14 nov"), "Documento 14 nov");
  assert.equal(CONTEXT_TEXT.fact.sourceManual, "Scritto a mano");
  assert.equal(CONTEXT_TEXT.fact.sourceDiscovery, "Intervista iniziale");
  assert.equal(CONTEXT_TEXT.fact.noSource, "senza fonte");
  assert.equal(CONTEXT_TEXT.fact.before("Il gestionale è SAP."), "Prima: Il gestionale è SAP.");
  assert.equal(CONTEXT_TEXT.confirm.before("X", "Discovery", "21 ott"), "Prima: X (Discovery, 21 ott)");
  assert.equal(CONTEXT_TEXT.confirm.now("Y", "Call 14 nov"), "Ora: Y (Call 14 nov)");
  assert.equal(CONTEXT_TEXT.add.blockedHealth("visita medica"), "Negli appunti ci sono dati sanitari («visita medica»). Toglili e riprova.");
  assert.equal(CONTEXT_TEXT.errors.tooLong(80), "Al massimo 80 caratteri.");
  assert.equal(CONTEXT_TEXT.confirm.tooMany(75), "Al massimo 75 proposte alla volta.");
});

test("l'avviso dell'ok è calmo: nessun allarme, nessuna parola che spaventa", () => {
  for (const text of Object.values(CONTEXT_TEXT.consent)) {
    const line = typeof text === "function" ? text("Alfa") : text;
    assert.doesNotMatch(line, /attenzione|pericolo|vietato|bloccat|errore grave|!/i, line);
  }
  assert.equal(CONTEXT_TEXT.consent.title, "Serve l'ok ai fornitori di AI");
});

// ─── (9b) «Contesto nel lavoro» (RILASCIO-9b-COSTRUZIONE.md §2, §4.2) ───

test("(9b) i testi dei gruppi nuovi sono quelli del piano, al singolare e al plurale", () => {
  const U = CONTEXT_TEXT.useCase;
  assert.equal(U.title, "Contesto");
  assert.equal(U.summaryFacts(1), "1 fatto sul cliente");
  assert.equal(U.summaryFacts(12), "12 fatti sul cliente");
  assert.equal(U.summaryNew(1), " · 1 novità");
  assert.equal(U.summaryNew(3), " · 3 novità");
  assert.equal(U.summaryCommitments(1), " · 1 impegno aperto");
  assert.equal(U.summaryCommitments(2), " · 2 impegni aperti");
  assert.equal(`${U.summaryFacts(12)}${U.summaryNew(3)}${U.summaryCommitments(1)}`, "12 fatti sul cliente · 3 novità · 1 impegno aperto");
  assert.equal(U.more(1), "e un altro nel contesto");
  assert.equal(U.more(12), "e altri 12 nel contesto");
  assert.deepEqual([U.novelties, U.known, U.commitments, U.questions, U.open], ["Novità", "Che cosa sappiamo", "Impegni aperti", "Domande aperte", "Apri il contesto"]);
  assert.equal(U.dossierDescription, "Quello che sappiamo del cliente e che tocca questo use case. Lo conferma Lateral Space.");
  assert.equal(U.empty, "Ancora niente nella memoria del cliente per questo use case.");
  assert.equal(U.packageDelta(1), "Il contesto è cambiato dopo l'ultimo pacchetto (1 novità).");
  assert.equal(U.packageDelta(3), "Il contesto è cambiato dopo l'ultimo pacchetto (3 novità).");

  const L = CONTEXT_TEXT.needLink;
  assert.equal(L.fromCall("14 nov", "Il gestionale è SAP Business One."), "Una call del 14 nov risponde: «Il gestionale è SAP Business One.»");
  assert.equal(L.fromDocument("14 nov", "Gli ordini arrivano via e-mail."), "Un documento del 14 nov risponde: «Gli ordini arrivano via e-mail.»");
  assert.deepEqual([L.close, L.dismiss, L.closed, L.dismissed], ["Chiudi con questo", "Non risponde", "Richiesta chiusa: è a posto.", "Va bene: la richiesta resta aperta."]);
  assert.equal(CONTEXT_TEXT.confirm.answersNeed("Esportazione delle fatture", "XX-0012"), "Risponde a «Cosa serve»: Esportazione delle fatture (XX-0012)");
  assert.equal(CONTEXT_TEXT.confirm.answersNeedLsOnly, "Solo un fatto «Per tutti» chiude una richiesta.");
  assert.equal(CONTEXT_TEXT.confirm.fromAnswers("XX-0012", "14 nov"), "Dalle risposte del referente per XX-0012, 14 nov");
  assert.equal(CONTEXT_TEXT.confirm.fromBuilding("XX-0012", "18 nov"), "Da chi costruisce XX-0012, 18 nov");

  const V = CONTEXT_TEXT.verify;
  assert.equal(V.row(1), "1 fatto da verificare");
  assert.equal(V.row(3), "3 fatti da verificare");
  assert.equal(V.button(4), "Ancora veri (4)");
  assert.equal(V.done(1), "Data aggiornata per 1 fatto.");
  assert.equal(V.done(5), "Data aggiornata per 5 fatti.");
  assert.deepEqual([V.title, V.back, V.lead, V.empty], ["Da verificare", "Contesto", "Questi fatti non sono stati riconfermati da più di 6 mesi. Sono ancora veri?", "Niente da verificare."]);
  assert.equal(V.none, "Scegli almeno un fatto.");
  assert.equal(V.tooMany(75), "Al massimo 75 fatti alla volta.");

  const P = CONTEXT_TEXT.people;
  assert.equal(P.link, "Cerca una persona");
  assert.equal(P.title, "Cerca una persona");
  assert.deepEqual(Object.values(P.groups), ["Appunti", "Fatti", "Citazioni, proposte, impegni e domande", "Mappa", "Documenti", "Regole di Granola", "Memoria della chat"]);
  assert.equal(P.erase("Persona Inventata"), "Togli «Persona Inventata» da tutto");
  assert.equal(P.eraseTitle("Persona Inventata"), "Togliere «Persona Inventata»?");
  assert.equal(P.erased(3, 7), "Fatto: 3 appunti cancellati, 7 testi corretti.");
  assert.equal(P.erased(1, 1), "Fatto: 1 appunto cancellato, 1 testo corretto.");
  assert.match(P.eraseBody, /Non si torna indietro\.$/);
  assert.match(P.eraseBody, /i nodi della Mappa con quel nome si tolgono/, "la conferma dice che cosa succede alla Mappa");
});

test("(9b) le fonti nuove: «Referente», «Costruzione», le risposte nel pannello della fonte", () => {
  assert.equal(CONTEXT_TEXT.fact.sourceAnswer("14 nov"), "Referente 14 nov");
  assert.equal(CONTEXT_TEXT.fact.sourceLearned("14 nov"), "Costruzione 14 nov");
  assert.equal(CONTEXT_TEXT.notes.origin.rispondi, "Referente");
  assert.equal(CONTEXT_TEXT.notes.answersTitle("XX-0012"), "Risposte del referente · XX-0012");
  assert.equal(CONTEXT_TEXT.notes.learnedTitle("XX-0012"), "Imparato costruendo XX-0012");
  assert.equal(CONTEXT_TEXT.notes.answerSource, "Le risposte stanno nella scheda dello use case, in «Cosa serve».");
  assert.equal(CONTEXT_TEXT.notes.openUseCase, "Apri lo use case");
});

test("(9b) genere neutro e nessun «caso»: la dashboard dice «use case», le persone sono «una persona» o un ruolo", () => {
  for (const group of [CONTEXT_TEXT.useCase, CONTEXT_TEXT.needLink, CONTEXT_TEXT.verify, CONTEXT_TEXT.people]) {
    for (const { path, text } of leaves(group, "").flatMap((leaf) => {
      if (typeof leaf.value === "string") return [{ path: leaf.path, text: leaf.value }];
      const result = (leaf.value as (...args: unknown[]) => unknown)("14 nov", "Il fatto.");
      return typeof result === "string" ? [{ path: leaf.path, text: result }] : [];
    })) {
      assert.doesNotMatch(text, /\bcas[oi]\b/i, `${path}: nella dashboard si dice «use case»`);
      assert.doesNotMatch(text, /\b(benvenuto|sicuro|pronto|tutti i tuoi|caro)\b/i, `${path}: genere neutro`);
    }
  }
});
