import test from "node:test";
import assert from "node:assert/strict";
import { findForbiddenIn } from "./copy-guard.ts";
import { rowToKpiRow } from "./kpi.ts";
import {
  buildRoiView,
  buildValueView,
  MISSING_QUESTIONS_SHOWN,
  missingText,
  parseBenefitLines,
  parseCostLines,
  parseLeverTexts,
  plainText,
  roiKpiKeys,
  valueFigures,
  valuePanel,
  type RoiView,
  type ValueView,
} from "./roi.ts";
import {
  EMPTY_ROI_TOTALS,
  computeRoi,
  costKindFromText,
  leverFromLabel,
  newBenefitLine,
  roiInputProblems,
  roiTotals,
  roiUpdateInput,
  sameRoiTotals,
  type BenefitLine,
  type CostLine,
} from "./roi-edit.ts";

/** Gli importi di `Intl` hanno uno spazio non divisibile prima di «€». */
const sp = (v: string | null) => (v === null ? null : v.replace(/\u00a0/g, " "));

const cost = (over: Partial<CostLine>): CostLine => ({
  key: "c",
  label: "Costo",
  kind: "una_tantum",
  tipoTesto: null,
  howEstimated: null,
  value: null,
  status: "da_raccogliere",
  source: null,
  authorized: null,
  itemKey: null,
  ...over,
});
const benefit = (over: Partial<BenefitLine>): BenefitLine => ({
  key: "tempo",
  lever: "tempo",
  leverLabel: "Tempo",
  formula: null,
  inputs: [],
  value: null,
  status: "da_raccogliere",
  source: null,
  howToEuro: null,
  dataNeeded: [],
  example: null,
  unresolvedRefs: [],
  ...over,
});

test("the ROI stays «to compute» until every value is there", () => {
  const r = computeRoi({ costLines: [cost({ label: "Progetto" }), cost({ key: "x", label: "Licenze", kind: null })], benefitLines: [benefit({})] });
  assert.equal(r.value, null);
  assert.deepEqual(r.missing, ["Costo da stimare: Progetto", "Tipo di costo da indicare: Licenze", "Beneficio da stimare: Tempo"]);
  assert.match(r.note, /Da calcolare/);
  assert.deepEqual(computeRoi({ costLines: [], benefitLines: [] }).missing, ["Nessuna riga di costo", "Nessuna riga di beneficio"]);
});

test("break-even in months and value over the horizon, with discount and adoption", () => {
  const lines = { costLines: [cost({ value: 40000 }), cost({ key: "r", kind: "ricorrente", value: 12000 }), cost({ key: "e", kind: "escluso", value: null })], benefitLines: [benefit({ value: 72000 })] };
  const r = computeRoi(lines);
  assert.equal(r.implementation, 40000);
  assert.equal(r.annualRun, 12000);
  assert.equal(r.annualBenefit, 72000);
  assert.equal(r.breakEvenMonths, 8);
  assert.equal(r.value, 5 * 60000 - 40000);
  assert.equal(r.discounted, false);
  const d = computeRoi({ ...lines, discountRate: 0.1, horizonYears: 2 });
  assert.equal(d.value, Math.round(60000 / 1.1 + 60000 / 1.21 - 40000));
  assert.equal(d.discounted, true);
  const half = computeRoi({ ...lines, adoptionRate: 0.5 });
  assert.equal(half.annualBenefit, 36000);
  const loss = computeRoi({ costLines: [cost({ value: 1000 }), cost({ key: "r", kind: "ricorrente", value: 5000 })], benefitLines: [benefit({ value: 4000 })] });
  assert.equal(loss.breakEvenMonths, null);
  assert.match(loss.note, /non rientra/);
});

