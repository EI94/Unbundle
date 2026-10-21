import test from "node:test";
import assert from "node:assert/strict";
import {
  FALLBACK_CODE_PREFIX,
  PREFIX_STOP_WORDS,
  isValidCodePrefix,
  isValidWorkspaceSlug,
  prefixWords,
  proposePrefix,
  proposeSlug,
  slugForNewWorkspace,
} from "./prefix.ts";

// docs/use-case/DESIGN.md §10.6 (D6). Nomi di workspace inventati.

const WS = "3f2a9c1e-0000-4000-8000-0000000000f1";
const WS_2 = "9b7d0e44-0000-4000-8000-0000000000f2";

test("prefisso: con 2 o più parole le iniziali delle prime 3", () => {
  assert.equal(proposePrefix("Acme Industrie"), "AI");
  assert.equal(proposePrefix("Banca Popolare Esempio"), "BPE");
  assert.equal(proposePrefix("Banca Popolare Esempio Nord Ovest"), "BPE");
  assert.equal(proposePrefix("acme-industrie_logistica"), "AIL", "parole separate da tutto ciò che non è una lettera");
  assert.equal(proposePrefix("Acme 2026 Industrie"), "AI", "le cifre separano");
});

test("prefisso: con una parola le prime 3 lettere", () => {
  assert.equal(proposePrefix("Acme"), "ACM");
  assert.equal(proposePrefix("tetra"), "TET");
  assert.equal(proposePrefix("AI"), "AI", "due lettere bastano");
});

test("prefisso: accenti e lettere latine senza accento separabile", () => {
  assert.equal(proposePrefix("Società Èlite Ölmaşa"), "SEO");
  assert.equal(proposePrefix("Ōsaka"), "OSA");
  assert.equal(proposePrefix("Straße Øresund"), "SO");
  assert.equal(proposePrefix("Ærø"), "AER");
  assert.deepEqual(prefixWords("Perù e Città"), ["peru", "citta"]);
});

test("prefisso: parole vuote tolte, anche come sigle puntate", () => {
  assert.deepEqual(PREFIX_STOP_WORDS, ["di", "e", "la", "il", "the", "srl", "spa"]);
  assert.equal(proposePrefix("Il Forno di Lucca"), "FL");
  assert.equal(proposePrefix("The Example Company"), "EC");
  assert.equal(proposePrefix("Rossi e Bianchi Srl"), "RB");
  assert.equal(proposePrefix("Rossi S.p.A."), "ROS", "S.p.A. è una parola vuota: resta una parola");
  assert.equal(proposePrefix("Verdi S.r.l"), "VER");
  assert.equal(proposePrefix("LA SPA"), FALLBACK_CODE_PREFIX, "solo parole vuote");
  assert.equal(proposePrefix("Bianchi s.r.l. e Figli"), "BF");
});

test("prefisso: una sigla puntata che non è una parola vuota resta lettere separate (§10.6)", () => {
  assert.equal(proposePrefix("A.B.C. Consulenze"), "ABC");
  assert.deepEqual(prefixWords("A.B.C. Consulenze"), ["a", "b", "c", "consulenze"]);
  assert.equal(proposePrefix("J.P. Esempio"), "JPE");
  assert.equal(proposePrefix("X.Y."), "XY");
  // Accanto a una parola vuota puntata: solo «S.p.A.» si unisce.
  assert.equal(proposePrefix("A.B. Servizi S.p.A."), "ABS");
});

test("prefisso: meno di 2 lettere dà UC", () => {
  assert.equal(FALLBACK_CODE_PREFIX, "UC");
  for (const name of ["", "   ", "X", "2026", "--- ***", "日本語", "e", null, undefined]) {
    assert.equal(proposePrefix(name), "UC", String(name));
  }
});

