import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ERASED_NOTE_TITLE, PERSON_PLACEHOLDER, erasedNoteTitle, personPattern, personSnippet, personTerm, purgedNoteText, replacePerson } from "./people.ts";
import { CONTEXT_TEXT } from "./text.ts";
import { CONTEXT_LIMITS } from "./vocab.ts";

// «Cerca una persona» (rilascio 9b, RILASCIO-9b-COSTRUZIONE.md §2.13, §5.9), le regole senza database: che cosa si può
// cercare, come si riconosce un nome (parola intera, senza maiuscole e accenti) e un'e-mail (testo esatto), i caratteri
// speciali che restano caratteri, la sostituzione con «una persona», il pezzo di testo da evidenziare, la frase al posto
// del testo di un appunto cancellato. L'espressione è la stessa che usa Postgres: people.integration.test.ts prova che i
// due danno lo stesso risultato.

/** Vero se `text` contiene `term`, con l'espressione che userà anche Postgres. */
const finds = (term: string, text: string) => new RegExp(personPattern(term)).test(text);

test("il termine: almeno 3 lettere, al massimo 80 caratteri; gli spazi ridotti a uno; un'e-mail si riconosce", () => {
  assert.equal(CONTEXT_LIMITS.personTermMin, 3);
  assert.equal(CONTEXT_LIMITS.personTermMax, 80);
  for (const raw of ["", "  ", "Al", "A.B", "a b", "...", "12345", "@@@"]) {
    assert.deepEqual(personTerm(raw), { ok: false, message: CONTEXT_TEXT.people.tooShort }, raw);
  }
  assert.equal(CONTEXT_TEXT.people.tooShort, "Scrivi almeno 3 lettere.");
  assert.deepEqual(personTerm("Ana"), { ok: true, term: "Ana", isEmail: false });
  assert.deepEqual(personTerm("  Mario \n  Rossi  "), { ok: true, term: "Mario Rossi", isEmail: false });
  assert.deepEqual(personTerm("Ma​rio"), { ok: true, term: "Mario", isEmail: false }, "i caratteri invisibili non contano");
  assert.deepEqual(personTerm("Anna.Rossi@Cliente.it"), { ok: true, term: "Anna.Rossi@Cliente.it", isEmail: true });
  assert.equal((personTerm("@rossi") as { isEmail: boolean }).isEmail, false, "una chiocciola sola non fa un'e-mail");
  assert.equal((personTerm("anna@cliente") as { isEmail: boolean }).isEmail, false);
  assert.equal(personTerm("x".repeat(80)).ok, true);
  assert.deepEqual(personTerm("x".repeat(81)), { ok: false, message: CONTEXT_TEXT.errors.tooLong(80) });
  // Un valore che non è testo non passa.
  assert.equal(personTerm(undefined as unknown as string).ok, false);
});

test("un nome si cerca come parola intera: «Rossi» non prende «Rossini»", () => {
  for (const text of ["Rossi", "Mario Rossi ha chiamato.", "(Rossi)", "Rossi.", "dott.Rossi", "Rossi-Bianchi", "Rossi's", "«Rossi»", "Rossi\nBianchi"]) {
    assert.equal(finds("Rossi", text), true, text);
  }
  for (const text of ["Rossini", "Rossiello", "XRossi", "Rossi2", "Rossi_ufficio", "Rossì̀x", "Grossi", "È Rossino", "Rossià"]) {
    assert.equal(finds("Rossi", text), false, text);
  }
});

test("senza maiuscole e senza accenti, anche in un testo scomposto (NFD)", () => {
  for (const text of ["rossi", "ROSSI", "RoSsI", "Rossì", "Róssi", "ROSSÌ", "Rossì".normalize("NFD")]) assert.equal(finds("Rossi", text), true, text);
  for (const text of ["Nicolo", "NICOLÒ", "nicolò", "Nicolò".normalize("NFD")]) assert.equal(finds("Nicolò", text), true, text);
  assert.equal(finds("José", "Jose"), true);
  assert.equal(finds("Jose", "JOSÉ"), true);
  assert.equal(finds("Søren", "SØREN"), true);
  // Un accento in più in mezzo a una parola più lunga non la fa diventare il nome.
  assert.equal(finds("Jose", "Josefina"), false);
});

test("i nomi di più parole: spazi, ritorni a capo, apostrofi e trattini tipografici", () => {
  for (const text of ["De Luca", "de  luca", "DE LUCA", "De\nLuca", "De Luca"]) assert.equal(finds("De Luca", text), true, JSON.stringify(text));
  assert.equal(finds("De Luca", "DeLuca"), false);
  assert.equal(finds("De Luca", "De Lucarelli"), false);
  assert.equal(finds("D'Angelo", "D’Angelo"), true);
  assert.equal(finds("D’Angelo", "d'angelo"), true);
  assert.equal(finds("Rossi-Bianchi", "Rossi–Bianchi"), true);
});

