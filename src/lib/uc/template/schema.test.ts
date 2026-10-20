import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ITEM_KINDS, LINK_RELATIONS } from "../vocab.ts";
import { duplicateJsonKeys, isDontKnowOption, parseTemplateText, TEMPLATE_LIMITS, validateTemplate, type TemplateValidation } from "./schema.ts";

const EXAMPLE_URL = new URL("../../../../templates/uc/esempio.minimo/1.0.0.json", import.meta.url);
const exampleText = readFileSync(EXAMPLE_URL, "utf8");

type Obj = Record<string, unknown>;
interface Raw extends Obj {
  items: Obj[];
  request_modules: Obj[];
  blockers: Obj[];
  gates: Obj[];
  map: { nodes: Obj[]; edges: Obj[] };
}
const example = (): Raw => JSON.parse(exampleText) as Raw;
const item = (t: Raw, key: string): Obj => {
  const found = t.items.find((i) => i.key === key);
  assert.ok(found, key);
  return found;
};
const codes = (v: TemplateValidation): string[] => (v.ok ? [] : v.errors.map((e) => e.code));
const warningCodes = (v: TemplateValidation): string[] => v.warnings.map((w) => w.code);

function expectError(mutate: (t: Raw) => void, code: string): void {
  const t = example();
  mutate(t);
  const v = validateTemplate(t);
  assert.equal(v.ok, false, `expected ${code}`);
  assert.ok(codes(v).includes(code), `expected ${code}, got ${codes(v).join(", ")}`);
}

test("the invented example is valid and exercises every kind, every relation and a passable G1", () => {
  const v = validateTemplate(example());
  assert.equal(v.ok, true, JSON.stringify(v.ok ? [] : v.errors.slice(0, 5)));
  if (!v.ok) return;
  for (const kind of ITEM_KINDS) assert.ok(v.stats.byKind[kind] > 0, `no ${kind}`);
  const relations = new Set(v.template.items.flatMap((i) => i.links.map((l) => l.rel)));
  assert.deepEqual([...relations].sort(), [...LINK_RELATIONS].sort());
  assert.equal(v.stats.modules, 3);
  assert.equal(v.template.blockers.length, 6);
  assert.equal(v.template.gates.length, 4);
  assert.equal(v.template.map.nodes.length, 6);
  assert.ok(v.stats.mustQuestions >= 6, "G1 needs at least 6 must questions");
  const mustOpen = v.template.items.filter((i) => i.kind === "domanda" && i.priority === "must" && i.blocked_by.length === 0);
  assert.ok(mustOpen.length >= 6, "must questions are not blocked, so G1 can open");
  assert.equal(v.template.confidential, false);
  assert.deepEqual(v.template.gate_policy, { scope: "request_modules", default_serves_for: ["modello"], default_perimeter: "in_contratto" });
  assert.deepEqual(warningCodes(v), []);
});

test("defaults are filled in by the schema", () => {
  const t = example();
  delete t.gate_policy;
  delete t.confidential;
  delete item(t, "f.tempo_risposta_medio").links;
  const v = validateTemplate(t);
  assert.equal(v.ok, true);
  if (!v.ok) return;
  assert.equal(v.template.confidential, false);
  assert.equal(v.template.gate_policy.scope, "request_modules");
  const f = v.template.items.find((i) => i.key === "f.tempo_risposta_medio");
  assert.deepEqual(f?.links, []);
  assert.deepEqual(f?.serves_for, []);
});

test("duplicate item keys are rejected", () => {
  expectError((t) => t.items.push({ ...item(t, "dv.team_assegnato") }), "chiave_doppia");
});

test("ID pattern violations are rejected", () => {
  expectError((t) => (item(t, "kpi.servizio.costo_per_richiesta").key = "kpi.costo"), "id_schema");
  expectError((t) => (item(t, "q.servizio.05").key = "q.servizio.5"), "id_schema");
  expectError((t) => (item(t, "cliente.segmento").parent = "ent.richiesta"), "id_campo_parent");
  expectError((t) => {
    const field = item(t, "cliente.segmento");
    field.key = "ordine.segmento";
    field.parent = "ent.ordine";
  }, "id_campo_entita");
  expectError((t) => (item(t, "par.soglia_urgenza_ore").kind = "decisione"), "id_schema");
});

