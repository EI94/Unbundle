import test from "node:test";
import assert from "node:assert/strict";
import {
  HARD_BLOCK_CATEGORIES,
  MAX_DEPTH,
  MAX_FINDINGS,
  MAX_LEAVES,
  SCAN_CATEGORIES,
  SCAN_CONTEXTS,
  findingMessage,
  findingsForLog,
  hasHardBlock,
  scanPayload,
  scanText,
  stringLeaves,
  summarizeFindings,
  walkStrings,
  type ScanOptions,
} from "./scan.ts";

const risposta: ScanOptions = { context: "risposta" };
const tags = (list: { category: string; term: string }[]) => list.map((f) => `${f.category}:${f.term}`);
const blocking = (text: string, opts: ScanOptions = risposta) => tags(scanText(text, opts).blocking);
const warnings = (text: string, opts: ScanOptions = risposta) => tags(scanText(text, opts).warnings);

test("health terms always block, in every context", () => {
  for (const context of SCAN_CONTEXTS) {
    assert.deepEqual(blocking("Serve la visita medica annuale", { context }), ["sanitario:visita medica"], context);
  }
  assert.deepEqual(blocking("Passeggero con disabilità"), ["sanitario:disabilita"]);
});

test("health rule questions: terms of the question only warn, unless near a person or a name", () => {
  const healthRuleQuestion = { questionText: "Quali dati sanitari escludete dai turni dell'equipaggio?" };
  const opts: ScanOptions = { context: "risposta", healthRuleQuestion };
  assert.deepEqual(blocking("Escludiamo tutti i dati sanitari", opts), []);
  assert.deepEqual(warnings("Escludiamo tutti i dati sanitari", opts), ["sanitario:sanitari"]);
  // Vicino a una persona o a un nome blocca sempre.
  assert.deepEqual(blocking("Escludiamo i dati sanitari del pilota", opts), ["sanitario:sanitari"]);
  assert.deepEqual(blocking("I dati sanitari di Mario restano fuori", opts), ["sanitario:sanitari"]);
  assert.deepEqual(blocking("i dati sanitari del primo ufficiale", opts), ["sanitario:sanitari"]);
  // Un termine sanitario che la domanda non contiene blocca.
  assert.deepEqual(blocking("Escludiamo le visite mediche", opts), ["sanitario:visita medica"]);
  // Nessuna esenzione senza domanda sulla regola.
  assert.deepEqual(blocking("Escludiamo tutti i dati sanitari"), ["sanitario:sanitari"]);
  // Nomi, date di nascita e codici fiscali restano bloccanti; e il termine sanitario vicino al nome pure.
  assert.deepEqual(blocking("Mario Rossi, nato il 01/02/1970, sanitari esclusi", opts), [
    "nome_persona:nome e cognome",
    "data_nascita:data di nascita",
    "sanitario:sanitari",
  ]);
  assert.deepEqual(blocking("RSSMRA80A01H501U e poi uno due tre quattro cinque sei sette: dati sanitari esclusi", opts), [
    "codice_fiscale:codice fiscale",
  ]);
});

test("discriminatory preferences block near the marker, not far from it", () => {
  assert.deepEqual(blocking("Il cliente preferisce solo piloti donne"), ["discriminatorio:donne"]);
  assert.deepEqual(blocking("Le donne in organico sono tre e lavorano su tutti i turni"), []);
  const f = scanText("vuole equipaggio femminile", risposta).blocking[0];
  assert.equal(f.detail, "genere");
});

test("names: name and surname block, an isolated name only warns", () => {
  assert.deepEqual(blocking("Chiedere a Mario Rossi"), ["nome_persona:nome e cognome"]);
  assert.deepEqual(blocking("Chiedere al sig. Bianchi"), ["nome_persona:titolo e cognome"]);
  assert.deepEqual(blocking("Chiedere a Mario"), []);
  assert.deepEqual(warnings("Chiedere a Mario"), ["nome_persona:nome proprio"]);
  assert.deepEqual(blocking("ne parla Zebedeo", { context: "risposta", names: ["Zebedeo"] }), ["nome_persona:nome di persona"]);
});

