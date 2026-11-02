import test from "node:test";
import assert from "node:assert/strict";
import { REFERENT_LIMITS } from "./contract.ts";
import { MATCH_STOP_WORDS, initialTicks, isGenericOwner, orgWordsOf, questionsForPerson, wordsOf, type MatchQuestion } from "./match.ts";

// «Chiedi al referente» in tre passi (rilascio 4, §8.1): le domande proposte alla persona scelta.
// Dati sintetici: aziende «Alfa Jet (prova)» / «Alfa Jet e Belmonte», persone Aldo Prova, Bruna Esempio…
const ORG = orgWordsOf(["Alfa Jet (prova)", "Alfa Jet e Belmonte"]);
const q = (id: string, ownerLabel: string | null): MatchQuestion => ({ id, ownerLabel });
const person = (displayName: string, roleLabel: string | null = null) => ({ displayName, roleLabel });

test("le parole: senza accenti, minuscole, divise su tutto ciò che non è lettera o cifra, almeno 2 caratteri", () => {
  assert.deepEqual(wordsOf("Niccolò D'Àmbra · Ufficio Acquisti/IT (2026)"), ["niccolo", "ambra", "ufficio", "acquisti", "it", "2026"]);
  assert.deepEqual(wordsOf("mario.rossi"), ["mario", "rossi"]);
  assert.deepEqual(wordsOf(null), []);
  assert.deepEqual(wordsOf(""), []);
});

test("le parole dell'azienda: il nome del workspace e quello del connettore, senza articoli né lati", () => {
  assert.deepEqual([...ORG].sort(), ["alfa", "belmonte", "jet", "prova"]);
  assert.deepEqual([...orgWordsOf(["Lateral Space", null, undefined, "Cliente e fornitori"])], []);
  for (const word of ["il", "cliente", "fornitore", "lateral", "space", "insieme", "ufficio", "responsabile", "referente"]) assert.ok(MATCH_STOP_WORDS.has(word), word);
});

test("un «Chi» generico: vuoto, oppure solo azienda, lati e uffici generici", () => {
  assert.equal(isGenericOwner(null, ORG), true);
  assert.equal(isGenericOwner("", ORG), true);
  assert.equal(isGenericOwner("Belmonte", ORG), true);
  assert.equal(isGenericOwner("Cliente · Alfa Jet", ORG), true);
  assert.equal(isGenericOwner("Ufficio del cliente (Belmonte)", ORG), true);
  assert.equal(isGenericOwner("Insieme", ORG), true);
  assert.equal(isGenericOwner("Amministrazione Belmonte", ORG), false);
  assert.equal(isGenericOwner("Aldo", ORG), false);
});

test("il nome della persona in qualunque punto del «Chi», senza accenti e maiuscole", () => {
  const askable = [q("n1", "Contabilità · NICCOLÒ"), q("n2", "Tesoreria"), q("n3", "Acquisti, poi Niccolo per conferma")];
  const result = questionsForPerson({ person: person("Niccolò Esempio"), askable, orgWords: ORG });
  assert.deepEqual(result, { proposed: ["n1", "n3"], others: ["n2"], matched: true });
});

test("il cognome conta da 4 lettere; il nome anche più corto, da 3", () => {
  const askable = [q("n1", "Rossi"), q("n2", "Neri"), q("n3", "Ugo"), q("n4", "Fo")];
  assert.deepEqual(questionsForPerson({ person: person("Aldo Rossi"), askable, orgWords: ORG }).proposed, ["n1"]);
  assert.deepEqual(questionsForPerson({ person: person("Bruna Neri"), askable, orgWords: ORG }).proposed, ["n2"]);
  // «Ugo» è il nome (3 lettere): conta; «Fo» ne ha 2 e non entra nelle parole della persona.
  assert.deepEqual(questionsForPerson({ person: person("Ugo Fo"), askable, orgWords: ORG }).proposed, ["n3"]);
  // «Bo» come cognome: meno di 3 lettere, non conta; «Rea» da 3 lettere è un cognome troppo corto.
  assert.deepEqual(questionsForPerson({ person: person("Carla Rea"), askable: [q("n1", "Rea")], orgWords: ORG }).proposed, []);
});