test("lines from the seed, from the example template and from saved models", () => {
  const seedCosts = parseCostLines([{ key: "costo_01", label: "Licenze", kind: null, tipo_testo: "Ricorrente, annuo", how_estimated: "Preventivo", value: null, status: "da_raccogliere", source: "Fornitore", authorized_art_8_4: null }]);
  assert.equal(seedCosts[0].kind, "ricorrente");
  assert.equal(seedCosts[0].authorized, null);
  const tplCosts = parseCostLines([{ voce: "Progetto", tipo: "una tantum", come_si_stima: "Ore × tariffa", fonte: "Offerta" }, { voce: "Progetto 2", tipo: "boh" }]);
  assert.deepEqual(tplCosts.map((c) => [c.key, c.label, c.kind, c.howEstimated]), [["costo_01", "Progetto", "una_tantum", "Ore × tariffa"], ["costo_02", "Progetto 2", null, null]]);
  const tplBenefits = parseBenefitLines([{ leva: "Nuove capacità", kpi: ["kpi.a.b"], come_diventa_euro: "minuti × costo", formula: "a × b", dati_necessari: ["costo orario"], esempio_illustrativo: "10 € (inventato)" }]);
  assert.equal(tplBenefits[0].lever, "nuove_capacita");
  assert.equal(tplBenefits[0].key, "nuove_capacita");
  assert.deepEqual(tplBenefits[0].inputs, ["kpi.a.b"]);
  assert.deepEqual(tplBenefits[0].dataNeeded, ["costo orario"]);
  const example = parseBenefitLines([{ key: "tempo_risparmiato", lever: "tempo", formula: "x", kpis: ["kpi.servizio.tempo"], status: "dopo la baseline" }]);
  assert.equal(example[0].status, "da_raccogliere");
  assert.deepEqual(example[0].inputs, ["kpi.servizio.tempo"]);
  assert.equal(leverFromLabel("Qualità"), "qualita");
  assert.equal(leverFromLabel("Altro"), null);
  assert.equal(costKindFromText("Escluso: a carico del cliente"), "escluso");
});

test("saving keeps the case texts on the benefit lines and drops the legacy content.benefit_extras", () => {
  const lines = [benefit({ key: "tempo", leverLabel: "Tempo", dataNeeded: ["minuti"], example: "esempio", unresolvedRefs: ["kpi.x"] })];
  const input = roiUpdateInput({ costLines: [cost({ value: 10 })], benefitLines: lines, content: { spiegazione: "testo", benefit_extras: { tempo: { lever_label: "Vecchio" } } } });
  assert.deepEqual(Object.keys(input.benefitLines?.[0] ?? {}).sort(), [
    "data_needed",
    "example",
    "formula",
    "how_to_euro",
    "inputs",
    "key",
    "lever",
    "lever_label",
    "source",
    "status",
    "unresolved_refs",
    "value",
  ]);
  assert.deepEqual(input.content, { spiegazione: "testo" });
  assert.equal(roiUpdateInput({ costLines: [], benefitLines: null, content: { spiegazione: "x" } }).benefitLines, undefined);
  assert.equal(roiUpdateInput({ costLines: [], benefitLines: null, content: { spiegazione: "x" } }).content, undefined, "cost lines alone leave content as it is");
  const back = parseBenefitLines(input.benefitLines as never);
  assert.equal(back[0].leverLabel, "Tempo");
  assert.deepEqual(back[0].dataNeeded, ["minuti"]);
  assert.equal(back[0].example, "esempio");
  assert.deepEqual(back[0].unresolvedRefs, ["kpi.x"]);
  // Models saved before the fix still read their texts from benefit_extras.
  const legacy = parseBenefitLines([{ key: "tempo", lever: "tempo" }], { tempo: { lever_label: "Tempo", data_needed: ["minuti"] } });
  assert.equal(legacy[0].leverLabel, "Tempo");
  assert.deepEqual(legacy[0].dataNeeded, ["minuti"]);
});

test("a cost type or a lever still to choose does not block saving; bad numbers do", () => {
  assert.deepEqual(roiInputProblems([cost({ kind: null, label: "Licenze" })], [benefit({ lever: null, leverLabel: "Leva strana" })]), []);
  const kept = roiUpdateInput({ costLines: [cost({ kind: null })], benefitLines: [benefit({ lever: null })], content: {} });
  assert.equal(kept.costLines?.[0].kind, null);
  assert.equal(kept.benefitLines?.[0].lever, null);
  assert.deepEqual(roiInputProblems([cost({ label: "Licenze", value: -1 })], [benefit({ leverLabel: "Tempo", value: Number.NaN })]), [
    "Il costo di «Licenze» deve essere un numero positivo.",
    "Il beneficio di «Tempo» deve essere un numero.",
  ]);
});

