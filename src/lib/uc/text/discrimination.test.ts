import test from "node:test";
import assert from "node:assert/strict";
import { DISCRIMINATION_CATEGORIES, DISCRIMINATION_MESSAGE, PERSON_WORD, PREFERENCE_DISTANCE, findDiscrimination } from "./discrimination.ts";
import { prepareText } from "./words.ts";

const found = (text: string) => findDiscrimination(prepareText(text)).map((m) => `${m.category}:${m.term}`);

test("the message is the one of the plan", () => {
  assert.equal(DISCRIMINATION_MESSAGE, "Le preferenze su genere, età, origine, religione o salute non si registrano. Riformula senza indicarle.");
  assert.deepEqual(DISCRIMINATION_CATEGORIES, ["genere", "eta", "origine", "religione", "orientamento"]);
});

test("each category near a preference marker blocks", () => {
  assert.deepEqual(found("Il cliente preferisce solo piloti donne"), ["genere:donne"]);
  assert.deepEqual(found("vuole equipaggio femminile"), ["genere:femminile"]);
  assert.deepEqual(found("evitare comandanti anziani"), ["eta:anziani"]);
  assert.deepEqual(found("chiede piloti over 50"), ["eta:over"]);
  assert.deepEqual(found("niente personale straniero"), ["origine:stranieri".replace("stranieri", "straniero")]);
  assert.deepEqual(found("non gradisce hostess di etnia diversa"), ["origine:etnia"]);
  assert.deepEqual(found("preferisce passeggeri cristiani"), ["religione:cristiani"]);
  assert.deepEqual(found("rifiuta clienti musulmani"), ["religione:musulmani"]);
  assert.deepEqual(found("no equipaggi gay"), ["orientamento:gay"]);
  assert.deepEqual(found("richiede piloti eterosessuali"), ["orientamento:eterosessuali"]);
});

test("the marker must be within 6 words", () => {
  assert.equal(PREFERENCE_DISTANCE, 6);
  // 5 parole in mezzo: distanza 6, blocca.
  assert.deepEqual(found("preferisce uno due tre quattro cinque donne"), ["genere:donne"]);
  // 6 parole in mezzo: distanza 7, non blocca.
  assert.deepEqual(found("preferisce uno due tre quattro cinque sei donne"), []);
  // Anche dopo il termine.
  assert.deepEqual(found("donne uno due tre quattro cinque evitare"), ["genere:donne"]);
  assert.deepEqual(found("ci sono donne e uomini in organico"), []);
});

test("terms that also describe things need a person nearby", () => {
  assert.deepEqual(found("Preferisce operatori italiani"), []);
  assert.deepEqual(found("Preferisce piloti italiani"), ["origine:italiani"]);
  assert.deepEqual(found("vuole una flotta giovane"), []);
  assert.deepEqual(found("vuole equipaggi giovani"), ["eta:giovani"]);
  assert.deepEqual(found("evita aerei vecchi"), []);
  assert.deepEqual(found("chiede la nazionalità del pilota solo per i voli extra UE"), ["origine:nazionalita"]);
  assert.deepEqual(found("marche di nazionalità solo sul timone"), []);
  // Origine e provenienza dei voli non sono l'origine delle persone.
  assert.deepEqual(found("Solo voli con origine Milano per i clienti"), []);
  assert.deepEqual(found("passeggeri in provenienza da Londra, solo il venerdì"), []);
  // «I ragazzi» passeggeri: età solo con una persona vicina.
  assert.deepEqual(found("per i ragazzi chiede l'età solo se l'aereo è al limite"), []);
  assert.deepEqual(found("non vuole ragazzi come equipaggio"), ["eta:ragazzi"]);
});

test("years: age only after a number and when not a duration or experience", () => {
  assert.deepEqual(found("il cliente non vuole piloti con più di 60 anni"), ["eta:anni"]);
  assert.deepEqual(found("aerei con più di 20 anni li evitiamo"), []);
  assert.deepEqual(found("solo piloti con almeno 10 anni di esperienza"), []);
  assert.deepEqual(found("il pilota lavora con noi da 5 anni, solo voli brevi"), []);
  assert.deepEqual(found("il pilota rinnova ogni 2 anni, solo in sede"), []);
  assert.deepEqual(found("piloti con anni di volo, solo"), []);
});

test("words inside identifiers do not count", () => {
  assert.deepEqual(found("regole: rule.equipaggi.over_60 (solo se concordata)"), []);
  assert.deepEqual(found("vedi rule.preferenze.donne solo per esempio"), []);
});

test("statistics with a marker nearby still block (prudence)", () => {
  assert.deepEqual(found("solo il 10% dei passeggeri sono donne"), ["genere:donne"]);
});

test("persons for the nearby check", () => {
  for (const w of ["pilota", "piloti", "comandante", "ufficiale", "equipaggio", "hostess", "cliente", "passeggeri", "persone", "personale"]) {
    assert.ok(PERSON_WORD.test(w), w);
  }
  for (const w of ["aereo", "operatori", "proprietari", "flotta"]) assert.ok(!PERSON_WORD.test(w), w);
});

test("acronyms that look like terms do not count: ETA (arrival time), ROM (Rome city code)", () => {
  assert.deepEqual(found("Il cliente richiede solo l'ETA aggiornata"), []);
  assert.deepEqual(found("Partenze solo da ROM e MIL"), []);
  // Written as words, they still count.
  assert.deepEqual(found("il cliente chiede l'età del pilota, solo giovani"), ["eta:eta", "eta:giovani"]);
  assert.deepEqual(found("IL CLIENTE CHIEDE L'ETÀ DEL PILOTA"), ["eta:eta"]);
  assert.deepEqual(found("niente rom a bordo"), ["origine:rom"]);
});

test("crew age rules from regulation are not client preferences", () => {
  // A crew age threshold with only rule markers and no client or passenger nearby.
  assert.deepEqual(found("mai due piloti over 60 nello stesso equipaggio"), []);
  assert.deepEqual(found("solo un comandante sopra i 60 anni per equipaggio"), []);
  // Near a regulation, any age term is the rule itself.
  assert.deepEqual(found("Secondo la normativa EASA FCL.065 un pilota over 60 vola solo in equipaggio multipilota"), []);
  assert.deepEqual(found("il regolamento vieta piloti sessantenni soli, mai in equipaggio singolo"), []);
  // A client, a passenger or a request verb make it a preference again.
  assert.deepEqual(found("il cliente: mai piloti over 60"), ["eta:over"]);
  assert.deepEqual(found("chiede piloti over 50"), ["eta:over"]);
  assert.deepEqual(found("niente passeggeri over 80"), ["eta:over"]);
  // Vague age words about crew are never a regulatory threshold.
  assert.deepEqual(found("mai comandanti anziani"), ["eta:anziani"]);
});
