import test from "node:test";
import assert from "node:assert/strict";
import { bodyHash, cleanBody, cut, entityKey, entityName, foldText, normalizeStatement, oneLine } from "./normalize.ts";

// Testi a confronto (RILASCIO-9a-COSTRUZIONE.md §2.2, §4.2).

test("la stessa frase con maiuscole, accenti, segni e spazi diversi ha la stessa chiave", () => {
  const key = normalizeStatement("Il gestionale è SAP Business One.");
  assert.equal(key, "il gestionale e sap business one");
  for (const same of [
    "il gestionale e sap business one",
    "  IL GESTIONALE È  SAP\tBusiness One ",
    "Il gestionale è SAP Business One",
    "Il gestionale e' SAP Business One!",
    "Il gestionale è «SAP Business One».",
    "Il gestionale è SAP Business One.", // la «è» scritta con l'accento a parte
  ]) {
    assert.equal(normalizeStatement(same), key, same);
  }
  assert.notEqual(normalizeStatement("Il gestionale è SAP Business One."), normalizeStatement("Il gestionale è SAP S/4HANA."));
  assert.equal(normalizeStatement(""), "");
  assert.equal(normalizeStatement("…!?"), "");
});

test("foldText: per cercare una citazione dentro un appunto, virgolette e apostrofi tipografici valgono quelli semplici", () => {
  assert.equal(foldText("L’ERP  è  “SAP”\n— dice il direttore…"), "l'erp è \"sap\" - dice il direttore...");
  assert.equal(foldText("  Ordini\r\nA MANO  "), "ordini a mano");
  const note = foldText("Il direttore dice: «L’ordine si inserisce a mano,\nogni mattina».");
  assert.ok(note.includes(foldText("\"L'ordine si inserisce a mano, ogni mattina\"")));
  assert.notEqual(foldText("è"), foldText("e"), "gli accenti restano: una citazione è parola per parola");
});

test("entityKey: minuscole, senza accenti, spazi ridotti, al massimo 120 caratteri", () => {
  assert.equal(entityKey("SAP  Business One"), "sap business one");
  assert.equal(entityKey(" Qualità "), "qualita");
  assert.equal(entityKey("Direttore operativo"), entityKey("DIRETTORE  OPERATIVO"));
  assert.equal(entityKey("x".repeat(300)).length, 120);
  assert.equal(entityKey("SAP"), entityKey("SAP").toLowerCase(), "la chiave è già in minuscolo, come vuole il CHECK");
  assert.equal(entityName("  SAP   Business\nOne "), "SAP Business One");
  assert.equal(entityName("y".repeat(200)).length, 120);
});

test("bodyHash: stabile per lo stesso testo, anche con altri a capo e spazi in fondo; diverso per un altro testo", () => {
  const hash = bodyHash("Riga uno\nRiga due");
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(bodyHash("Riga uno\r\nRiga due\r\n"), hash);
  assert.equal(bodyHash("\n\nRiga uno  \nRiga due\t\n\n"), hash);
  assert.equal(bodyHash("Riga uno\nRiga due"), bodyHash("Riga uno\nRiga due"));
  assert.notEqual(bodyHash("Riga uno\nRiga tre"), hash);
  assert.notEqual(bodyHash("Riga uno Riga due"), hash, "un a capo dentro il testo conta");
  assert.equal(cleanBody("a\u0000b\r\nc  \n"), "ab\nc");
});

test("oneLine e cut: una riga sola; il taglio non spezza un carattere", () => {
  assert.equal(oneLine("  una\nfrase\t sola  "), "una frase sola");
  assert.equal(cut("abcdef", 4), "abcd");
  assert.equal(cut("abc", 10), "abc");
  assert.equal(cut("ab😀cd", 3), "ab", "la faccina sono due unità: non resta a metà");
  assert.equal(cut("ab😀cd", 4), "ab😀");
});
