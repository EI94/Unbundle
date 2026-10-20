import test from "node:test";
import assert from "node:assert/strict";
import { findBirthDates, findEmails, findPersonNames, findPhones, findTaxCodes, mergeSpans } from "./personal-data.ts";
import { prepareText } from "./words.ts";

const slices = (text: string, spans: { start: number; end: number }[]) => spans.map((s) => text.slice(s.start, s.end));
const names = (text: string, known: string[] = []) => {
  const t = prepareText(text);
  return findPersonNames(t, known).map((m) => `${m.kind}:${t.text.slice(t.starts[m.first], t.ends[m.last])}`);
};

test("emails", () => {
  const text = "scrivere a nome.cognome@esempio.it o a info@sub.esempio.co.uk, non a @esempio";
  assert.deepEqual(slices(text, findEmails(text)), ["nome.cognome@esempio.it", "info@sub.esempio.co.uk"]);
});

test("phones: mobiles, landlines and international numbers", () => {
  const ok = ["333 1234567", "3331234567", "333.123.4567", "333-123 4567", "02 12345678", "06/1234567", "+39 333 1234567", "+44 20 7946 0958", "0039 02 1234567", "+1 (555) 123-4567"];
  for (const p of ok) assert.deepEqual(slices(`tel ${p}.`, findPhones(`tel ${p}.`)), [p], p);
});

test("phones: amounts, dates, ranges and codes are not phones", () => {
  const no = [
    "350 000 000",
    "1.200.000",
    "costo 5.000-10.000 €",
    "01/10/2025",
    "anno 2026",
    "volo AZ 1234",
    "0,5 punti",
    "+3,5%",
    "12 500",
    "codice 000123",
    "320 400 500",
  ];
  for (const p of no) assert.deepEqual(findPhones(p), [], p);
});

test("Italian tax codes, also with omocodia, need digits", () => {
  const text = "CF RSSMRA80A01H501U e rssmra80a01h50mu, non PRECIPITEVOLISS";
  assert.deepEqual(slices(text, findTaxCodes(text)), ["RSSMRA80A01H501U", "rssmra80a01h50mu"]);
  assert.deepEqual(findTaxCodes("ABCDEFLMALMAMNPQ"), []);
  assert.deepEqual(findTaxCodes("XRSSMRA80A01H501U"), []);
});

test("birth dates: a date or year near «nato», «nascita», «compleanno»", () => {
  const cases: [string, number][] = [
    ["Nato il 12/03/1980", 1],
    ["nata il 3 marzo 1985 a Roma", 1],
    ["data di nascita: 01.02.1970", 1],
    ["compleanno 12-03-80", 1],
    ["DOB 1975", 1],
    ["la data di nascita è nel profilo", 0],
    ["nato a Roma", 0],
    ["contratto del 12/03/2020", 0],
    ["nato il progetto nel 2019 uno due tre quattro cinque sei sette 12/03/2020", 1],
    ["nato uno due tre quattro cinque sei sette 12/03/1980", 0],
  ];
  for (const [text, n] of cases) assert.equal(findBirthDates(prepareText(text)).length, n, text);
});

test("names: first name + surname, title + surname, isolated names", () => {
  assert.deepEqual(names("Chiedere a Mario Rossi"), ["nome_cognome:Mario Rossi"]);
  assert.deepEqual(names("Chiedere ad Anna De Luca"), ["nome_cognome:Anna De Luca"]);
  assert.deepEqual(names("sig. Lo Russo"), ["titolo_cognome:sig. Lo Russo"]);
  assert.deepEqual(names("Luca ROSSI e ROSSI Mario"), ["nome_cognome:Luca ROSSI", "nome_cognome:ROSSI Mario"]);
  assert.deepEqual(names("MARIO ROSSI"), ["nome_cognome:MARIO ROSSI"]);
  assert.deepEqual(names("Gabriella D'Amico"), ["nome_cognome:Gabriella D'Amico"]);
  assert.deepEqual(names("sentire il sig. Bianchi"), ["titolo_cognome:sig. Bianchi"]);
  assert.deepEqual(names("la dott.ssa Verdi"), ["titolo_cognome:dott.ssa Verdi"]);
  assert.deepEqual(names("il Comandante Neri"), ["titolo_cognome:Comandante Neri"]);
  assert.deepEqual(names("Chiedere a Mario"), ["nome:Mario"]);
  assert.deepEqual(names("Paolo ha detto di sì"), ["nome:Paolo"]);
});

test("names: lowercase words, places, airports, institutions are not people", () => {
  assert.deepEqual(names("chiedere a mario"), []);
  assert.deepEqual(names("Atterriamo al Marco Polo"), []);
  assert.deepEqual(names("Aeroporto Leonardo da Vinci"), []);
  assert.deepEqual(names("via Giuseppe Verdi 3, corso Vittorio Emanuele"), []);
  assert.deepEqual(names("Santa Maria e San Marco"), []);
  assert.deepEqual(names("Marina Militare"), []);
  assert.deepEqual(names("Leonardo Helicopters"), []);
  assert.deepEqual(names("l'agente ROSA, il franco svizzero, Rosa Rossi"), []);
  assert.deepEqual(names("il comandante decide"), []);
  assert.deepEqual(names("Mario\nRossi"), ["nome:Mario"]);
});

test("names from the private list are always found, in any case and accent", () => {
  assert.deepEqual(names("ne parla Zebedeo Quarzi", ["Zebedeo Quarzi"]), ["nome_noto:Zebedeo Quarzi"]);
  assert.deepEqual(names("ne parla ZEBEDEO", ["Zebedeo"]), ["nome_noto:ZEBEDEO"]);
  assert.deepEqual(names("Nicolò e nicolo", ["Nicolo"]), ["nome_noto:Nicolò", "nome_noto:nicolo"]);
  assert.deepEqual(names("x", ["", "a", 3 as never]), []);
});

test("mergeSpans joins overlaps", () => {
  assert.deepEqual(
    mergeSpans([
      { start: 5, end: 8 },
      { start: 0, end: 3 },
      { start: 2, end: 4 },
      { start: 8, end: 9 },
    ]),
    [
      { start: 0, end: 4 },
      { start: 5, end: 8 },
      { start: 8, end: 9 },
    ],
  );
});
