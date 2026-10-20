import test from "node:test";
import assert from "node:assert/strict";
import { costKind, leverKey, needsRetyping, planSeed, SEED_REASONS, templateLocks, type PlanSeedOptions, type SeedPlan } from "./plan.ts";
import { validateSeed, type CaseSeed } from "./schema.ts";
import { fakeRedact, fakeScan, SAMPLE_NAMES, sampleSeed, sampleTemplate } from "./seed.fixtures.ts";

const OPTS: PlanSeedOptions = { scan: fakeScan, redact: fakeRedact, names: SAMPLE_NAMES, roleAliases: { vendite: "resp_vendite" } };

function plan(over: Partial<PlanSeedOptions> = {}, seed: CaseSeed = sampleSeed(), template = sampleTemplate()): SeedPlan {
  return planSeed(seed, template, { ...OPTS, ...over });
}

function accepted(over: Partial<PlanSeedOptions> = {}): SeedPlan {
  const first = plan(over);
  return plan({ ...over, acceptScan: first.scan.sha256 });
}

test("the sample seed is valid", () => {
  const r = validateSeed(sampleSeed());
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.issues));
});

test("states come from initial_state, with reasons on missing items", () => {
  const p = plan();
  assert.deepEqual(p.errors, []);
  assert.equal(p.counts.questions, 8);
  assert.deepEqual(p.counts.by_state, { da_chiedere: 2, in_verifica: 3, bloccata: 2, mancante: 1 });
  assert.deepEqual(p.counts.by_area, {
    operativo: { da_chiedere: 1, in_verifica: 0, bloccata: 2, mancante: 1 },
    vendite: { da_chiedere: 1, in_verifica: 3, bloccata: 0, mancante: 0 },
  });
  const byKey = new Map(p.items.map((i) => [i.key, i]));
  assert.equal(byKey.get("q.operativo.03")?.status, "mancante");
  assert.equal(byKey.get("q.operativo.03")?.status_reason, SEED_REASONS.mancante_dichiarato);
  assert.equal(byKey.get("q.vendite.01")?.status_reason, null);
  assert.equal(byKey.get("q.operativo.01")?.status_reason, SEED_REASONS.valore_personale);
  assert.ok(p.warnings.some((w) => w.code === "domande_senza_stato" && w.key === "q.operativo.05"));
});

test("declared values become v1 answers with sources, never personal or held ones", () => {
  const p = plan();
  const byKey = new Map(p.answers.map((a) => [a.item_key, a]));
  assert.deepEqual([...byKey.keys()].sort(), ["q.operativo.03", "q.operativo.04", "q.vendite.01", "q.vendite.02", "q.vendite.03"]);
  const first = byKey.get("q.vendite.01");
  assert.deepEqual(first, {
    item_key: "q.vendite.01",
    version: 1,
    kind: "valore",
    value: { text: "Circa 40 al giorno (F001, F014a; poi E1)" },
    value_normalized: null,
    source_kind: "dichiarato_in_call",
    source_ref: "F001, F014a, E1",
    confidence: "da_verificare",
    responder_user_id: null,
    needs_retyping: false,
  });
  assert.equal(byKey.get("q.vendite.02")?.source_ref, "F-M3");
  assert.equal(byKey.get("q.vendite.03")?.source_ref, "dichiarato in call (fonte non indicata)");
  // Prosa su un tipo tipizzato: niente «Confermo».
  assert.equal(byKey.get("q.vendite.02")?.needs_retyping, true);
  assert.equal(byKey.get("q.vendite.03")?.needs_retyping, true);
  assert.equal(byKey.get("q.operativo.03")?.needs_retyping, true);
  assert.equal(byKey.get("q.operativo.04")?.needs_retyping, false);
  assert.deepEqual(p.counts.retyping, { total: 3, by_state: { da_chiedere: 1, in_verifica: 1, bloccata: 0, mancante: 1 } });
  assert.deepEqual(p.counts.answers.by_state, { da_chiedere: 2, in_verifica: 2, bloccata: 0, mancante: 1 });
  // Personale: nessun valore in chiaro da nessuna parte nelle risposte.
  assert.ok(!JSON.stringify(p.answers).includes("Paolo"));
  assert.deepEqual(p.omitted, [
    { item_key: "q.vendite.04", categoria: "sanitario" },
    { item_key: "q.operativo.01", categoria: "personale" },
  ]);
  assert.deepEqual(p.counts.omitted, { sanitario: 1, personale: 1 });
  assert.deepEqual(p.personalAnswers, []);
});