test("the view reads the saved model first, then the template", () => {
  const saved = buildRoiView(
    {
      version: 2,
      status: "stima",
      currency: "EUR",
      cost_lines: [{ key: "costo_01", label: "Progetto", kind: "una_tantum", value: 1000, status: "stima" }],
      benefit_lines: [{ key: "tempo", lever: "tempo", value: 500, status: "stima", inputs: ["kpi.servizio.tempo"] }],
      content: { spiegazione: "Perché conviene", formula_roi: { break_even: "costo / beneficio" }, cosa_serve: ["costo orario"], benefit_extras: { tempo: { lever_label: "Tempo" } } },
      horizon_years: 5,
    },
    { costs: [] },
  );
  assert.equal(saved.source, "modello");
  assert.equal(saved.version, 2);
  assert.equal(saved.explanation, "Perché conviene");
  assert.equal(saved.formula.breakEven, "costo / beneficio");
  assert.deepEqual(saved.whatNeeded, ["costo orario"]);
  assert.equal(saved.benefitLines[0].leverLabel, "Tempo");
  assert.equal(saved.computed.missing.length, 0);
  assert.deepEqual(roiKpiKeys(saved), ["kpi.servizio.tempo"]);
  const tpl = buildRoiView(undefined, { currency: "EUR", costs: [{ key: "implementazione", label: "Progetto", value: null, status: "da definire" }], benefits: [{ key: "t", lever: "tempo", formula: "f" }], notes: "Valori inventati." });
  assert.equal(tpl.source, "template");
  assert.equal(tpl.notes, "Valori inventati.");
  assert.equal(tpl.costLines[0].key, "implementazione");
  assert.equal(buildRoiView(undefined, null).source, "vuoto");
});

// ── Totali salvati (WP5) ──────────────────────────────────────────────

test("what is missing is also told line by line, with the readable name of the lever", () => {
  const r = computeRoi({ costLines: [cost({ key: "progetto", label: "Progetto" }), cost({ key: "licenze", label: "Licenze", kind: null })], benefitLines: [benefit({ key: "nuove", lever: "nuove_capacita", leverLabel: null })] });
  assert.deepEqual(r.gaps, [
    { kind: "valore_costo", key: "progetto", label: "Progetto" },
    { kind: "tipo_costo", key: "licenze", label: "Licenze" },
    { kind: "valore_beneficio", key: "nuove", label: "Nuove capacità" },
  ]);
  assert.deepEqual(r.missing, ["Costo da stimare: Progetto", "Tipo di costo da indicare: Licenze", "Beneficio da stimare: Nuove capacità"]);
  assert.deepEqual(computeRoi({ costLines: [], benefitLines: [] }).gaps, [{ kind: "nessun_costo" }, { kind: "nessun_beneficio" }]);
  assert.deepEqual(computeRoi({ costLines: [cost({ value: 1 })], benefitLines: [benefit({ value: 2 })] }).gaps, []);
});

