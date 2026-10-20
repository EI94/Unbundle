// Test on the real private template (PIANO §4.2 and §4.6). The file is confidential
// and never in git: it is read from disk at run time, never imported, and the
// test is skipped when it is absent. Only counts are asserted, never contents.
//
//   UC_PRIVATE_TEMPLATE_FILE      raw template v1.0.0 (default: docs/casi-duso/… in this checkout)
//   UC_PRIVATE_ROLE_ALIASES_FILE  area → role key (default: templates/uc/aviazione.strategia_per_volo/role-aliases.json)
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildCaseRows, initialReadiness } from "./case-build.ts";
import { planTemplateLoad } from "./load.ts";
import { normalizeTemplate } from "./normalize.ts";
import { caseCreateBatches } from "../sql/case-create.ts";

const repo = (relative: string) => fileURLToPath(new URL(`../../../../${relative}`, import.meta.url));
const templatePath = process.env.UC_PRIVATE_TEMPLATE_FILE ?? repo("docs/casi-duso/template-aviazione-strategia-per-volo-v1.0.0.json");
const aliasesPath = process.env.UC_PRIVATE_ROLE_ALIASES_FILE ?? repo("templates/uc/aviazione.strategia_per_volo/role-aliases.json");
const available = existsSync(templatePath) && existsSync(aliasesPath);
const opts = { skip: available ? false : "private template or role aliases not available" };

const WS = "6f1c2b9e-3a4d-4e5f-8a7b-1c2d3e4f5a6b";

function load() {
  const raw = JSON.parse(readFileSync(templatePath, "utf8")) as unknown;
  const roleAliases = JSON.parse(readFileSync(aliasesPath, "utf8")) as Record<string, string>;
  const normalized = normalizeTemplate(raw, { roleAliases });
  assert.ok(normalized.ok);
  const text = `${JSON.stringify(normalized.template, null, 2)}\n`;
  return { normalized, text };
}

test("normalizer report on the real template matches the plan", opts, () => {
  const { normalized } = load();
  const c = normalized.report.counts;
  const expected: Record<string, number> = {
    response_conferma_regola: 110,
    response_conferma_formula: 7,
    response_riferimento_codice: 158,
    response_ref_entity_mentioned: 110,
    response_ref_entity_resolved: 108,
    // 76 «Non lo so…» plus the 3 «Non lo sappiamo»: one rule with the answers (`isDontKnowText`).
    options_non_lo_so_removed: 79,
    campo_unit_options: 212,
    privacy_null_default: 678,
    privacy_health_rule_question: 2,
    privacy_health_with_personal: 4,
    confidential: 1,
    availability_null: 1216,
    perimeter_free_text: 490,
    links_input: 7707,
    links_duplicate_removed: 18,
    links_self_removed: 7,
    links_flipped_source_entity: 207,
    links_from_rule_params: 159,
    rule_params_unresolved: 1,
    links_cardinality_input: 326,
    links_total: 7841,
    question_owner_role: 477,
    module_role_key: 33,
    module_role_dropped: 33,
    module_estimated_minutes: 33,
    map_edges_converted: 41,
    gate_policy_default: 1,
    items: 2812,
    modules: 33,
  };
  for (const [name, value] of Object.entries(expected)) assert.equal(c[name], value, name);
  assert.equal(c.links_flip_collision, undefined, "no collision when flipping source → entity links");
  assert.deepEqual(normalized.report.privacy_classes, {
    escluso_sanitario: 0,
    personale_equipaggio: 114,
    personale: 133,
    riservato_azienda: 1215,
    nessuna: 1350,
  });
  const lists = normalized.report.lists;
  assert.equal(lists.health_rule_questions.length, 2);
  assert.ok(lists.health_rule_questions.every((k) => k.startsWith("q.")));
  assert.equal(lists.health_with_personal.length, 4);
  assert.ok(lists.health_with_personal.every((k) => k.startsWith("src.")));
  assert.equal(lists.map_nodes_without_items.length, 2);
  assert.equal(lists.unresolved_rule_params.length, 1);
  assert.equal(lists.unresolved_question_areas.length, 0);
  assert.equal(lists.unresolved_module_roles.length, 0);
  assert.deepEqual(lists.dropped_root_fields, []);
});