test("the scan report holds health values until its sha256 is approved", () => {
  const p = plan();
  assert.equal(p.scan.accepted, false);
  assert.equal(p.scan.valuesHeld, 1);
  assert.equal(p.items.find((i) => i.key === "q.vendite.04")?.status, "in_verifica", "the state never changes");
  assert.equal(p.items.find((i) => i.key === "q.vendite.04")?.status_reason, SEED_REASONS.valore_omesso);
  // Il testo d'esempio con «visita medica» nella descrizione ferma l'apply.
  assert.equal(p.scan.textsHeld, 1);
  assert.equal(p.scan.applyBlocked, true);
  assert.equal(p.case.settings.seed.scan_report_sha256, null);

  const report = JSON.stringify(p.scan.report);
  for (const leaked of ["vaccino", "visita", "certificato", "Giulia", "Paolo", "esempio.test"]) assert.ok(!report.includes(leaked), `report leaks ${leaked}`);
  assert.deepEqual(
    p.scan.report.entries.map((e) => [e.kind, e.ref, e.categoria, e.esito, e.trattiene]),
    [
      ["testo", "description.cosa_non_fa[0]", "sanitario", "blocca", true],
      ["valore", "q.operativo.04", "sanitario", "avviso", false],
      ["valore", "q.vendite.04", "sanitario", "blocca", true],
    ],
  );
  assert.match(p.scan.sha256, /^[0-9a-f]{64}$/);
  assert.equal(plan().scan.sha256, p.scan.sha256, "the report hash is deterministic");

  const ok = plan({ acceptScan: p.scan.sha256.toUpperCase() });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.scan.accepted, true);
  assert.equal(ok.scan.valuesHeld, 0);
  assert.equal(ok.scan.applyBlocked, false);
  assert.ok(ok.answers.some((a) => a.item_key === "q.vendite.04"));
  assert.equal(ok.case.settings.seed.scan_report_sha256, p.scan.sha256);
  assert.equal(ok.items.find((i) => i.key === "q.vendite.04")?.status_reason, null);

  const wrong = plan({ acceptScan: "0".repeat(64) });
  assert.ok(wrong.errors.some((e) => e.code === "report_diverso"));
  assert.equal(wrong.ok, false);
  assert.equal(wrong.scan.accepted, false);
});

test("a health-rule question only warns on the terms of its own question", () => {
  const p = plan();
  assert.ok(p.answers.some((a) => a.item_key === "q.operativo.04"));
  const seed = sampleSeed();
  seed.answers = seed.answers.map((a) => (a.item_key === "q.operativo.04" ? { ...a, known_value: "Mai i dati sulle malattie" } : a));
  const held = plan({}, seed);
  assert.ok(!held.answers.some((a) => a.item_key === "q.operativo.04"), "a health term that is not in the question blocks");
});

test("names, emails and phones are redacted everywhere before the scan, codes never", () => {
  const p = accepted();
  const json = JSON.stringify({ c: p.case, m: p.maps, r: p.roi, ms: p.milestones, a: p.answers });
  assert.ok(!json.includes("Giulia"));
  assert.ok(!json.includes("@esempio.test"));
  assert.match(String(p.case.description.in_breve), /Referente: \[referente\], \[referente\]\./);
  assert.equal(p.case.client_owner_role_label, "Responsabile vendite");
  assert.ok(p.redactions >= 2);
  assert.equal(p.scan.report.redactions, p.redactions);

  // Un nome che coincide con un pezzo di chiave non tocca chiavi e codici.
  const r = plan({ names: ["durata"] }, sampleSeed(), sampleTemplate({ map: null }));
  const solution = r.maps.find((m) => m.kind === "soluzione");
  assert.ok(solution?.graph.nodes[0].items.includes("richiesta.durata"), "item keys are read before the redaction");
  assert.deepEqual(r.maps.find((m) => m.kind === "processo_as_is")?.graph.nodes[0].dati, ["richiesta.durata", "x.assente"]);
});

test("the names file changes the report hash", () => {
  assert.notEqual(plan().scan.sha256, plan({ names: [] }).scan.sha256);
});

test("personal values are prepared for encryption only on request", () => {
  const p = plan({ includePersonalValues: true });
  assert.deepEqual(p.personalAnswers.map((a) => [a.item_key, a.encrypt, a.value.text]), [["q.operativo.01", true, "La segue [referente] (F005)"]]);
  assert.ok(!p.answers.some((a) => a.item_key === "q.operativo.01"));
  assert.equal(p.counts.omitted.personale, undefined);
  assert.equal(p.counts.personal_answers, 1);
});