test("the saved totals are all empty until the account is computed, then the cost, benefit, break-even and value at 5 years", () => {
  assert.deepEqual(roiTotals({ costLines: [cost({})], benefitLines: [benefit({ value: 1000 })] }), EMPTY_ROI_TOTALS);
  assert.deepEqual(roiTotals({ costLines: [], benefitLines: [] }), EMPTY_ROI_TOTALS);
  const lines = { costLines: [cost({ value: 40000 }), cost({ key: "r", kind: "ricorrente", value: 12000 })], benefitLines: [benefit({ value: 72000 })] };
  assert.deepEqual(roiTotals(lines), { implementationCost: 40000, annualRunCost: 12000, annualBenefit: 72000, breakEvenMonths: 8, value5y: 260000 });
  const three = roiTotals({ ...lines, horizonYears: 3 });
  assert.equal(three.value5y, 260000, "value_5y is at 5 years whatever the model horizon");
  assert.equal(three.implementationCost, 40000);
  const loss = roiTotals({ costLines: [cost({ value: 1000 }), cost({ key: "r", kind: "ricorrente", value: 5000 })], benefitLines: [benefit({ value: 4000 })] });
  assert.equal(loss.implementationCost, 1000, "the cost is known even when the account does not pay back");
  assert.equal(loss.breakEvenMonths, null);
  const onlyRunning = roiTotals({ costLines: [cost({ kind: "ricorrente", value: 100 }), cost({ key: "x", kind: "escluso", value: null })], benefitLines: [benefit({ value: 1300 })] });
  assert.equal(onlyRunning.implementationCost, 0);
  assert.equal(onlyRunning.breakEvenMonths, 0);
  assert.ok(sameRoiTotals(roiTotals(lines), { ...roiTotals(lines) }));
  assert.ok(!sameRoiTotals(roiTotals(lines), EMPTY_ROI_TOTALS));
  assert.ok(sameRoiTotals(EMPTY_ROI_TOTALS, { ...EMPTY_ROI_TOTALS }));
  assert.ok(!sameRoiTotals({ ...EMPTY_ROI_TOTALS, value5y: 0 }, EMPTY_ROI_TOTALS), "zero is not empty");
});

test("the three figures say «da calcolare» or «non rientra», never a number of an incomplete account", () => {
  const open = valueFigures(computeRoi({ costLines: [cost({ value: 10 })], benefitLines: [benefit({})] }));
  assert.deepEqual(
    open.map((f) => [f.label, f.value, f.note]),
    [
      ["Costo di realizzazione", null, "da calcolare"],
      ["Beneficio all'anno", null, "da calcolare"],
      ["Pareggio", null, "da calcolare"],
    ],
  );
  const done = valueFigures(computeRoi({ costLines: [cost({ value: 40000 })], benefitLines: [benefit({ value: 72000 })] }));
  assert.deepEqual(
    done.map((f) => [sp(f.value), f.note]),
    [
      ["40.000 €", null],
      ["72.000 €", null],
      ["6,7 mesi", null],
    ],
  );
  const loss = valueFigures(computeRoi({ costLines: [cost({ value: 1000 }), cost({ key: "r", kind: "ricorrente", value: 5000 })], benefitLines: [benefit({ value: 4000 })] }));
  assert.deepEqual([loss[2].value, loss[2].note], [null, "non rientra"]);
  assert.equal(valueFigures(computeRoi({ costLines: [cost({ value: 1000 })], benefitLines: [benefit({ value: 12000 })] }))[2].value, "1 mese");
});

test("plain text: keys become titles or disappear, fact codes and contract articles go away", () => {
  const titles = new Map([["kpi.servizio.tempo", "Tempo medio di risposta"]]);
  assert.equal(plainText("Si misura con kpi.servizio.tempo.", titles), "Si misura con Tempo medio di risposta.");
  assert.equal(plainText("Minuti risparmiati (kpi.ignoto.x) per richiesta.", titles), "Minuti risparmiati per richiesta.");
  assert.equal(plainText("Costi da autorizzare (art. 8.4), dichiarato in call (F012).", titles), "Costi da autorizzare, dichiarato in call.");
  assert.equal(plainText("Allegato: verbale.doc.pdf", titles), "Allegato: verbale.doc.pdf", "a file name is not a key");
  assert.equal(plainText("Ore misurate nel backtest (F010), confrontate con la baseline.", titles), "Ore misurate nella prova sul passato, confrontate con il valore di partenza.");
  assert.equal(plainText("kpi.ignoto.x"), null);
  assert.equal(plainText("   "), null);
  assert.equal(plainText(null), null);
});

const roiFrom = (over: Partial<RoiView> & { costLines: CostLine[]; benefitLines: BenefitLine[] }): RoiView => {
  const base = buildRoiView(undefined, { costs: [], benefits: [] });
  return { ...base, ...over, source: over.source ?? "modello", computed: computeRoi({ costLines: over.costLines, benefitLines: over.benefitLines }) };
};