test("un'e-mail come testo esatto, senza maiuscole, mai dentro un indirizzo più lungo", () => {
  const email = "anna.rossi@cliente.it";
  for (const text of ["anna.rossi@cliente.it", "Anna.Rossi@Cliente.IT", "<anna.rossi@cliente.it>", "scrivi a anna.rossi@cliente.it.", "(anna.rossi@cliente.it)"]) {
    assert.equal(finds(email, text), true, text);
  }
  for (const text of ["joanna.rossi@cliente.it", "anna.rossi@cliente.it.com", "anna.rossi@cliente.itx", "anna.rossi@cliente.it-x", "xanna.rossi@cliente.it", "anna_rossi@cliente.it", "anna.rossi@cliente-it"]) {
    assert.equal(finds(email, text), false, text);
  }
  // Il punto dell'indirizzo è un punto, non «un carattere qualsiasi».
  assert.equal(finds(email, "anna.rossi@clienteXit"), false);
});

test("i caratteri speciali di un'espressione regolare restano caratteri", () => {
  assert.equal(finds("R.ssi", "Rossi"), false, "il punto non è «un carattere qualsiasi»");
  assert.equal(finds("R.ssi", "R.ssi"), true);
  assert.equal(finds("Ros+i", "Rossssi"), false);
  assert.equal(finds("Ros+i", "Ros+i"), true);
  assert.equal(finds("(Rossi|Bianchi)", "Rossi"), false, "niente alternative");
  assert.equal(finds("(Rossi|Bianchi)", "(Rossi|Bianchi)"), true);
  assert.equal(finds("[A-Z]ossi", "Rossi"), false, "niente classi");
  assert.equal(finds("Ros{2}i", "Rossi"), false, "niente ripetizioni");
  assert.equal(finds("Rossi$ ^Bianchi", "Rossi$ ^Bianchi"), true);
  assert.equal(finds("Rossi\\d", "Rossi1"), false);
  // Ogni carattere ASCII stampabile, in mezzo a un nome, dà un'espressione valida che trova solo sé stessa.
  for (let code = 0x21; code <= 0x7e; code++) {
    const ch = String.fromCharCode(code);
    if (/[A-Za-z0-9 '_-]/.test(ch)) continue;
    const term = `Ros${ch}si`;
    assert.doesNotThrow(() => new RegExp(personPattern(term)), term);
    assert.equal(finds(term, `prima ${term} dopo`), true, term);
    assert.equal(finds(term, "prima Rossi dopo"), false, term);
  }
  // Nessun flag: l'espressione non comincia con un'opzione incorporata, e non ha gruppi che catturano.
  for (const term of ["Mario Rossi", "anna@cliente.it"]) {
    const pattern = personPattern(term);
    assert.doesNotMatch(pattern, /^\(\?[a-z]/);
    assert.doesNotMatch(pattern.replace(/\\\(/g, ""), /\((?!\?)/);
  }
});

test("la sostituzione: il nome diventa «una persona» ovunque, «Rossini» resta; un termine non valido non cambia niente", () => {
  assert.equal(PERSON_PLACEHOLDER, "una persona");
  assert.equal(replacePerson("Rossi ha detto a Rossini che ROSSÌ approva.", "Rossi"), "una persona ha detto a Rossini che una persona approva.");
  assert.equal(replacePerson("Chiedere a Mario  Rossi o a mario rossi.", "Mario Rossi"), "Chiedere a una persona o a una persona.");
  assert.equal(replacePerson("Scrivere ad Anna.Rossi@Cliente.it entro lunedì.", "anna.rossi@cliente.it"), "Scrivere ad una persona entro lunedì.");
  assert.equal(replacePerson("Il gestionale è SAP Business One.", "Rossi"), "Il gestionale è SAP Business One.");
  // Una seconda volta non cambia più niente.
  const once = replacePerson("Rossi e Rossi.", "Rossi");
  assert.equal(replacePerson(once, "Rossi"), once);
  // Un termine troppo corto non sostituisce le sillabe di tutte le parole.
  assert.equal(replacePerson("Alba e Al.", "Al"), "Alba e Al.");
  // Un'espressione scritta come nome non diventa un'espressione.
  assert.equal(replacePerson("Rossi e R.ssi", "R.ssi"), "Rossi e una persona");
});

test("il titolo generico degli appunti tolti: «Appunti del 14/11/2026»", () => {
  assert.equal(ERASED_NOTE_TITLE, "Appunti del {data}");
  assert.equal(erasedNoteTitle("2026-11-14"), "Appunti del 14/11/2026");
  assert.equal(erasedNoteTitle("2026-01-05T00:00:00.000Z"), "Appunti del 05/01/2026");
});

test("un appunto senza testo: «dopo 12 mesi» solo per la conservazione; dopo «Togli … da tutto» la frase neutra", () => {
  const RETENTION = "Il testo è stato cancellato dopo 12 mesi. Restano i fatti.";
  const NEUTRAL = "Il testo è stato cancellato. Restano i fatti.";
  assert.deepEqual([CONTEXT_TEXT.notes.purged, CONTEXT_TEXT.notes.textErased], [RETENTION, NEUTRAL]);
  const note = (over: Partial<Parameters<typeof purgedNoteText>[0]> = {}) =>
    purgedNoteText({ title: "Call di avvio", occurredOn: "2025-11-10", createdAt: "2025-11-10T09:00:00.000Z", textPurgedAt: "2026-11-11T02:00:00.000Z", ...over });
  // La conservazione: più di 12 mesi da quando è stato aggiunto, il titolo com'era. Anche con le date del server.
  assert.equal(note(), RETENTION);
  assert.equal(note({ createdAt: new Date("2025-11-10T09:00:00.000Z"), textPurgedAt: new Date("2026-11-11T02:00:00.000Z") }), RETENTION);
  // «Togli … da tutto» entro i 12 mesi: il titolo generico e la data, tutti e due.
  const erased = { title: erasedNoteTitle("2026-11-14"), occurredOn: "2026-11-14", createdAt: "2026-11-14T10:00:00.000Z", textPurgedAt: "2026-11-18T15:00:00.000Z" };
  assert.equal(note(erased), NEUTRAL);
  // Basta uno dei due segni: il titolo generico su un appunto di più di 12 mesi che la notte non aveva ancora cancellato…
  assert.equal(note({ title: "Appunti del 10/11/2025", textPurgedAt: "2026-11-10T20:00:00.000Z" }), NEUTRAL);
  // …o il testo sparito prima dei 12 mesi, anche con un altro titolo: la conservazione non lo fa mai.
  assert.equal(note({ ...erased, title: "Call di avvio" }), NEUTRAL);
  // Il confine della conservazione (`created_at` prima di 12 mesi fa, in senso stretto).
  assert.equal(note({ createdAt: "2025-11-18T10:00:00.000Z", textPurgedAt: "2026-11-18T10:00:00.000Z" }), NEUTRAL);
  assert.equal(note({ createdAt: "2025-11-18T09:59:59.999Z", textPurgedAt: "2026-11-18T10:00:00.000Z" }), RETENTION);
  // Nel dubbio la frase neutra, che è sempre vera: date che non si leggono, nessuna data.
  for (const over of [{ textPurgedAt: null }, { textPurgedAt: "non una data" }, { createdAt: "" }]) assert.equal(note(over), NEUTRAL, JSON.stringify(over));
});

test("il pannello della fonte prende la frase da purgedNoteText, non più sempre quella dei 12 mesi", () => {
  const sheet = readFileSync(new URL("../../components/context/source-sheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /import \{ purgedNoteText \} from "@\/lib\/context\/people";/);
  assert.match(sheet, /\) : purged \? \(\s*<p className="text-sm text-muted-foreground">\{purgedNoteText\(source\)\}<\/p>/);
  assert.doesNotMatch(sheet, /T\.notes\.purged\b/);
});

test("il pezzo di testo intorno al nome: posizioni come Postgres, spazi ridotti, parole tagliate ai bordi tolte", () => {
  assert.deepEqual(personSnippet({ window: "Ha chiamato Mario Rossi per gli ordini.", at: 12, length: 11, head: false, tail: false }), {
    before: "Ha chiamato ",
    match: "Mario Rossi",
    after: " per gli ordini.",
  });
  // La finestra taglia il testo: la parola a metà si toglie, al suo posto «…».
  assert.deepEqual(personSnippet({ window: "rtante: chiamare\n\nRossi  domani per il magaz", at: 18, length: 5, head: true, tail: true }), {
    before: "…chiamare ",
    match: "Rossi",
    after: " domani per il…",
  });
  // Postgres conta i caratteri, non le unità UTF-16: un'emoji prima del nome non sposta il nome.
  assert.deepEqual(personSnippet({ window: "📞 Rossi richiama", at: 2, length: 5, head: false, tail: false }), { before: "📞 ", match: "Rossi", after: " richiama" });
  // Posizioni che non tornano: niente pezzo.
  assert.equal(personSnippet({ window: "Rossi", at: 3, length: 5, head: false, tail: false }), null);
  assert.equal(personSnippet({ window: "Rossi", at: -1, length: 5, head: false, tail: false }), null);
  assert.equal(personSnippet({ window: "Rossi", at: 0, length: 0, head: false, tail: false }), null);
  assert.equal(personSnippet(null), null);
});