test("the seed cannot open a lock or invent one", () => {
  const unlocked = sampleSeed();
  unlocked.answers = unlocked.answers.map((a) => (a.item_key === "q.operativo.01" ? { ...a, initial_state: "da_chiedere", blocked_by: [] } : a));
  assert.ok(plan({}, unlocked).errors.some((e) => e.code === "lucchetto_aperto" && e.key === "q.operativo.01"));

  const invented = sampleSeed();
  invented.answers = invented.answers.map((a) => (a.item_key === "q.vendite.03" ? { ...a, initial_state: "bloccata" } : a));
  assert.ok(plan({}, invented).errors.some((e) => e.code === "blocco_senza_motivo"));

  const extra = sampleSeed();
  extra.answers = extra.answers.map((a) => (a.item_key === "q.operativo.02" ? { ...a, blocked_by: ["a8", "accesso_sistema"] } : a));
  const e = plan({}, extra);
  assert.ok(e.errors.some((x) => x.code === "blocco_non_previsto"));
  assert.ok(e.errors.some((x) => x.code === "blocco_non_dichiarato" && x.key === "accesso_sistema"));
});

test("template mismatch, unknown items and unknown blockers are errors", () => {
  assert.ok(plan({}, sampleSeed(), sampleTemplate({ version: "1.1.0" })).errors.some((e) => e.code === "template_diverso"));
  const unknown = sampleSeed();
  unknown.answers = [...unknown.answers, { item_key: "q.vendite.99", initial_state: "da_chiedere", known_value: null, known_value_source_kind: null, blocked_by: [] }];
  assert.ok(plan({}, unknown).errors.some((e) => e.code === "voce_assente" && e.key === "q.vendite.99"));
  const notQuestion = sampleTemplate();
  const t = { ...notQuestion, items: notQuestion.items.map((i) => (i.key === "q.vendite.01" ? { ...i, kind: "campo" } : i)) };
  assert.ok(plan({}, sampleSeed(), t).errors.some((e) => e.code === "non_domanda"));
  const blockers = sampleSeed();
  blockers.blockers = [...blockers.blockers, { key: "costi_art_8_4", status: "aperto" }];
  assert.ok(plan({}, blockers).errors.some((e) => e.code === "blocco_assente"));
});

test("case fields, contract references, roles and description blocks", () => {
  const p = accepted();
  assert.equal(p.case.code, "ES-UC-01");
  assert.equal(p.case.status, "raccolta");
  assert.equal(p.case.data_controller_label, null);
  assert.deepEqual(p.case.contract_refs, ["art. 5.1", "All. B"]);
  assert.deepEqual(plan({ extraContractRefs: [" art. 9 ", "art. 5.1"] }).case.contract_refs, ["art. 5.1", "All. B", "art. 9"]);
  assert.deepEqual(p.case.settings.role_labels, { resp_vendite: "Responsabile vendite", operativo: "Operativo" });
  assert.equal(p.case.settings.seed.hash, p.seedHash);
  assert.equal(p.case.description.version, 1);
  assert.equal(p.case.description.uso_previsto, null);
  assert.deepEqual(p.case.description.decisioni, []);
  assert.deepEqual(p.case.description.riferimenti, ["art. 5.1", "All. B"]);
  assert.deepEqual(p.workspace.search, { normalized: "esempio srl vendite", tokens: ["esempio", "srl", "vendite"] });
  assert.equal(p.counts.contract_refs, 2);
  const unknownRole = plan({ roleAliases: {} });
  assert.ok(unknownRole.warnings.some((w) => w.code === "ruolo_sconosciuto" && w.key === "vendite"));
});