test("disallowed relations are rejected", () => {
  expectError((t) => (item(t, "kpi.servizio.costo_per_richiesta").links as Obj[]).push({ rel: "controlla", to: "richiesta.canale" }), "relazione_non_ammessa");
  expectError((t) => (item(t, "q.servizio.01").links as Obj[]).push({ rel: "precisa", to: "q.servizio.02" }), "relazione_non_ammessa");
  expectError((t) => (item(t, "par.soglia_urgenza_minuti").links as Obj[]).push({ rel: "sostituisce", to: "dv.team_assegnato" }), "relazione_non_ammessa");
  expectError((t) => (item(t, "src.crm.richieste").links = [{ rel: "alimentato_da", to: "ent.richiesta" }]), "relazione_non_ammessa");
  expectError((t) => (item(t, "dv.team_assegnato").links as Obj[]).push({ rel: "include", to: "richiesta.canale" }), "formato");
});

test("dangling links, self links and repeated triples are rejected", () => {
  expectError((t) => (item(t, "dv.team_assegnato").links as Obj[]).push({ rel: "dipende_da", to: "richiesta.inesistente" }), "collegamento_assente");
  expectError((t) => (item(t, "dv.team_assegnato").links as Obj[]).push({ rel: "dipende_da", to: "dv.team_assegnato" }), "autoanello");
  expectError((t) => (item(t, "dv.team_assegnato").links as Obj[]).push({ rel: "dipende_da", to: "richiesta.priorita" }), "collegamento_doppio");
  expectError((t) => (item(t, "richiesta.canale").parent = "ent.inesistente"), "id_campo_parent");
});

test("request modules: one module per question, matching keys, known roles", () => {
  expectError((t) => (t.request_modules[1].items as string[]).push("q.servizio.01"), "domanda_in_piu_moduli");
  expectError((t) => (t.request_modules[0].items as string[]).splice(0, 1), "domanda_senza_modulo");
  expectError((t) => (t.request_modules[0].items as string[]).push("dv.team_assegnato"), "modulo_voce_non_domanda");
  expectError((t) => (t.request_modules[0].items as string[]).push("q.servizio.99"), "modulo_voce_assente");
  expectError((t) => (item(t, "q.servizio.01").request_module = "m.costi.base"), "domanda_modulo_diverso");
  expectError((t) => (t.request_modules[0].role_key = "ruolo_inesistente"), "ruolo_assente");
  expectError((t) => (t.request_modules[1].key = t.request_modules[0].key), "modulo_doppio");
  expectError((t) => (item(t, "dv.team_assegnato").request_module = "m.servizio.base"), "modulo_voce_non_domanda");
});

test("vocabularies, blockers and gates", () => {
  expectError((t) => (item(t, "richiesta.canale").availability = ["subito"]), "vocabolario");
  expectError((t) => ((t.vocabularies as Obj).priority = ["must"]), "vocabolario");
  expectError((t) => (item(t, "richiesta.canale").owner_role_key = "ruolo_inesistente"), "ruolo_assente");
  expectError((t) => (item(t, "richiesta.canale").blocked_by = ["inesistente"]), "blocco_assente");
  expectError((t) => delete t.blockers.find((b) => b.key === "sanitario")!.permanent, "sanitario_non_permanente");
  expectError((t) => ((t.vocabularies as Obj).serves_for = ["baseline", "modello", "backtest", "monitoraggio"]), "gate_fase");
  expectError((t) => (t.gates[0].approvers = ["ls_lead", "capo"]), "formato");
  expectError((t) => (item(t, "richiesta.canale").section = "roi"), "formato");
});

test("map nodes, edges and items must exist", () => {
  expectError((t) => (t.map.nodes[0].items as string[]).push("ent.inesistente"), "nodo_voce_assente");
  expectError((t) => t.map.edges.push({ from: "n1", to: "n9" }), "arco_assente");
  expectError((t) => (t.map.nodes[1].id = "n1"), "nodo_doppio");
});

test("response checks: choices, «Non lo so» and code patterns", () => {
  expectError((t) => ((item(t, "q.sistemi.07").response as Obj).config = { options: ["ogni giorno", "Non lo so"] }), "opzione_non_lo_so");
  expectError((t) => ((item(t, "q.sistemi.07").response as Obj).config = { options: ["ogni giorno"] }), "opzioni_insufficienti");
  expectError((t) => ((item(t, "q.sistemi.07").response as Obj).config = { options: ["a", "A"] }), "opzioni_doppie");
  expectError((t) => ((item(t, "q.sistemi.07").response as Obj).config = {}), "scelta_senza_opzioni");
  expectError((t) => ((item(t, "q.sistemi.04").response as Obj).config = { pattern: "([A-Z" }), "pattern_non_valido");
  expectError((t) => delete item(t, "q.sistemi.04").response, "domanda_senza_risposta");
  expectError((t) => ((item(t, "q.sistemi.04").response as Obj).type = "riferimento"), "formato");
  assert.equal(isDontKnowOption("Non lo so"), true);
  assert.equal(isDontKnowOption(" non  lo so."), true);
  assert.equal(isDontKnowOption("Non lo sappiamo ancora"), false);
  // One rule with the answers: what the template keeps can be chosen, what it drops is the «Non lo so» button.
  assert.equal(isDontKnowOption("Non lo sappiamo"), true);
  assert.equal(isDontKnowOption("Non lo so ancora"), true);
  assert.equal(isDontKnowOption({ value: "ns", label: "Non saprei" }), true);
  expectError((t) => ((item(t, "q.sistemi.07").response as Obj).config = { options: ["ogni giorno", "Non lo sappiamo"] }), "opzione_non_lo_so");
  // Code patterns are checked with the flags the answers use («u»): an escape valid only without it is refused.
  expectError((t) => ((item(t, "q.sistemi.04").response as Obj).config = { pattern: "^[A-Z]{2}\\-\\d{3}$" }), "pattern_non_valido");
});