test("una parola del ruolo scritto: «Amministrazione» porta le domande dell'amministrazione", () => {
  const askable = [q("n1", "Amministrazione"), q("n2", "Acquisti"), q("n3", "Direzione amministrazione e finanza")];
  const result = questionsForPerson({ person: person("Bruna Esempio", "Ufficio amministrazione"), askable, orgWords: ORG });
  assert.deepEqual(result, { proposed: ["n1", "n3"], others: ["n2"], matched: true });
  // Le parole del ruolo che sono anche del nome non contano due volte; quelle corte (< 3) mai.
  assert.deepEqual(questionsForPerson({ person: person("Bruna Esempio", "IT"), askable: [q("n1", "IT")], orgWords: ORG }).proposed, []);
});

test("le parole dell'azienda, dei lati e degli uffici non contano mai: nei «Chi», nei nomi e nei ruoli", () => {
  const askable = [q("n1", "Amministrazione Belmonte"), q("n2", "Belmonte · Tesoreria"), q("n3", "Responsabile acquisti")];
  // Un ruolo fatto solo dell'azienda e di «Responsabile» non nomina nessuna domanda.
  const role = questionsForPerson({ person: person("Bruna Esempio", "Responsabile Belmonte"), askable, orgWords: ORG });
  assert.deepEqual(role, { proposed: [], others: ["n1", "n2", "n3"], matched: false });
  // Una persona che si chiama come l'azienda: il nome non conta, il cognome sì.
  const named = questionsForPerson({ person: person("Belmonte Tesoreria"), askable, orgWords: ORG });
  assert.deepEqual(named.proposed, ["n2"]);
  // «Responsabile» non è una parola della persona né del «Chi».
  assert.deepEqual(questionsForPerson({ person: person("Responsabile Unico"), askable: [q("n1", "Responsabile acquisti")], orgWords: ORG }).proposed, []);
});

test("un «Chi» di sole parole dell'azienda, o nessun «Chi», è generico: si propone sempre", () => {
  const askable = [q("n1", "Alfa Jet"), q("n2", null), q("n3", "Tesoreria"), q("n4", "Belmonte, cliente")];
  const result = questionsForPerson({ person: person("Aldo Prova"), askable, orgWords: ORG });
  assert.deepEqual(result, { proposed: ["n1", "n2", "n4"], others: ["n3"], matched: false });
});

test("le domande preparate (senza «Chi») sono generiche: arrivano a chiunque", () => {
  const prepared = [q("p1", null), q("p2", null)];
  for (const who of [person("Aldo Prova"), person("Bruna Esempio", "Tesoreria"), person("x")]) {
    assert.deepEqual(questionsForPerson({ person: who, askable: prepared, orgWords: ORG }).proposed, ["p1", "p2"]);
  }
});

test("una persona senza nome nell'account: il nome viene dalla parte prima della chiocciola («mario.rossi»)", () => {
  const askable = [q("n1", "Mario (acquisti)"), q("n2", "Rossi"), q("n3", "Tesoreria")];
  assert.deepEqual(questionsForPerson({ person: person("mario.rossi"), askable, orgWords: ORG }).proposed, ["n1", "n2"]);
});

test("nessuna domanda nomina la persona: solo quelle generiche; niente di generico e nessuna: niente proposto", () => {
  const withGeneric = [q("n1", "Tesoreria"), q("n2", "Belmonte"), q("n3", "Acquisti")];
  assert.deepEqual(questionsForPerson({ person: person("Bruna Esempio"), askable: withGeneric, orgWords: ORG }), { proposed: ["n2"], others: ["n1", "n3"], matched: false });
  const none = [q("n1", "Tesoreria"), q("n3", "Acquisti")];
  assert.deepEqual(questionsForPerson({ person: person("Bruna Esempio"), askable: none, orgWords: ORG }), { proposed: [], others: ["n1", "n3"], matched: false });
});

