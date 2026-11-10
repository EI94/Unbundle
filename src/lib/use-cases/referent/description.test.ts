import test from "node:test";
import assert from "node:assert/strict";
import { referentDescription, sentenceIsHidden, sentencesOf, shortTextIsShown } from "./description.ts";

// Rilascio 5 (§3.5): la descrizione dello use case come la vede il referente. Testi sintetici.

test("le frasi: si divide dopo . ! ? … seguiti da uno spazio", () => {
  assert.deepEqual(sentencesOf("Prima frase. Seconda!  Terza?\nQuarta… quinta"), ["Prima frase.", "Seconda!", "Terza?", "Quarta…", "quinta"]);
  assert.deepEqual(sentencesOf(""), []);
  assert.deepEqual(sentencesOf("Versione 1.5 del gestionale."), ["Versione 1.5 del gestionale."]);
});

test("ogni indicatore di importi, quote e punteggi toglie la frase", () => {
  for (const s of [
    "Si risparmia il 30% del tempo.",
    "Circa trenta percento delle pratiche.",
    "Un risparmio di 40.000 l'anno.",
    "I costi 12 volte più bassi.",
    "Il ROI è alto.",
    "Punteggio 4/5 nella valutazione.",
    "Vale circa 30k all'anno.",
    "Fino a 2 milioni di documenti.",
    "Spendiamo 5.000 € al mese.",
    "Budget di 2.000 EUR.",
    "Duemila euro l'anno.",
    "Circa 12 k€.",
    "Trenta mila pratiche.",
    "Uno score di affidabilità.",
  ]) {
    assert.equal(sentenceIsHidden(s), true, s);
  }
  for (const s of ["Riduce i costi del controllo.", "Le fatture arrivano via PEC.", "Ogni giorno 20 fatture da controllare.", "Il risparmio di tempo è il primo ritorno."]) {
    assert.equal(sentenceIsHidden(s), false, s);
  }
});

test("i dati personali e sanitari tolgono la frase", () => {
  assert.equal(sentenceIsHidden("Scrivere a mario.rossi@cliente.test per i dubbi."), true);
  assert.equal(sentenceIsHidden("Il numero è +39 333 1234567."), true);
  assert.equal(sentenceIsHidden("Serve quando un collega è in malattia per una visita medica."), true);
});

test("le frasi che restano si riuniscono; vuota → null; si contano quelle tolte", () => {
  assert.deepEqual(referentDescription("Le fatture arrivano via PEC. Si risparmia il 30%. Il controllo è a mano."), {
    text: "Le fatture arrivano via PEC. Il controllo è a mano.",
    dropped: 1,
  });
  assert.deepEqual(referentDescription("Vale 30k. Il ROI è alto."), { text: null, dropped: 2 });
  assert.deepEqual(referentDescription(null), { text: null, dropped: 0 });
  assert.deepEqual(referentDescription("   "), { text: null, dropped: 0 });
  assert.deepEqual(referentDescription("Una frase sola senza punto"), { text: "Una frase sola senza punto", dropped: 0 });
});

test("un campione con la forma di Rondine: 17 descrizioni su 50 perdono 1 o 2 frasi, una resta vuota", () => {
  const plain = ["Le richieste arrivano per email.", "Il team le smista a mano.", "Serve un controllo prima dell'invio."];
  const money = ["Si risparmiano 4.000 € l'anno.", "Il ROI stimato è alto."];
  const descriptions: string[] = [];
  for (let i = 0; i < 50; i++) {
    if (i === 9) descriptions.push(money.join(" "));
    else if (i < 17) descriptions.push([...plain.slice(0, 2), money[i % 2]].join(" "));
    else descriptions.push(plain.join(" "));
  }
  const results = descriptions.map(referentDescription);
  assert.equal(results.filter((r) => r.dropped > 0).length, 17);
  assert.equal(results.filter((r) => r.text === null).length, 1);
  assert.ok(results.every((r) => r.dropped <= 2));
});

test("le parole brevi (unità, etichetta) passano lo stesso filtro", () => {
  assert.equal(shortTextIsShown("fatture"), true);
  assert.equal(shortTextIsShown("€ di fatture"), false);
  assert.equal(shortTextIsShown(""), false);
  assert.equal(shortTextIsShown(null), false);
});
