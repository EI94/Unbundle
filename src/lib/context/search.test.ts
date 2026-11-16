import test from "node:test";
import assert from "node:assert/strict";
import { contextTsQuery, searchWords, SEARCH_WORDS_MAX } from "./search.ts";

// La ricerca per parole di «Chiedi al contesto» (RILASCIO-9a-COSTRUZIONE.md §4.4).

test("parole corte e segni fuori; ogni parola con il prefisso, unite con |", () => {
  assert.equal(contextTsQuery("Qual è il gestionale di Nardi?"), "qual:* | gestionale:* | nardi:*");
  assert.deepEqual(searchWords("Che ERP usa l'ufficio acquisti?"), ["che", "erp", "usa", "ufficio", "acquisti"]);
  assert.equal(contextTsQuery("perché è così?"), "perché:* | così:*", "le lettere accentate restano");
  assert.equal(contextTsQuery("a di è"), "");
  assert.equal(contextTsQuery(""), "");
  assert.equal(contextTsQuery("?!… — ()"), "");
});

test("al massimo 15 parole, senza doppioni", () => {
  const many = Array.from({ length: 40 }, (_, i) => `parola${i}`).join(" ");
  assert.equal(searchWords(many).length, SEARCH_WORDS_MAX);
  assert.equal(SEARCH_WORDS_MAX, 15);
  assert.deepEqual(searchWords("SAP sap Sap gestionale"), ["sap", "gestionale"]);
});

test("nessun operatore di to_tsquery passa", () => {
  for (const attack of [
    "sap & !gestionale",
    "sap | (ordini <-> magazzino)",
    "ordini:* | 'x' :A",
    "a'); DROP TABLE context_facts; --",
    "foo_bar\\baz <2> qux",
    "\"frase esatta\" !negata",
  ]) {
    const query = contextTsQuery(attack);
    // Solo parole di lettere e cifre con `:*`, separate da ` | `.
    assert.match(query, /^$|^[\p{L}\p{N}]+:\*( \| [\p{L}\p{N}]+:\*)*$/u, attack);
  }
  assert.equal(contextTsQuery("foo_bar"), "foo:* | bar:*", "il trattino basso separa");
  assert.equal(contextTsQuery("sap & !gestionale"), "sap:* | gestionale:*");
});