const kpiRow = (id: string, key: string, title: string, levers: string[], extra: Record<string, unknown> = {}) =>
  rowToKpiRow({ id, key, title, explanation: null, status: "da_chiedere", priority: "should", levers, spec: {}, formula_confirmed: false, data_ready: false, ...extra }, new Set());

function sampleView(): ValueView {
  const roi = roiFrom({
    costLines: [
      cost({ key: "progetto", label: "Progetto (art. 8.4)", value: 40000, authorized: true, howEstimated: "Ore × tariffa, vedi kpi.servizio.tempo" }),
      cost({ key: "licenze", label: "Licenze", kind: "ricorrente", value: null, authorized: null, howEstimated: "Stima del backtest", source: "Dalla baseline del 2025" }),
      cost({ key: "cliente", label: "Hardware del cliente", kind: "escluso", value: null, authorized: false }),
      cost({ key: "canone", label: "Canone", kind: "ricorrente", value: 1200 }),
    ],
    benefitLines: [
      benefit({ key: "tempo", lever: "tempo", leverLabel: "Tempo", value: 40000, inputs: ["kpi.servizio.tempo", "kpi.non.esiste"], howToEuro: "Minuti risparmiati (F010) per il costo orario." }),
      benefit({ key: "leva_02", lever: null, leverLabel: "Nuove capacità commerciali", value: null }),
    ],
    whatNeeded: ["Costo orario medio (q.costi.99)", "Lo chiede q.costi.01"],
    explanation: "Il beneficio si misura nel backtest, contro la baseline.",
    formula: { explanation: "Valore dei backtest meno i costi", breakEven: null, value5y: null },
  });
  return buildValueView({
    roi,
    caseLevers: ["tempo", "decisioni"],
    leverTexts: parseLeverTexts([
      { leva: "Tempo", come: "Meno tempo per ogni richiesta, misurato con kpi.servizio.tempo.", kpi: "kpi.servizio.tempo" },
      { leva: "Decisioni", come: "Decisioni più rapide." },
      "non un oggetto",
      { leva: "Rischio" },
    ]),
    kpis: [
      kpiRow("k1", "kpi.servizio.tempo", "Tempo medio di risposta", ["qualita"], { formula_confirmed: true, data_ready: true }),
      kpiRow("k2", "kpi.servizio.attesa", "Attesa in coda", ["tempo"]),
      kpiRow("k3", "kpi.decisioni.giorni", "Giorni per decidere", ["decisioni"]),
      kpiRow("k4", "kpi.costi.richiesta", "Costo per richiesta", ["costi"]),
    ],
    questions: [{ id: "q1", key: "q.costi.01", title: "Costo orario medio di un operatore", status: "chiesta" }],
    questionTotal: 3,
  });
}

test("Valore: only the active levers, with their KPIs, description and euros a year", () => {
  const v = sampleView();
  assert.deepEqual(
    v.levers.map((l) => [l.id, l.label, sp(l.value), l.kpis.map((k) => k.title)]),
    [
      ["leva-tempo", "Tempo", "40.000 € all'anno", ["Attesa in coda", "Tempo medio di risposta"]],
      ["leva-leva_02", "Nuove capacità commerciali", null, []],
      ["nuova-leva-decisioni", "Decisioni", null, ["Giorni per decidere"]],
    ],
  );
  const tempo = v.levers[0];
  assert.equal(tempo.description, "Meno tempo per ogni richiesta, misurato con Tempo medio di risposta.");
  assert.equal(tempo.howToEuro, "Minuti risparmiati per il costo orario.");
  assert.deepEqual(tempo.kpis.find((k) => k.id === "k1")?.dot, { label: "Pronto", tone: "verde" });
  assert.equal(v.levers[2].line, null, "an active lever of the case without a line yet");
  assert.equal(v.levers[2].description, "Decisioni più rapide.");
  assert.deepEqual(
    v.inactiveLevers.map((l) => l.label),
    ["Output", "Qualità", "Nuove capacità", "Costi", "Ricavi", "Rischio"],
  );
  assert.equal(v.kpiTotal, 4);
});