test("prefisso: sempre accettato dal CHECK della 0019", () => {
  for (const name of ["Acme", "Società Èlite", "x y", "a", "Banca Popolare Esempio", "!!", "Ærø", "the e di", "Mega-Corp 3000"]) {
    const prefix = proposePrefix(name);
    assert.match(prefix, /^[A-Z]{2,4}$/, name);
    assert.equal(isValidCodePrefix(prefix), true);
  }
  assert.equal(isValidCodePrefix("ab"), false);
  assert.equal(isValidCodePrefix("ABCDE"), false);
  assert.equal(isValidCodePrefix(12), false);
});

test("slug: minuscole senza accenti, il resto diventa «-», al massimo 40 caratteri", () => {
  assert.equal(proposeSlug("Società Èlite S.p.A.", [], WS), "societa-elite-s-p-a");
  assert.equal(proposeSlug("  Acme   Industrie  ", [], WS), "acme-industrie");
  const long = proposeSlug("Banca Popolare Esempio del Nord Ovest e delle Isole", [], WS);
  assert.ok(long.length <= 40, long);
  assert.equal(long, "banca-popolare-esempio-del-nord-ovest-e");
  assert.ok(!long.endsWith("-"));
});

test("slug: già usato → -2, -3, entro 40 caratteri", () => {
  assert.equal(proposeSlug("Acme", ["acme"], WS), "acme-2");
  assert.equal(proposeSlug("Acme", ["ACME", "acme-2"], WS), "acme-3");
  const name = "x".repeat(60);
  const taken = ["x".repeat(40)];
  assert.equal(proposeSlug(name, taken, WS), `${"x".repeat(38)}-2`);
  assert.equal(proposeSlug(name, [...taken, `${"x".repeat(38)}-2`], WS), `${"x".repeat(38)}-3`);
});

test("slug: troppo corto → ws- più i primi 8 caratteri dell'id", () => {
  assert.equal(proposeSlug("AI", [], WS), "ws-3f2a9c1e");
  assert.equal(proposeSlug("!!!", [], WS), "ws-3f2a9c1e");
  assert.equal(proposeSlug("", [], WS), "ws-3f2a9c1e");
  assert.equal(proposeSlug(null, [], WS), "ws-3f2a9c1e");
  assert.equal(proposeSlug("日本", ["ws-3f2a9c1e"], WS), "ws-3f2a9c1e-2");
});

test("slug: sempre accettato dal CHECK della 0019", () => {
  for (const name of ["Acme", "AI", "", "Società", "x".repeat(80), "a-b", "--a--", "日本語"]) {
    for (const taken of [[], [proposeSlug(name, [], WS)]]) {
      const slug = proposeSlug(name, taken, WS);
      assert.equal(isValidWorkspaceSlug(slug), true, `${name} → ${slug}`);
    }
  }
  assert.equal(isValidWorkspaceSlug("ab"), false);
  assert.equal(isValidWorkspaceSlug("Acme"), false);
});

test("slug di un workspace nuovo: nome troncato più l'id, unico anche con due nomi uguali", () => {
  const a = slugForNewWorkspace("Acme Industrie", WS);
  const b = slugForNewWorkspace("Acme Industrie", WS_2);
  assert.equal(a, "acme-industrie-3f2a9c1e");
  assert.equal(b, "acme-industrie-9b7d0e44");
  assert.notEqual(a, b);
  const long = slugForNewWorkspace("Banca Popolare Esempio del Nord Ovest", WS);
  assert.equal(long, "banca-popolare-esempio-del-nord-3f2a9c1e");
  assert.ok(long.length <= 40);
  // Un nome di soli simboli o di lettere che non si scrivono in ASCII.
  assert.equal(slugForNewWorkspace("!!! ***", WS), "ws-3f2a9c1e");
  assert.equal(slugForNewWorkspace("日本語", WS), "ws-3f2a9c1e");
  assert.equal(slugForNewWorkspace("Città", WS), "citta-3f2a9c1e");
  for (const name of ["Acme", "", "x".repeat(100), "-", "Società Èlite"]) {
    assert.equal(isValidWorkspaceSlug(slugForNewWorkspace(name, WS)), true, name);
  }
});