test("the normalized real template is valid, confidential and loadable only with a workspace", opts, () => {
  const { text } = load();
  assert.ok(Buffer.byteLength(text) < 8 * 1024 * 1024);
  const refused = planTemplateLoad(text);
  assert.equal(refused.ok ? null : refused.code, "template_riservato");
  const planned = planTemplateLoad(text, { restrictToWorkspaceId: WS });
  assert.ok(planned.ok, planned.ok ? "" : JSON.stringify(planned.errors.slice(0, 5)));
  const s = planned.plan.stats;
  assert.equal(s.items, 2812);
  assert.equal(s.links, 7841);
  assert.equal(s.questions, 477);
  assert.equal(s.mustQuestions, 245);
  assert.equal(s.modules, 33);
  assert.deepEqual(s.byKind, {
    entita: 61,
    campo: 1503,
    kpi: 184,
    decisione: 21,
    parametro: 114,
    vincolo_rigido: 47,
    vincolo_morbido: 17,
    obiettivo: 10,
    incertezza: 20,
    uscita: 32,
    formula: 19,
    regola: 165,
    fonte: 93,
    controllo_qualita: 49,
    domanda: 477,
    documento: 0,
  });
  assert.equal(planned.plan.confidential, true);
  const again = planTemplateLoad(load().text, { restrictToWorkspaceId: WS });
  assert.ok(again.ok);
  assert.equal(again.plan.hash, planned.plan.hash, "deterministic normalization and hash");
});

test("case creation from the real template: 2812 items, 7841 links, 508 + 19 blocker rows", opts, () => {
  const planned = planTemplateLoad(load().text, { restrictToWorkspaceId: WS });
  assert.ok(planned.ok);
  let n = 0;
  const newId = () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`;
  const build = buildCaseRows(planned.plan.definition, { newId });
  const c = build.counts;
  assert.equal(c.items, 2812);
  assert.equal(c.links, 7841);
  assert.equal(c.blockers, 6);
  assert.deepEqual(c.questions, { total: 477, da_chiedere: 458, bloccata: 19 });
  assert.deepEqual(c.byStatus, { da_chiedere: 458 + 1865, bloccata: 19 + 470 });
  assert.deepEqual(c.itemBlockersByKey.questions, { a8: 19 });
  assert.deepEqual(c.itemBlockersByKey.others, { a8: 307, accesso_sistema: 120, decisione_board: 57, fuori_foundation: 24 });
  assert.equal(c.itemBlockers, 508 + 19);
  assert.equal(c.othersWithMultipleBlockers, 38);
  assert.equal(c.inGateScope, 477);
  assert.equal(c.scopeTotal, 477);
  assert.equal(c.g1Required, 245);
  assert.equal(c.literalRequired, 484);
  assert.equal(c.literalCoveredByQuestions, 181);
  assert.equal(build.blockers.find((b) => b.key === "sanitario")?.status, "permanente");
  assert.equal(build.items.filter((i) => i.privacy_class === "escluso_sanitario").length, 0);
  const healthRule = build.items.filter((i) => i.spec.health_rule_question === true);
  assert.equal(healthRule.length, 2);
  assert.ok(healthRule.every((i) => i.status === "da_chiedere" && i.privacy_class === "riservato_azienda"));

  const readiness = initialReadiness(build, new Date(0)) as { G1: { waivers: { cap: number } } };
  assert.equal(readiness.G1.waivers.cap, 24);
  assert.equal(buildCaseRows(planned.plan.definition, { newId, policy: { scope: "letterale" } }).counts.g1Required, 484);
  assert.equal(buildCaseRows(planned.plan.definition, { newId, policy: { scope: "unione" } }).counts.g1Required, 729);

  const batches = caseCreateBatches(
    {
      caseId: newId(),
      workspaceId: WS,
      templateId: newId(),
      templateHash: planned.plan.hash,
      templateKey: planned.plan.key,
      templateVersion: planned.plan.version,
      code: "PROVA-01",
      title: "Prova",
      oneLiner: null,
      perimeterLabel: null,
      levers: [],
      portfolioUseCaseId: null,
      description: {},
      settings: {},
      actorUserId: newId(),
    },
    build,
    initialReadiness(build, new Date(0)),
  );
  // Header, 6 item chunks of 500, 4 link chunks of 2000, blockers with the map, final check.
  assert.equal(batches.length, 1 + 6 + 4 + 1 + 1);
});
