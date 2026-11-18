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
  assert.equal(CONTEXT_TEXT.fact.sourceDiscovery, "Discovery");
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