test("birth dates and tax codes always block", () => {
  for (const context of SCAN_CONTEXTS) {
    assert.deepEqual(blocking("nato il 12/03/1980", { context }), ["data_nascita:data di nascita"], context);
    assert.deepEqual(blocking("CF RSSMRA80A01H501U", { context }), ["codice_fiscale:codice fiscale"], context);
  }
});

test("emails and phones block in answers and test cases, warn elsewhere", () => {
  const text = "scrivere a ufficio@esempio.it o chiamare il 333 1234567";
  assert.deepEqual(blocking(text), ["contatto:email", "contatto:telefono"]);
  assert.deepEqual(blocking(text, { context: "caso_prova" }), ["contatto:email", "contatto:telefono"]);
  for (const context of ["commento", "seed", "testo_ls"] as const) {
    assert.deepEqual(blocking(text, { context }), [], context);
    assert.deepEqual(warnings(text, { context }), ["contatto:email", "contatto:telefono"], context);
  }
});

test("findings never contain the personal data, only the kind and its position", () => {
  const text = "Mario Rossi, mario.rossi@esempio.it, 333 1234567, RSSMRA80A01H501U, nato il 12/03/1980";
  const r = scanText(text, risposta);
  const serialized = JSON.stringify(r);
  for (const secret of ["Rossi", "mario.rossi", "1234567", "RSSMRA", "1980"]) assert.ok(!serialized.includes(secret), secret);
  for (const f of r.blocking) assert.ok(f.start >= 0 && f.end > f.start && f.end <= text.length);
  assert.equal(text.slice(r.blocking[0].start, r.blocking[0].end), "Mario Rossi");
});

test("clean texts and empty input give no findings", () => {
  for (const text of ["", "   ", "Il costo orario è di 1.750 € a volo, IVA esclusa.", "Atterriamo alle 22:15 con l'A320."]) {
    assert.deepEqual(scanText(text, risposta), { blocking: [], warnings: [] }, text);
  }
  assert.deepEqual(scanText(null as never, risposta), { blocking: [], warnings: [] });
});

test("results are sorted by position and capped", () => {
  const r = scanText("CF RSSMRA80A01H501U. Visita medica.", risposta);
  assert.deepEqual(tags(r.blocking), ["codice_fiscale:codice fiscale", "sanitario:visita medica"]);
  const many = scanText(Array.from({ length: 500 }, () => "farmaci").join(" "), risposta);
  assert.equal(many.blocking.length, MAX_FINDINGS);
});

test("long texts (extracted files) are scanned quickly", () => {
  const chunk = "Il volo parte alle 10:30, costo 1.750 € a volo, rientro con equipaggio in base. ";
  const text = chunk.repeat(20_000) + "visita medica";
  const started = Date.now();
  const r = scanText(text, { context: "testo_ls" });
  assert.deepEqual(tags(r.blocking), ["sanitario:visita medica"]);
  assert.ok(Date.now() - started < 5000, `${Date.now() - started} ms`);
});

test("stringLeaves walks every string with its path", () => {
  assert.deepEqual(stringLeaves({ text: "a", rows: [["b", 1], { c: "d" }], n: null }), [
    { path: "text", text: "a" },
    { path: "rows[0][0]", text: "b" },
    { path: "rows[1].c", text: "d" },
  ]);
  assert.deepEqual(stringLeaves("solo"), [{ path: "", text: "solo" }]);
  // With keys, every object key is a leaf too (array indexes are not).
  assert.deepEqual(walkStrings({ a: ["x"], b: { c: 1 } }, { keys: true }).leaves, [
    { path: "a#chiave", text: "a" },
    { path: "a[0]", text: "x" },
    { path: "b#chiave", text: "b" },
    { path: "b.c#chiave", text: "c" },
  ]);
});