test("Valore: costs with their value, approval by the client and the text of the panel", () => {
  const v = sampleView();
  assert.deepEqual(
    v.costs.map((c) => [c.id, c.label, sp(c.value), c.valueNote, c.approved, c.kind]),
    [
      ["costo-progetto", "Progetto", "40.000 €", null, "Sì", "Una tantum"],
      ["costo-licenze", "Licenze", null, "da stimare", null, "Ricorrente (all'anno)"],
      ["costo-cliente", "Hardware del cliente", null, "fuori dal conto", "No", "Escluso dal conto"],
      ["costo-canone", "Canone", "1.200 € all'anno", null, null, "Ricorrente (all'anno)"],
    ],
  );
  assert.equal(v.costs[0].howEstimated, "Ore × tariffa, vedi Tempo medio di risposta");
});

test("Valore: «Dati che mancano» puts together the open questions, the incomplete lines and what is needed", () => {
  const v = sampleView();
  assert.equal(v.computed, false);
  assert.equal(v.missing.questionTotal, 3);
  assert.deepEqual(
    v.missing.lines.map((l) => [l.id, l.label, l.reason]),
    [
      ["costo-licenze", "Licenze", "Costo da stimare"],
      ["leva-leva_02", "Nuove capacità commerciali", "Beneficio da stimare"],
    ],
  );
  assert.equal(v.missing.total, 5);
  assert.deepEqual(v.missing.needs, ["Costo orario medio", "Lo chiede Costo orario medio di un operatore"], "an unknown key goes away, a known one becomes its title");
  assert.equal(missingText(v.missing.total, v.computed), "Mancano 5 dati per calcolarlo");
  assert.equal(missingText(1, false), "Manca 1 dato per calcolarlo");
  assert.equal(missingText(3, true), "3 dati ancora da raccogliere");
  assert.equal(missingText(0, false), null);
  assert.deepEqual(v.figures.map((f) => f.value), [null, null, null]);
  assert.equal(v.statusLabel, "Stima");
  assert.match(v.disclaimer, /^Sono stime: nessun beneficio è garantito\./);
});

test("Valore: panels open only for what exists", () => {
  const v = sampleView();
  assert.equal(valuePanel("dati", v)?.kind, "dati");
  assert.equal(valuePanel("leva-tempo", v)?.kind, "leva");
  assert.equal(valuePanel("nuova-leva-decisioni", v)?.kind, "leva");
  assert.equal(valuePanel("costo-licenze", v)?.kind, "costo");
  assert.equal(valuePanel("costo-ignota", v), null);
  assert.equal(valuePanel("leva-decisioni", v), null);
  assert.equal(valuePanel(null, v), null);
  const done = buildValueView({ roi: roiFrom({ costLines: [cost({ value: 1 })], benefitLines: [benefit({ value: 1 })] }), caseLevers: [], leverTexts: [], kpis: [], questions: [], questionTotal: 0 });
  assert.equal(done.computed, true);
  assert.equal(valuePanel("dati", done), null, "nothing is missing: no panel");
});

test("Valore: no key, article, fact code or jargon in what a client reads", () => {
  const v = sampleView();
  const texts: string[] = [
    v.statusLabel,
    v.disclaimer,
    ...v.figures.flatMap((f) => [f.label, f.value ?? "", f.note ?? ""]),
    ...v.levers.flatMap((l) => [l.label, l.value ?? "", l.description ?? "", l.howToEuro ?? "", ...l.kpis.flatMap((k) => [k.title, k.dot.label])]),
    ...v.inactiveLevers.map((l) => l.label),
    ...v.costs.flatMap((c) => [c.label, c.value ?? "", c.valueNote ?? "", c.approved ?? "", c.kind, c.howEstimated ?? "", c.source ?? "", c.status]),
    ...v.missing.questions.map((q) => q.title),
    ...v.missing.lines.flatMap((l) => [l.label, l.reason]),
    ...v.missing.needs,
    ...v.how.method,
    ...v.how.formula,
    ...v.how.figures.flatMap((f) => [f.label, f.value ?? "", f.note ?? ""]),
  ];
  assert.deepEqual(findForbiddenIn(texts, "cliente"), []);
  // §2.6: «baseline» and «backtest» are «valore di partenza» and «prova sul passato» in every text.
  assert.deepEqual(
    texts.filter((t) => /\b(baseline|backtest)\b/i.test(t)),
    [],
  );
  const licenze = v.costs.find((c) => c.id === "costo-licenze");
  assert.deepEqual([licenze?.howEstimated, licenze?.source], ["Stima della prova sul passato", "Dal valore di partenza del 2025"]);
  assert.equal(v.how.method[0], "Il beneficio si misura nella prova sul passato, contro il valore di partenza.");
  assert.equal(v.how.formula[0], "Valore delle prove sul passato meno i costi");
});

