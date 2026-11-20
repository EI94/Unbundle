import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseQuestionFilter, questionDefaults } from "./catalog-filter.ts";
import { questionFilterFields, questionKeptQuery, type QuestionFilterOptions } from "./question-bar.ts";
import { CONTACT } from "./view.fixtures.ts";

// (Rilascio 10, ondata 5a, §3.5) La barra di Domande: i campi del foglio «Filtri» del pezzo comune `FilterChips` per
// ogni pubblico, con «A posto» e «Documenti» diventati filtri, e i parametri che la barra tiene. Dati inventati.

const PREP = questionDefaults("raccolta", null, "ls");
const AFTER = questionDefaults("in_sviluppo", null, "ls");
const OPTIONS: QuestionFilterOptions = {
  contacts: [{ id: CONTACT, name: "Referente Demo" }],
  modules: [
    { key: "m.volumi", title: "Volumi e tempi" },
    { key: "m.sistemi", title: "Sistemi" },
  ],
  roles: [{ key: "resp_it", label: "Responsabile dei sistemi" }],
  contract: true,
  catalogSize: 2812,
  kindCounts: { domanda: 245, kpi: 12 },
  unassigned: 137,
};

test("Lateral Space: every filter of yesterday in the sheet, «A posto» and «Documenti» among them; «Senza referente (137)» replaces the line «… · Affida a… ›»", () => {
  const fields = questionFilterFields(parseQuestionFilter({}, "ls", PREP), PREP, "ls", OPTIONS);
  assert.deepEqual(
    fields.map((f) => f.key),
    ["referente", "argomento", "ruolo", "stato", "riservatezza", "perimetro", "indispensabili", "mostra"],
  );
  const by = (key: string) => fields.find((f) => f.key === key)!;
  assert.deepEqual(by("referente").options.map((o) => o.label), ["Senza referente (137)", "Referente Demo"]);
  assert.equal(by("referente").options[0].chip, "Senza referente");
  assert.equal(by("stato").options[0].label, "A posto");
  assert.ok(by("stato").options.some((o) => o.value === "validata" && o.label === "Validata"), "not two «A posto»");
  assert.deepEqual(by("mostra").options.map((o) => o.label), ["Documenti", "Tutto il catalogo (2.812)"]);
  assert.equal(by("mostra").placeholder, "Domande");
  assert.ok(fields.every((f) => f.value === null), "nothing active");
  const catalog = questionFilterFields(parseQuestionFilter({ mostra: "catalogo", tipo: "kpi" }, "ls", PREP), PREP, "ls", OPTIONS);
  const kind = catalog.find((f) => f.key === "tipo")!;
  assert.equal(kind.value, "kpi");
  assert.equal(kind.options.find((o) => o.value === "kpi")?.chip, "KPI");
});

test("the indispensable ones: the empty choice says the default, the other one changes it", () => {
  const prep = questionFilterFields(parseQuestionFilter({}, "ls", PREP), PREP, "ls", OPTIONS).find((f) => f.key === "indispensabili")!;
  assert.deepEqual([prep.placeholder, prep.value, prep.options.map((o) => `${o.value}:${o.label}`)], ["Solo le indispensabili", null, ["no:Anche le facoltative"]]);
  const wider = questionFilterFields(parseQuestionFilter({ indispensabili: "no" }, "ls", PREP), PREP, "ls", OPTIONS).find((f) => f.key === "indispensabili")!;
  assert.equal(wider.value, "no", "a chip «Domande: Anche le facoltative» with its ✕");
  const after = questionFilterFields(parseQuestionFilter({}, "ls", AFTER), AFTER, "ls", OPTIONS).find((f) => f.key === "indispensabili")!;
  assert.deepEqual([after.placeholder, after.options.map((o) => o.value)], ["Tutte", ["si"]]);
});

test("the client and the developer: only what they may use", () => {
  const client = questionFilterFields(parseQuestionFilter({}, "cliente", PREP), PREP, "cliente", OPTIONS);
  assert.deepEqual(client.map((f) => f.key), ["referente", "argomento", "ruolo", "stato", "perimetro", "indispensabili", "mostra"]);
  assert.deepEqual(client.find((f) => f.key === "referente")?.options.map((o) => o.value), ["nessuno"], "never one person (art. 15.4)");
  assert.deepEqual(client.find((f) => f.key === "stato")?.options.map((o) => o.label), ["A posto"]);
  assert.deepEqual(client.find((f) => f.key === "mostra")?.options.map((o) => o.label), ["Documenti"]);
  const dev = questionFilterFields(parseQuestionFilter({}, "sviluppatore", questionDefaults("in_sviluppo", null, "sviluppatore")), questionDefaults("in_sviluppo", null, "sviluppatore"), "sviluppatore", OPTIONS);
  assert.deepEqual(dev.map((f) => f.key), ["argomento", "mostra"]);
});

test("«Senza argomento» and a topic the schema no longer lists get a chip with a name, never a key", () => {
  const none = questionFilterFields(parseQuestionFilter({ argomento: "nessuno" }, "ls", PREP), PREP, "ls", OPTIONS).find((f) => f.key === "argomento")!;
  assert.equal(none.options.find((o) => o.value === "nessuno")?.label, "Senza argomento");
  const old = questionFilterFields(parseQuestionFilter({ argomento: "m.vecchio" }, "ls", PREP), PREP, "ls", OPTIONS).find((f) => f.key === "argomento")!;
  assert.equal(old.options.find((o) => o.value === "m.vecchio")?.label, "Altro argomento");
});

test("the bar keeps the view, the filters and the search; never the page or a panel", () => {
  const f = parseQuestionFilter({ vista: "da-verificare", argomento: "m.volumi", q: "richieste", pagina: "3", apri: "file" }, "ls", PREP);
  assert.deepEqual(questionKeptQuery(f, PREP), { vista: "da-verificare", argomento: "m.volumi", q: "richieste" });
  assert.deepEqual(questionKeptQuery(parseQuestionFilter({}, "ls", PREP), PREP), {});
});

test("`FilterChips` names the empty choice of a field when asked (an optional prop: every other use keeps «Tutti»)", () => {
  const source = readFileSync(new URL("../../../components/ui-10/filter-chips.tsx", import.meta.url), "utf8");
  assert.match(source, /placeholder\?: string;/);
  assert.match(source, /<option value="">\{field\.placeholder \?\? t\.all\}<\/option>/);
});