test("scanPayload reads object keys too, and paths never carry the user's text", () => {
  const r = scanPayload({ rows: [{ "certificato medico": "si" }] }, { context: "risposta" });
  assert.deepEqual(r.blocking.map((f) => `${f.category}@${f.path}`), ["sanitario@rows[0].{0}#chiave"]);
  // A key that is user text becomes its position in the path, for keys and for values alike.
  const named = scanPayload({ note: { "Chiedere a Mario Rossi": "visita medica" } }, { context: "risposta" });
  assert.deepEqual(named.blocking.map((f) => `${f.category}@${f.path}`).sort(), ["nome_persona@note.{0}#chiave", "sanitario@note.{0}"]);
  assert.ok(!JSON.stringify(named.blocking.map((f) => f.path)).includes("Mario"));
});

test("scanPayload finds a term in a table cell, in who_might_know and in notes", () => {
  const table = { columns: [{ key: "voce", label: "Voce" }], rows: [["handling"], ["certificato medico"]] };
  assert.deepEqual(
    scanPayload(table, risposta).blocking.map((f) => [f.category, f.path]),
    [["sanitario", "rows[1][0]"]],
  );
  const nonSo = { who_might_know: "Mario Rossi dell'amministrazione" };
  assert.deepEqual(
    scanPayload(nonSo, risposta).blocking.map((f) => [f.category, f.path]),
    [["nome_persona", "who_might_know"]],
  );
  const withNote = { value: { amount: 3 }, note: "il cliente vuole solo hostess giovani" };
  assert.deepEqual(
    scanPayload(withNote, risposta).blocking.map((f) => [f.category, f.path]),
    [["discriminatorio", "note"]],
  );
});

test("scanPayload reads every cell of a full-size table and flags what it cannot read", () => {
  const rows = Array.from({ length: 2000 }, (_, i) => Array.from({ length: 50 }, (_, j) => `${i},${j}`));
  rows[1999][49] = "certificato medico";
  const r = scanPayload({ rows }, risposta);
  assert.deepEqual(
    r.blocking.map((f) => f.path),
    ["rows[1999][49]"],
  );
  assert.equal(r.truncated, false);
  let deep: unknown = "ok";
  for (let i = 0; i <= MAX_DEPTH; i++) deep = [deep];
  assert.equal(scanPayload(deep, risposta).truncated, true);
  const circular: Record<string, unknown> = { a: "testo" };
  circular.self = circular;
  assert.deepEqual(walkStrings(circular), { leaves: [{ path: "a", text: "testo" }], truncated: false });
  assert.ok(MAX_LEAVES >= 2000 * 50);
});

test("scanPayload exemptions apply only to the given path and categories", () => {
  const delega = { nome: "Mario Rossi", messaggio: "Ciao Mario Rossi, visita medica" };
  const r = scanPayload(delega, { context: "risposta", exempt: { nome: ["nome_persona"] } });
  assert.deepEqual(
    r.blocking.map((f) => [f.category, f.path]),
    [
      ["nome_persona", "messaggio"],
      ["sanitario", "messaggio"],
    ],
  );
  const health = scanPayload({ nome: "visita medica" }, { context: "risposta", exempt: { nome: ["nome_persona"] } });
  assert.deepEqual(
    health.blocking.map((f) => f.category),
    ["sanitario"],
  );
});

test("helpers: hard blocks, summaries, log view and messages", () => {
  assert.deepEqual(HARD_BLOCK_CATEGORIES, ["sanitario", "discriminatorio"]);
  const r = scanText("Mario Rossi chiede solo piloti donne, visita medica", risposta);
  assert.ok(hasHardBlock(r.blocking));
  assert.ok(!hasHardBlock(scanText("Mario Rossi", risposta).blocking));
  assert.deepEqual(summarizeFindings(r.blocking), { nome_persona: 1, discriminatorio: 1, sanitario: 1 });
  assert.deepEqual(findingsForLog([{ category: "sanitario", term: "medico", start: 0, end: 6, path: "text" }]), [
    { category: "sanitario", term: "medico", path: "text" },
  ]);
  for (const c of SCAN_CATEGORIES) assert.ok(findingMessage(c).length > 10, c);
  assert.match(findingMessage("discriminatorio"), /non si registrano/);
});