test("Valore: the titles of the open questions lose articles, the privacy sheet code, fact codes and keys", () => {
  const v = buildValueView({
    roi: roiFrom({ costLines: [cost({ value: null })], benefitLines: [] }),
    caseLevers: [],
    leverTexts: [],
    kpis: [],
    questions: [
      { id: "q1", key: "q.costi.01", title: "Chi autorizza i costi del progetto (art. 8.4)?", status: "da_chiedere" },
      { id: "q2", key: "q.privacy.01", title: "La Scheda A.8 è firmata?", status: "da_chiedere" },
      { id: "q3", key: "q.dati.01", title: "Quante richieste al giorno (F010)?", status: "chiesta" },
      { id: "q4", key: "q.dati.02", title: "q.dati.02", status: "chiesta" },
    ],
    questionTotal: 4,
  });
  assert.deepEqual(
    v.missing.questions.map((q) => [q.id, q.title]),
    [
      ["q1", "Chi autorizza i costi del progetto?"],
      ["q2", "La Scheda privacy è firmata?"],
      ["q3", "Quante richieste al giorno?"],
      ["q4", "Domanda senza titolo"],
    ],
  );
  assert.deepEqual(findForbiddenIn(v.missing.questions.map((q) => q.title), "cliente"), []);
});

test("Valore: «Dati che mancano» lists the first questions and counts all of them", () => {
  const questions = Array.from({ length: 30 }, (_, n) => ({ id: `q${n}`, key: `q.dati.${n}`, title: `Domanda ${n}`, status: "da_chiedere" as const }));
  const v = buildValueView({ roi: roiFrom({ costLines: [cost({ value: null })], benefitLines: [] }), caseLevers: [], leverTexts: [], kpis: [], questions, questionTotal: 136 });
  assert.equal(v.missing.questions.length, MISSING_QUESTIONS_SHOWN);
  assert.deepEqual(v.missing.questions.slice(0, 2).map((q) => q.id), ["q0", "q1"], "in the order of the query: the indispensable ones first");
  assert.equal(v.missing.questionTotal, 136, "«E altre N» counts every question");
  assert.equal(v.missing.total, 136 + v.missing.lines.length);
});

test("a new benefit line for an active lever takes a free key", () => {
  assert.equal(newBenefitLine("tempo", []).key, "tempo");
  assert.equal(newBenefitLine("tempo", [{ key: "tempo" }, { key: "tempo_2" }]).key, "tempo_3");
  const line = newBenefitLine("decisioni", []);
  assert.equal(line.leverLabel, "Decisioni");
  assert.equal(line.value, null);
  assert.equal(line.status, "stima");
});

test("saving says which model the page saw", () => {
  assert.equal(roiUpdateInput({ costLines: [], benefitLines: null, content: {}, seen: "2026-10-14 10:00:00.123456+00" }).seen, "2026-10-14 10:00:00.123456+00");
  assert.equal(roiUpdateInput({ costLines: [], benefitLines: null, content: {}, seen: null }).seen, null, "null: the page had no model yet");
  assert.ok(!("seen" in roiUpdateInput({ costLines: [], benefitLines: null, content: {} })), "no check when the caller does not say");
});