test("a choice without options on a non-question item is only a warning", () => {
  const t = example();
  (item(t, "cliente.segmento").response as Obj).config = {};
  const v = validateTemplate(t);
  assert.equal(v.ok, true);
  assert.deepEqual(warningCodes(v), ["scelta_senza_opzioni"]);
});

test("warnings: empty module, question without links, unresolved references, dipende_da cycle", () => {
  const t = example();
  t.request_modules.push({ key: "m.vuoto", title: "Modulo vuoto", items: [] });
  item(t, "q.sistemi.06").links = [];
  item(t, "rule.servizio.urgenti_prima").unresolved_refs = ["par.mai_creato"];
  (item(t, "dv.team_assegnato").links as Obj[]).push({ rel: "dipende_da", to: "out.proposta_assegnazione" });
  const v = validateTemplate(t);
  assert.equal(v.ok, true, JSON.stringify(codes(v)));
  assert.deepEqual(warningCodes(v).sort(), ["ciclo_dipende_da", "domanda_senza_collegamenti", "modulo_vuoto", "riferimenti_non_collegati"]);
});

test("strict shape: a raw, non normalised item is refused", () => {
  expectError((t) => (item(t, "dv.team_assegnato").spiegazione = "campo grezzo"), "formato");
  expectError((t) => (t.schema = "unbundle.uc-template/2"), "formato");
  expectError((t) => (item(t, "dv.team_assegnato").priority = null), "formato");
  const v = validateTemplate({ schema: "unbundle.uc-template/1", key: "x.y", version: "1.0.0", items: [{ key: "ent.a", kind: "entita", perche: "x" }] });
  assert.equal(v.ok, false);
});

test("item limit", () => {
  const t = example();
  const filler = Array.from({ length: TEMPLATE_LIMITS.maxItems + 1 - t.items.length }, (_, i) => ({
    key: `dv.riempitivo_${i}`,
    kind: "decisione",
    section: "modello_dati",
    title: "Voce di riempimento",
    privacy_class: "nessuna",
  }));
  t.items.push(...filler);
  const v = validateTemplate(t);
  assert.equal(v.ok, false);
  assert.ok(codes(v).includes("formato"));
});

test("issues are capped and summarised", () => {
  const t = example();
  for (let i = 0; i < TEMPLATE_LIMITS.maxIssues + 10; i++) (item(t, "dv.team_assegnato").links as Obj[]).push({ rel: "dipende_da", to: `richiesta.assente_${i}` });
  const v = validateTemplate(t);
  assert.equal(v.ok, false);
  if (v.ok) return;
  assert.equal(v.errors.length, TEMPLATE_LIMITS.maxIssues + 1);
  assert.equal(v.errors.at(-1)?.code, "altri_problemi");
});

test("JSON text: duplicate object keys, invalid JSON and size limit", () => {
  assert.deepEqual(duplicateJsonKeys('{"a":1,"b":{"c":1,"c":2},"d":[{"e":1},{"e":2,"e":3}]}'), ["b.c", "d.1.e"]);
  assert.deepEqual(duplicateJsonKeys('{"a":"x\\"a","\\u0061":2}'), ["a"]);
  assert.deepEqual(duplicateJsonKeys(exampleText), []);
  const dup = parseTemplateText('{"key":"a","key":"b"}');
  assert.equal(dup.ok ? null : dup.code, "json_chiavi_ripetute");
  const bad = parseTemplateText("{");
  assert.equal(bad.ok ? null : bad.code, "json_non_valido");
  const big = parseTemplateText(`"${"x".repeat(TEMPLATE_LIMITS.maxBytes)}"`);
  assert.equal(big.ok ? null : big.code, "file_troppo_grande");
  const good = parseTemplateText(exampleText);
  assert.equal(good.ok, true);
});
