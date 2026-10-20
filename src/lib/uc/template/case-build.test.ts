import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildCaseRows,
  descriptionFromTemplate,
  initialCaseSettings,
  initialReadiness,
  matchTemplateBlockers,
  resolveGatePolicy,
  waiverCap,
  type CaseBuild,
} from "./case-build.ts";
import { planTemplateLoad, type CanonicalDefinition } from "./load.ts";
import type { TemplateBlocker } from "./schema.ts";

const exampleText = readFileSync(new URL("../../../../templates/uc/esempio.minimo/1.0.0.json", import.meta.url), "utf8");

function exampleDefinition(): CanonicalDefinition {
  const r = planTemplateLoad(exampleText);
  assert.ok(r.ok);
  return r.plan.definition;
}

function build(policy?: Parameters<typeof buildCaseRows>[1]["policy"], def = exampleDefinition()): CaseBuild {
  let n = 0;
  return buildCaseRows(def, { newId: () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`, policy });
}

const row = (b: CaseBuild, key: string) => {
  const found = b.items.find((i) => i.key === key);
  assert.ok(found, key);
  return found;
};
const blockersOf = (b: CaseBuild, key: string) => {
  const item = row(b, key);
  const byId = new Map(b.blockers.map((x) => [x.id, x.key]));
  return b.itemBlockers.filter((ib) => ib.item_id === item.id).map((ib) => `${byId.get(ib.blocker_id)}:${ib.origin}`);
};

test("every template item becomes a row with its key kept as template_item_key", () => {
  const b = build();
  assert.equal(b.items.length, 50);
  assert.equal(new Set(b.items.map((i) => i.id)).size, 50);
  for (const i of b.items) assert.equal(i.template_item_key, i.key);
  assert.equal(b.links.length, 49);
  assert.equal(b.blockers.length, 6);
  assert.deepEqual(b.milestones, []);
  const ids = new Set(b.items.map((i) => i.id));
  for (const l of b.links) assert.ok(ids.has(l.from_item_id) && ids.has(l.to_item_id));
});

test("canonical fields go to columns, the rest to spec", () => {
  const b = build();
  const canale = row(b, "richiesta.canale");
  assert.equal(canale.kind, "campo");
  assert.equal(canale.section, "modello_dati");
  assert.equal(canale.parent_item_id, row(b, "ent.richiesta").id);
  assert.equal(canale.response_type, "scelta");
  assert.ok(Array.isArray(canale.response_config.options));
  assert.deepEqual(canale.serves_for, ["modello", "backtest"]);
  assert.equal(canale.perimeter, "in_contratto");
  assert.equal(canale.in_gate_scope, false);
  assert.equal(canale.request_module_key, null);
  assert.equal(canale.status, "da_chiedere");

  const turni = row(b, "src.hr.turni");
  assert.deepEqual(turni.spec.blocked_by, ["a8"]);
  const def = exampleDefinition();
  const ruleDef = def.items.find((i) => i.key === "rule.servizio.urgenti_prima")!;
  ruleDef.notes = { privacy: "nota" };
  ruleDef.validations = [{ key: "v1", rule: "non vuota" }];
  ruleDef.unresolved_refs = ["par.mai_creato"];
  const rule = row(build(undefined, def), "rule.servizio.urgenti_prima");
  assert.deepEqual(rule.spec.notes, { privacy: "nota" });
  assert.deepEqual(rule.spec.validations, [{ key: "v1", rule: "non vuota" }]);
  assert.deepEqual(rule.spec.unresolved_refs, ["par.mai_creato"]);
  assert.equal(rule.spec.defaults_applied, undefined);
  assert.equal(row(b, "q.costi.01").requires_validity_period, true, "valuta needs a validity period");
  assert.equal(row(b, "q.costi.02").requires_validity_period, false);
  assert.deepEqual(row(b, "src.crm.richieste").source_refs, []);
});

test("questions in request modules are in the gate scope and receive the policy defaults", () => {
  const b = build();
  const q = row(b, "q.servizio.01");
  assert.equal(q.in_gate_scope, true);
  assert.equal(q.request_module_key, "m.servizio.base");
  assert.deepEqual(q.serves_for, ["modello"]);
  assert.equal(q.perimeter, "in_contratto");
  assert.deepEqual(q.spec.defaults_applied, ["serves_for", "perimeter"]);
  assert.equal(q.owner_role_key, "resp_servizio");
  assert.equal(b.counts.inGateScope, 16);
  assert.equal(b.counts.scopeTotal, 16);
  assert.equal(b.counts.g1Required, 7);
  assert.equal(b.counts.g1Should, 6);
});

test("blocked items: explicit blocked_by or scope, all kinds, sanitario permanent", () => {
  const b = build();
  assert.deepEqual(blockersOf(b, "ent.operatore"), ["a8:scope"]);
  assert.deepEqual(blockersOf(b, "src.hr.turni"), ["a8:template"]);
  assert.deepEqual(blockersOf(b, "operatore.turno"), ["a8:scope", "decisione_board:scope"]);
  assert.deepEqual(blockersOf(b, "operatore.dati_sanitari"), ["a8:scope", "sanitario:scope"]);
  assert.deepEqual(blockersOf(b, "operatore.competenze"), ["fuori_foundation:scope"]);
  assert.deepEqual(blockersOf(b, "src.crm.api_richieste"), ["accesso_sistema:scope"]);
  assert.deepEqual(blockersOf(b, "q.sistemi.05"), ["a8:template"]);
  assert.deepEqual(blockersOf(b, "richiesta.canale"), []);
  assert.equal(row(b, "q.sistemi.05").status, "bloccata");
  assert.equal(row(b, "operatore.dati_sanitari").status, "bloccata");

  const statuses = Object.fromEntries(b.blockers.map((x) => [x.key, x.status]));
  assert.deepEqual(statuses, {
    a8: "attivo",
    decisione_board: "attivo",
    fuori_foundation: "attivo",
    accesso_sistema: "attivo",
    costi_art_8_4: "attivo",
    sanitario: "permanente",
  });
  assert.equal(b.blockers.find((x) => x.key === "accesso_sistema")?.fallback_allowed, "export CSV autorizzato o tabella compilata a mano");

  assert.deepEqual(b.counts.byStatus, { da_chiedere: 41, bloccata: 9 });
  assert.deepEqual(b.counts.questions, { total: 16, da_chiedere: 15, bloccata: 1 });
  assert.deepEqual(b.counts.itemBlockersByKey.questions, { a8: 1 });
  assert.deepEqual(b.counts.itemBlockersByKey.others, { a8: 5, decisione_board: 2, fuori_foundation: 1, sanitario: 1, accesso_sistema: 1 });
  assert.equal(b.counts.itemBlockers, 11);
  assert.equal(b.counts.othersWithMultipleBlockers, 2);
});

test("blocker scope matching rules", () => {
  const blockers = [
    { key: "a8", label: "A8", scope: { privacy_classes: ["escluso_sanitario", "personale_equipaggio", "personale"], availability: ["dopo_a8"], real_data: true } },
    { key: "decisione_board", label: "Board", scope: { perimeters: ["evoluzione"] } },
    { key: "accesso_sistema", label: "API", scope: { availability: ["con_api"] } },
    { key: "costi_art_8_4", label: "Costi", scope: {} },
    { key: "sanitario", label: "Sanitari", scope: { privacy_classes: ["escluso_sanitario"] }, permanent: true },
  ] as TemplateBlocker[];
  const base = { kind: "campo" as const, privacyClass: "nessuna" as const, availability: [] as string[], perimeter: null, explicitBlockedBy: [] as string[] };
  assert.deepEqual(matchTemplateBlockers(base, blockers), []);
  assert.deepEqual(
    matchTemplateBlockers({ ...base, availability: ["oggi_export", "con_api"] }, blockers).map((m) => m.key),
    ["accesso_sistema"],
    "any availability token matches",
  );
  assert.deepEqual(matchTemplateBlockers({ ...base, perimeter: "evoluzione" }, blockers).map((m) => m.key), ["decisione_board"]);
  assert.deepEqual(matchTemplateBlockers({ ...base, perimeter: "in_contratto" }, blockers), []);
  assert.deepEqual(
    matchTemplateBlockers({ ...base, kind: "domanda", privacyClass: "escluso_sanitario" }, blockers).map((m) => m.key),
    ["a8", "sanitario"],
    "health class blocks questions too",
  );
  assert.deepEqual(matchTemplateBlockers({ ...base, explicitBlockedBy: ["costi_art_8_4"] }, blockers), [{ key: "costi_art_8_4", origin: "template" }]);
  assert.deepEqual(matchTemplateBlockers({ ...base, privacyClass: "personale", explicitBlockedBy: ["a8"] }, blockers), [{ key: "a8", origin: "template" }]);
});

test("gate policies: literal and union put every item in scope; literal applies no defaults", () => {
  const literal = build({ scope: "letterale" });
  assert.equal(literal.counts.inGateScope, 50);
  assert.equal(literal.counts.g1Required, 13);
  const q = row(literal, "q.servizio.01");
  assert.deepEqual(q.serves_for, []);
  assert.equal(q.perimeter, null);
  assert.equal(q.spec.defaults_applied, undefined);

  const union = build({ scope: "unione" });
  assert.equal(union.counts.inGateScope, 50);
  assert.equal(union.counts.g1Required, 7 + 13);
  assert.deepEqual(row(union, "q.servizio.01").serves_for, ["modello"]);

  for (const b of [build(), literal, union]) {
    assert.equal(b.counts.literalRequired, 13);
    assert.equal(b.counts.literalCoveredByQuestions, 6);
  }
  assert.deepEqual(resolveGatePolicy(exampleDefinition()), { scope: "request_modules", default_serves_for: ["modello"], default_perimeter: "in_contratto" });
  assert.equal(resolveGatePolicy(exampleDefinition(), { scope: "unione" }).scope, "unione");
});

test("parents come before their children, and sort_order keeps the template order", () => {
  const def = exampleDefinition();
  // Move the entities to the end of the template: their fields now come first.
  const entities = def.items.filter((i) => i.kind === "entita");
  const reordered: CanonicalDefinition = { ...def, items: [...def.items.filter((i) => i.kind !== "entita"), ...entities] };
  const b = build(undefined, reordered);
  const position = new Map(b.items.map((i, index) => [i.id, index]));
  for (const i of b.items) {
    if (i.parent_item_id) assert.ok(position.get(i.parent_item_id)! < position.get(i.id)!, `${i.key} after its parent`);
  }
  const canale = b.items.find((i) => i.key === "richiesta.canale")!;
  assert.equal(canale.sort_order, reordered.items.findIndex((i) => i.key === "richiesta.canale"));
});

test("the solution map is copied from the template, with item keys", () => {
  const b = build();
  assert.equal(b.maps.length, 1);
  const [map] = b.maps;
  assert.equal(map.kind, "soluzione");
  assert.equal(map.graph.nodes.length, 6);
  assert.equal(map.graph.edges.length, 6);
  assert.deepEqual(map.graph.nodes[0].items, ["ent.richiesta", "richiesta.canale", "richiesta.data_apertura", "src.crm.richieste"]);
});

test("ids come only from the injected generator", () => {
  let n = 0;
  const b = buildCaseRows(exampleDefinition(), { newId: () => `id-${n++}` });
  assert.equal(n, 50 + 6);
  assert.ok(b.items.every((i) => i.id.startsWith("id-")));
});

test("case blockers follow blockers.ts: a8 and sanitario added when missing, minimum a8 scope enforced", () => {
  const full = build();
  const def = exampleDefinition();
  const withoutMandatory: CanonicalDefinition = {
    ...def,
    blockers: def.blockers.filter((b) => b.key !== "sanitario").map((b) => (b.key === "a8" ? { ...b, scope: {} } : b)),
  };
  const b = build(undefined, withoutMandatory);
  assert.deepEqual(
    b.blockers.map((x) => `${x.key}:${x.status}`),
    ["a8:attivo", "decisione_board:attivo", "fuori_foundation:attivo", "accesso_sistema:attivo", "costi_art_8_4:attivo", "sanitario:permanente"],
  );
  assert.deepEqual((b.blockers.find((x) => x.key === "sanitario")?.scope as { privacy_classes?: string[] }).privacy_classes, ["escluso_sanitario"]);
  for (const key of ["ent.operatore", "operatore.turno", "operatore.dati_sanitari", "src.hr.turni", "q.sistemi.05"]) {
    assert.deepEqual(blockersOf(b, key), blockersOf(full, key), key);
  }
  assert.deepEqual(b.counts.itemBlockersByKey, full.counts.itemBlockersByKey);
  assert.deepEqual(b.counts.byStatus, full.counts.byStatus);
});

test("a custom blocker matcher can replace the built-in one", () => {
  let n = 0;
  const b = buildCaseRows(exampleDefinition(), { newId: () => `id-${n++}`, blockerMatcher: () => [] });
  assert.equal(b.itemBlockers.length, 0);
  assert.equal(b.counts.byStatus.bloccata, 0);
});

test("initial readiness, settings, description and waiver cap", () => {
  const b = build();
  assert.deepEqual(initialReadiness(b, new Date("2026-10-07T10:00:00Z")), {
    computed_at: "2026-10-07T10:00:00.000Z",
    catalog_revision: 0,
    scope_total: 16,
    per_stato: { da_chiedere: 15, bloccata: 1 },
    green_pct: 0,
    G1: { required: 7, ok: 0, ready: false, should: { total: 6, ok: 0 }, waivers: { used: 0, cap: 0 } },
    coverage_model: { literal_required: 13, covered_by_questions: 6, ok: 0 },
    gate_reconfirm: false,
  });
  assert.deepEqual(initialCaseSettings({ policy: b.policy, confidential: false, restricted: false }), {
    gate_policy: { scope: "request_modules", default_serves_for: ["modello"], default_perimeter: "in_contratto", confirmed: null },
    client_text: false,
  });
  assert.equal(initialCaseSettings({ policy: b.policy, confidential: true, restricted: true }).client_text, true);
  assert.equal(initialCaseSettings({ policy: b.policy, confidential: false, restricted: true }).client_text, true);
  assert.deepEqual(descriptionFromTemplate({ description: "In breve." }), { in_breve: "In breve." });
  assert.deepEqual(descriptionFromTemplate({ description: { problema: "x" } }), { problema: "x" });
  assert.equal(waiverCap(9), 0);
  assert.equal(waiverCap(10), 1);
  assert.equal(waiverCap(245), 24);
});