test("maps: solution nodes join template items and seed KPIs, processes are ordered steps", () => {
  const p = accepted();
  assert.deepEqual(p.maps.map((m) => m.kind), ["soluzione", "processo_to_be", "processo_as_is", "esempio"]);
  const solution = p.maps[0];
  assert.equal(solution.title, "Mappa della soluzione d'esempio");
  assert.equal(solution.source, "import");
  assert.deepEqual(solution.graph.nodes[0].items, ["ent.richiesta", "kpi.vendite.tempo"]);
  assert.deepEqual(solution.graph.nodes[0].unresolved_refs, ["kpi.vendite.assente"]);
  assert.equal(solution.graph.nodes[0].label, "Arriva la richiesta");
  assert.equal(solution.graph.nodes[0].chi, "Cliente");
  assert.deepEqual(solution.graph.edges, [{ from: "blk.01", to: "blk.02", label: "richiesta pronta" }]);
  // Senza mappa nel template le voci si ricavano dai testi del blocco.
  const derived = plan({}, sampleSeed(), sampleTemplate({ map: null }));
  assert.deepEqual(derived.maps[0].graph.nodes[0].items, ["richiesta.durata", "kpi.vendite.tempo"]);

  const asIs = p.maps.find((m) => m.kind === "processo_as_is");
  assert.equal(asIs?.title, "Processo di oggi");
  assert.deepEqual(asIs?.graph.nodes.map((n) => [n.id, n.label, n.items, n.unresolved_refs]), [
    ["A1", "Legge l'email", ["richiesta.durata"], ["x.assente"]],
    ["A2", "Risponde", [], []],
  ]);
  assert.deepEqual(asIs?.graph.edges, [{ from: "A1", to: "A2", label: null }]);
  assert.equal(p.maps.find((m) => m.kind === "processo_to_be")?.graph.nodes[0].perimetro, "caso_commerciale");
  const example = p.maps.find((m) => m.kind === "esempio");
  assert.equal(example?.title, "Una richiesta dall'inizio alla fine");
  assert.deepEqual(example?.graph.nodes.map((n) => [n.id, n.items]), [
    ["passo_01", ["kpi.vendite.tempo"]],
    ["passo_02", []],
  ]);
  assert.deepEqual(p.counts.maps, {
    soluzione: { nodes: 2, edges: 1 },
    processo_to_be: { nodes: 1, edges: 0 },
    processo_as_is: { nodes: 2, edges: 1 },
    esempio: { nodes: 2, edges: 1 },
  });

  const broken = sampleSeed();
  broken.map.flussi = [{ da: "blk.01", a: "blk.09", etichetta: "x" }];
  assert.ok(plan({}, broken).errors.some((e) => e.code === "arco_senza_nodo"));
  const otherNodes = plan({}, sampleSeed(), sampleTemplate({ map: { nodes: [{ id: "blk.01" }] } }));
  assert.ok(otherNodes.warnings.some((w) => w.code === "mappa_diversa"));
});

test("ROI: estimate model with typed cost lines and lever lines", () => {
  const p = accepted();
  assert.equal(p.roi.status, "stima");
  assert.equal(p.roi.scenario, "base");
  assert.equal(p.roi.currency, "EUR");
  assert.equal(p.roi.includes_human_review_time, true);
  assert.deepEqual(p.roi.cost_lines.map((c) => [c.key, c.kind, c.value, c.status]), [
    ["costo_01", "una_tantum", null, "da_raccogliere"],
    ["costo_02", "ricorrente", null, "da_raccogliere"],
    ["costo_03", "escluso", null, "da_raccogliere"],
    ["costo_04", null, null, "da_raccogliere"],
  ]);
  assert.ok(p.warnings.some((w) => w.code === "tipo_costo" && w.path === "roi.costi[3].tipo"));
  assert.deepEqual(p.roi.benefit_lines.map((b) => [b.key, b.lever, b.inputs, b.unresolved_refs]), [
    ["tempo", "tempo", ["kpi.vendite.tempo"], []],
    ["nuove_capacita", "nuove_capacita", ["kpi.vendite.chiuse"], ["kpi.vendite.assente"]],
  ]);
  assert.deepEqual(Object.keys(p.roi.content).sort(), ["cosa_serve", "esempio", "formula_roi", "spiegazione"]);
  assert.deepEqual(p.counts.roi, { costs: 4, benefits: 2 });
});

test("milestones, blockers and aggregated events", () => {
  const p = accepted();
  assert.deepEqual(p.milestones.map((m) => [m.key, m.is_proposal, m.to_confirm, m.sort_order]), [
    ["fase_1", true, false, 0],
    ["fase_2", false, true, 1],
  ]);
  assert.deepEqual(p.blockers, [
    { key: "a8", status: "attivo" },
    { key: "sanitario", status: "permanente" },
  ]);
  assert.deepEqual(p.counts.blockers, { attivo: 1, permanente: 1 });
  assert.deepEqual(
    p.events.map((e) => e.type),
    ["voce.stato_importato", "seed.valore_omesso", "seed.applicato"],
  );
  assert.deepEqual(p.events[0].payload, { count: 8, counts: { da_chiedere: 2, in_verifica: 3, bloccata: 2, mancante: 1 } });
  assert.deepEqual(p.events[1].payload, { count: 1, categoria: "personale" });
  assert.deepEqual(p.events[2].payload, {
    hash: p.seedHash,
    scan_report_sha256: p.scan.sha256,
    counts: { da_chiedere: 2, in_verifica: 3, bloccata: 2, mancante: 1 },
    answers: 6,
  });
  // Nessun evento porta testi.
  assert.ok(!JSON.stringify(p.events).includes("Circa"));
});