test("«Chiedi di nuovo»: le domande di prima che si possono ancora chiedere, mai i nomi", () => {
  const askable = [q("N1", "Bruna"), q("n2", "Belmonte"), q("n3", "Tesoreria")];
  const again = questionsForPerson({ person: person("Bruna Esempio"), askable, orgWords: ORG, previous: ["n3", "n9"] });
  assert.deepEqual(again, { proposed: ["n3"], others: ["n1", "n2"], matched: true });
  const gone = questionsForPerson({ person: person("Bruna Esempio"), askable, orgWords: ORG, previous: ["n9"] });
  assert.deepEqual(gone, { proposed: [], others: ["n1", "n2", "n3"], matched: false });
});

test("più di 20 proposte: le prime 20 spuntate, nell'ordine della scheda", () => {
  const askable = Array.from({ length: 25 }, (_, i) => q(`n${String(i).padStart(2, "0")}`, null));
  const result = questionsForPerson({ person: person("Aldo Prova"), askable, orgWords: ORG });
  assert.equal(result.proposed.length, 25);
  assert.deepEqual(initialTicks(result, REFERENT_LIMITS.questionsPerRequest), askable.slice(0, 20).map((x) => x.id));
});

test("non legge mai il lato dell'esigenza: lo stesso «Chi» dà la stessa proposta per ogni lato", () => {
  const base = [q("n1", "Tesoreria"), q("n2", null)];
  const expected = questionsForPerson({ person: person("Bruna Esempio", "Tesoreria"), askable: base, orgWords: ORG });
  for (const side of ["cliente", "insieme", "fornitore", "lateral_space", null]) {
    const sided = base.map((x) => ({ ...x, ownerSide: side }));
    assert.deepEqual(questionsForPerson({ person: person("Bruna Esempio", "Tesoreria"), askable: sided, orgWords: ORG }), expected, String(side));
  }
});

// Una scheda fatta come la L1 di TopJet (prova) (§2, solo la forma: 7 domande, 6 «Chi» diversi, 5 con
// la parola dell'azienda, uno generico, una parola d'ufficio in 4) e le tre risposte di A3.
const L1: MatchQuestion[] = [
  q("q1", "Belmonte"),
  q("q2", "Amministrazione Belmonte"),
  q("q3", "Amministrazione Belmonte"),
  q("q4", "Belmonte, amministrazione e tesoreria"),
  q("q5", "Carlo Neri (Belmonte, amministrazione)"),
  q("q6", "Controllo di gestione"),
  q("q7", "Sistemi informativi"),
];

test("una scheda come la L1: la forma della prova", () => {
  assert.equal(L1.length, 7);
  assert.equal(new Set(L1.map((x) => x.ownerLabel)).size, 6);
  assert.equal(L1.filter((x) => wordsOf(x.ownerLabel).includes("belmonte")).length, 5);
  assert.equal(L1.filter((x) => isGenericOwner(x.ownerLabel, ORG)).length, 1);
  assert.equal(L1.filter((x) => wordsOf(x.ownerLabel).includes("amministrazione")).length, 4);
});

test("A3 sulla scheda come la L1: P le sue, Q e R solo la generica, con le altre sei a parte", () => {
  // P: il nome di una persona di un «Chi», un ruolo con la parola d'ufficio.
  const p = questionsForPerson({ person: person("Carlo Bianchi", "Amministrazione"), askable: L1, orgWords: ORG });
  assert.deepEqual(p, { proposed: ["q1", "q2", "q3", "q4", "q5"], others: ["q6", "q7"], matched: true });
  // Q: nessun ruolo, il nome in nessun «Chi».
  const qq = questionsForPerson({ person: person("Bruna Esempio"), askable: L1, orgWords: ORG });
  assert.deepEqual(qq, { proposed: ["q1"], others: ["q2", "q3", "q4", "q5", "q6", "q7"], matched: false });
  // R: il ruolo dice solo l'azienda.
  const r = questionsForPerson({ person: person("Dario Esempio", "Responsabile Belmonte"), askable: L1, orgWords: ORG });
  assert.deepEqual(r, { proposed: ["q1"], others: ["q2", "q3", "q4", "q5", "q6", "q7"], matched: false });
  // Le regole fissate a mano: almeno una spunta e meno di sette, la generica sempre spuntata.
  for (const result of [p, qq, r]) {
    const ticks = initialTicks(result, REFERENT_LIMITS.questionsPerRequest);
    assert.ok(ticks.length >= 1 && ticks.length < 7);
    assert.ok(ticks.includes("q1"));
  }
});