test("the seed hash ignores key order and changes with the content", () => {
  const seed = sampleSeed();
  const reverse = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(reverse) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverse(x)])) : v;
  const reordered = reverse(seed) as CaseSeed;
  assert.notEqual(JSON.stringify(reordered), JSON.stringify(seed));
  assert.equal(planSeed(reordered, sampleTemplate(), OPTS).seedHash, plan().seedHash);
  const changed = sampleSeed();
  changed.case.title = "Altro titolo";
  assert.notEqual(plan({}, changed).seedHash, plan().seedHash);
});

test("small helpers", () => {
  assert.equal(leverKey("Nuove capacità"), "nuove_capacita");
  assert.equal(leverKey("Qualità"), "qualita");
  assert.equal(leverKey("Fortuna"), null);
  assert.equal(costKind("Una tantum (alla fine)"), "una_tantum");
  assert.equal(costKind("ricorrente (varia con l'uso)"), "ricorrente");
  assert.equal(costKind("escluso"), "escluso");
  assert.equal(needsRetyping("testo"), false);
  assert.equal(needsRetyping("tabella"), false);
  assert.equal(needsRetyping("durata"), true);
  assert.equal(needsRetyping(null), false);
  assert.deepEqual(templateLocks({ privacy_class: "personale_equipaggio", blocked_by: [] }), ["a8"]);
  // Like case creation: health data is under both a8 (rank ≥ personale) and the permanent health lock.
  assert.deepEqual(templateLocks({ privacy_class: "escluso_sanitario" }), ["a8", "sanitario"]);
  assert.deepEqual(templateLocks({ privacy_class: "nessuna", blocked_by: ["fuori_foundation", "a8"] }), ["a8", "fuori_foundation"]);
});

test("the seed cannot open a lock that comes from blocker scope (availability, perimeter)", () => {
  const blockers = [
    { key: "a8", scope: { privacy_classes: ["personale"], availability: ["dopo_a8"] } },
    { key: "accesso_sistema", scope: { availability: ["con_api_gestionale"] } },
    { key: "decisione_board", scope: { perimeters: ["evoluzione"] } },
    { key: "sanitario", scope: { privacy_classes: ["escluso_sanitario"] }, permanent: true },
  ];
  const base = { privacy_class: "nessuna" as const };
  assert.deepEqual(templateLocks({ ...base, availability: ["dopo_a8"] }, blockers), ["a8"]);
  assert.deepEqual(templateLocks({ ...base, availability: ["oggi_export", "con_api_gestionale"] }, blockers), ["accesso_sistema"]);
  assert.deepEqual(templateLocks({ ...base, perimeter: "evoluzione" }, blockers), ["decisione_board"]);
  // Even without a template blocker, the minimum a8 scope covers «dopo_a8».
  assert.deepEqual(templateLocks({ ...base, availability: ["dopo_a8"] }), ["a8"]);
  assert.deepEqual(templateLocks({ ...base, availability: ["oggi_export"] }, blockers), []);

  // End to end: a question locked only by availability cannot be seeded as da_chiedere.
  const template = sampleTemplate({
    blockers,
    items: sampleTemplate().items.map((i) => (i.key === "q.vendite.01" ? { ...i, availability: ["con_api_gestionale"] } : i)),
  });
  const p = plan({}, sampleSeed(), template);
  assert.ok(p.errors.some((e) => e.code === "lucchetto_aperto" && e.key === "q.vendite.01"));
  const evolution = sampleTemplate({
    blockers,
    items: sampleTemplate().items.map((i) => (i.key === "q.vendite.03" ? { ...i, perimeter: "evoluzione" as const } : i)),
  });
  assert.ok(plan({}, sampleSeed(), evolution).errors.some((e) => e.code === "lucchetto_aperto" && e.key === "q.vendite.03"));
});
