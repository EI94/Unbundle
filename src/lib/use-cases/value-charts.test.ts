import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LEVERS } from "../uc/vocab.ts";
import type { ValuationModel } from "./valuation.ts";
import {
  BREAKEVEN_NOW,
  NO_GROUP_LABEL,
  bubbleRadius,
  bubbleWhen,
  bubbleWhenText,
  buildBenefitBubbles,
  buildLeverChart,
  buildRoadmapValue,
  componentAmountText,
  curveScale,
  groupLegend,
  groupPalette,
  groupSlot,
  groupText,
  hasPriorityValueModels,
  hubCharts,
  isCommittedCost,
  niceScale,
  otherGroupsLabel,
  priorityCharts,
  roadmapPlan,
  roadmapValueItems,
} from "./value-charts.ts";
import { hoursFreedText, qualitativeCountText } from "./format.ts";
import { DEFAULT_VALUE_PARAMS, valueModelSchema, type ValueModel, type ValueParams } from "./value-model.ts";
import { projectHubItem, type HubContext, type HubItem, type HubSourceRow } from "./views.ts";

// I dati dei grafici di «Benefici e costi» (spec di Pierpaolo, 25/10/2026): colori dei gruppi,
// bolle facilità × beneficio, ore, J-curve e pareggio della Roadmap, «Valore per tipo di
// ritorno». Ipotesi predefinite, origine 2026-11, come i golden di value-calc. Dati sintetici.

const TODAY = "2026-11-03";
const PARAMS: ValueParams = { ...DEFAULT_VALUE_PARAMS, originMonth: "2026-11" };
const MODEL: ValuationModel = {
  dimensions: { impact: [{ id: "efficiency" }], feasibility: [{ id: "effort", direction: "lower_better" }], esg: [] },
  thresholds: { highImpact: 3.5, midImpact: 2.5 },
};
const CTX: HubContext = { model: MODEL, esgEnabled: false, today: TODAY, valueParams: PARAMS };
const PLAN = { quarter: "2026-Q4", startMonth: "2026-11", goLiveMonth: "2027-01" } as const;

const FIX_A: ValueModel = valueModelSchema.parse({
  v: 1,
  primary: "tempo",
  components: [
    { key: "capacita", lever: "nuove_capacita", label: "Risposte anche fuori orario", kind: "qualitativo", confidence: "ipotesi" },
    { key: "tempo", lever: "tempo", label: "Smistamento delle richieste", kind: "ore", volumeYear: 6600, minutesPerUnit: 1.5, automatablePct: 70, confidence: "ipotesi" },
    { key: "qualita", lever: "qualita", label: "Meno errori di smistamento", kind: "qualitativo", confidence: "da_misurare" },
  ],
  ease: 4,
  costs: { devDays: 4, internalHours: 16, runCostEurYear: 600 },
  group: "Servizio clienti",
  plan: PLAN,
});

const FIX_B: ValueModel = valueModelSchema.parse({
  v: 1,
  primary: "costi",
  components: [
    { key: "costi", lever: "costi", label: "Meno licenze", kind: "euro", eurYear: 535, confidence: "ipotesi" },
    { key: "tempo-1", lever: "tempo", label: "Controllo delle fatture", kind: "ore", volumeYear: 480, minutesPerUnit: 12, automatablePct: 65, confidence: "ipotesi" },
    { key: "tempo-2", lever: "tempo", label: "Solleciti ai fornitori", kind: "ore", volumeYear: 600, minutesPerUnit: 6, automatablePct: 80, confidence: "da_misurare" },
    { key: "rischio", lever: "rischio", label: "Meno pagamenti doppi", kind: "qualitativo", confidence: "da_misurare" },
  ],
  costs: { devDays: 2, internalHours: 8, runCostEurYear: 0 },
  group: "Amministrazione",
  plan: PLAN,
});

/** Facilità 2, avvio 4 h × 35 € = 140 €, 1.000 € all'anno; senza piano. */
const SMALL: ValueModel = valueModelSchema.parse({
  v: 1,
  primary: "ricavi",
  components: [{ key: "ricavi", lever: "ricavi", label: "Più preventivi chiusi", kind: "euro", eurYear: 1000, confidence: "ipotesi" }],
  ease: 2,
  costs: { devDays: 0, internalHours: 4, runCostEurYear: 0 },
});

let seq = 0;
function row(o: Partial<HubSourceRow> = {}): HubSourceRow {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    code: `XX-${String(seq).padStart(4, "0")}`,
    title: `Use case di prova ${seq}`,
    description: "Problema di prova.",
    origin: "adoption",
    portfolioKind: "use_case_ai",
    status: "accepted",
    portfolioReviewStatus: "scored",
    reviewedBy: null,
    publicNote: null,
    intake: null,
    reviewBy: null,
    targetQuarter: "2026-Q4",
    customScores: null,
    aiSuggestion: null,
    valueEurYear: null,
    costEurOnce: null,
    costBand: null,
    source: "web_proposed",
    aiLab: null,
    submittedAt: new Date("2026-10-01T10:00:00Z"),
    createdAt: new Date("2026-10-01T10:00:00Z"),
    statusChangedAt: new Date("2026-10-13T10:00:00Z"),
    version: 1,
    impactEconomic: null,
    impactTime: null,
    impactQuality: null,
    impactCoordination: null,
    impactSocial: null,
    feasibilityData: null,
    feasibilityWorkflow: null,
    feasibilityRisk: null,
    feasibilityTech: null,
    feasibilityTeam: null,
    esgEnvironmental: null,
    esgSocial: null,
    esgGovernance: null,
    reopenedOn: null,
    realizedOn: null,
    ...o,
  };
}

const item = (o: Partial<HubSourceRow> = {}): HubItem => projectHubItem(row(o), CTX, null);
const TO_DECIDE = { status: "proposed", portfolioReviewStatus: "in_review", targetQuarter: null } as const;

function near(actual: number | null | undefined, expected: number, label: string, eps = 1e-6) {
  assert.ok(typeof actual === "number" && Math.abs(actual - expected) <= eps, `${label}: ${actual} invece di ${expected}`);
}

// ─── Gruppi ──────────────────────────────────────────────────────────

test("colori dei gruppi: dal più grande, tre colori, il grigio dice chi c'è dentro; un filtro non ridipinge", () => {
  const groups = ["Vendite", "Vendite", "Vendite", "Amministrazione", "Produzione", "Logistica", "Logistica", null];
  const items = groups.map((group) => ({ valueModel: group ? { ...SMALL, group } : SMALL }));
  const palette = groupPalette([...items, { valueModel: null }, { valueModel: { ...SMALL, group: "  Produzione  " } }]);
  assert.equal(palette.single, false);
  // Vendite 3 schede, Logistica 2, Produzione 2 (a pari schede il nome), Amministrazione 1.
  assert.deepEqual(palette.slots, { Vendite: 1, Logistica: 2, Produzione: 3 });
  assert.equal(groupSlot(palette, "Amministrazione"), 0, "il quarto gruppo per grandezza è grigio");
  assert.equal(groupSlot(palette, null), 0, "senza gruppo è grigio");
  assert.equal(groupSlot(palette, "Vendite"), 1, "il gruppo più grande ha il primo colore, anche se in ordine alfabetico viene dopo");
  // La legenda: i colori presenti, nell'ordine; il grigio con i nomi dei gruppi e «senza gruppo».
  assert.deepEqual(groupLegend(palette, ["Produzione", null, "Vendite", "Amministrazione"]), [
    { slot: 1, label: "Vendite" },
    { slot: 3, label: "Produzione" },
    { slot: 0, label: "Altri gruppi (Amministrazione) e senza gruppo" },
  ]);
  assert.deepEqual(groupLegend(palette, ["Vendite", null]).at(-1), { slot: 0, label: NO_GROUP_LABEL });
  assert.deepEqual(groupLegend(palette, ["Amministrazione"]), [{ slot: 0, label: "Altri gruppi (Amministrazione)" }]);
  assert.equal(otherGroupsLabel(["A", "B", "C", "D", "E"], false), "Altri gruppi (A, B, C e altri 2)");
  assert.equal(groupText("Vendite"), "Gruppo Vendite");
  assert.equal(groupText(null), NO_GROUP_LABEL);
  // A pari schede, con le ipotesi, vince il beneficio contato più alto.
  const tie = groupPalette(
    [
      { valueModel: { ...SMALL, group: "Acquisti" } },
      { valueModel: { ...FIX_A, group: "Zeta" } },
    ],
    PARAMS,
  );
  assert.deepEqual(tie.slots, { Zeta: 1, Acquisti: 2 });
  // Senza gruppi: un colore solo, nessuna legenda.
  const single = groupPalette([{ valueModel: SMALL }, { valueModel: null }]);
  assert.equal(single.single, true);
  assert.equal(groupSlot(single, null), 1);
  assert.deepEqual(groupLegend(single, [null]), []);
});

test("niceScale: tacche tonde che comprendono lo zero; senza ampiezza da 0 a 1.000", () => {
  assert.deepEqual(niceScale(0, 4042.5).ticks, [0, 1000, 2000, 3000, 4000, 5000]);
  const both = niceScale(-840, 2719);
  assert.equal(both.min, -1000);
  assert.equal(both.max, 3000);
  assert.ok(both.ticks.includes(0));
  assert.deepEqual(niceScale(0, 0), { min: 0, max: 1000, step: 200, ticks: [0, 200, 400, 600, 800, 1000] });
  assert.deepEqual(niceScale(0, 180_000).ticks, [0, 50_000, 100_000, 150_000, 200_000]);
});

test("curveScale: una piccola discesa sotto lo zero non schiaccia la J", () => {
  const scale = curveScale(-3710, 61_000);
  assert.equal(scale.step, 20_000);
  assert.equal(scale.min, -5000, "un quarto di passo sotto la discesa, non −20.000 €");
  assert.equal(scale.max, 80_000);
  assert.ok(!scale.ticks.includes(-20_000));
  assert.ok(scale.ticks.includes(0));
  // Una discesa grande resta com'era.
  assert.deepEqual(curveScale(-840, 2719), niceScale(-840, 2719));
  // E al contrario: una piccola salita sopra una discesa grande.
  assert.equal(curveScale(-50_000, 3000).max, 5000);
});

// ─── Bolle ───────────────────────────────────────────────────────────

test("bolle: raggio 5 + 13·√(avvio / avvio massimo)", () => {
  assert.equal(bubbleRadius(560, 560), 18);
  assert.equal(bubbleRadius(140, 560), 11.5);
  assert.equal(bubbleRadius(0, 560), 5);
  assert.equal(bubbleRadius(0, 0), 5, "nessun avvio: tutte al minimo");
});

test("bolle: il bordo dice quando, il riempimento chiaro «da decidere»", () => {
  const when = (o: Partial<HubSourceRow>) => bubbleWhen(item(o), TODAY);
  assert.equal(when({ targetQuarter: "2026-Q4" }), "questo_trimestre");
  assert.equal(when({ targetQuarter: "2026-Q3" }), "questo_trimestre", "scaduto: è ancora da fare adesso");
  assert.equal(when({ targetQuarter: "2027-Q1" }), "prossimo_trimestre");
  assert.equal(when({ targetQuarter: "2027-Q2" }), "piu_avanti");
  assert.equal(when({ targetQuarter: null }), "piu_avanti");
  assert.equal(when(TO_DECIDE), "da_decidere");
  // Il bordo resta di questo trimestre, ma il testo dice che è scaduto.
  const late = item({ valueModel: SMALL, targetQuarter: "2026-Q3" });
  const [bubble] = buildBenefitBubbles([late], PARAMS, TODAY, groupPalette([late])).bubbles;
  assert.equal(bubble.when, "questo_trimestre");
  assert.equal(bubble.expired, true);
  assert.equal(bubbleWhenText(bubble), "questo trimestre · scaduto");
  const onTime = buildBenefitBubbles([item({ valueModel: SMALL, targetQuarter: "2026-Q4" })], PARAMS, TODAY, groupPalette([])).bubbles[0];
  assert.equal(bubbleWhenText(onTime), "questo trimestre");
});

test("bolle: x facilità, y beneficio contato, dalla più grande; senza facilità fuori dal grafico", () => {
  const a = item({ valueModel: FIX_A, targetQuarter: "2026-Q4" });
  const b = item({ valueModel: FIX_B, targetQuarter: "2027-Q1" }); // senza facilità
  const small = item({ valueModel: SMALL, ...TO_DECIDE });
  const plain = item({ customScores: { impact: { efficiency: 4 } } }); // senza modello: resta nella matrice di oggi
  const building = item({ valueModel: FIX_A, status: "in_progress" }); // in realizzazione: non è in «Priorità»
  const palette = groupPalette([a, b, small, plain, building]);
  const chart = buildBenefitBubbles([small, plain, a, b, building], PARAMS, TODAY, palette);
  assert.deepEqual(
    chart.bubbles.map((bubble) => bubble.id),
    [a.id, small.id],
  );
  assert.equal(chart.withoutEase, 1);
  const [big, little] = chart.bubbles;
  assert.equal(big.ease, 4);
  near(big.benefit, 4042.5, "beneficio contato");
  near(big.hours, 115.5, "ore");
  assert.equal(big.oneoff, 560);
  assert.equal(big.r, 18);
  assert.equal(big.when, "questo_trimestre");
  assert.equal(big.group, "Servizio clienti");
  assert.equal(big.slot, 1, "Servizio clienti ha due schede, Amministrazione una");
  assert.equal(big.groupLabel, "Gruppo Servizio clienti");
  assert.equal(little.r, 11.5);
  assert.equal(little.when, "da_decidere");
  assert.equal(little.slot, 0, "senza gruppo: grigio");
  assert.equal(chart.scale.max, 5000);
  assert.equal(hasPriorityValueModels([plain, building]), false);
  assert.equal(hasPriorityValueModels([plain, small]), true);
  // Le voci del menu «⋯»: la matrice con una scheda di «Priorità», le bolle se una ha «Benefici e costi».
  assert.deepEqual(priorityCharts([building]), [], "in realizzazione: non è in «Priorità»");
  assert.deepEqual(priorityCharts([plain, building]), ["matrice"]);
  assert.deepEqual(priorityCharts([plain, small]), ["matrice", "benefici"]);
  assert.deepEqual(priorityCharts([small]), ["matrice", "benefici"]);
  assert.deepEqual(priorityCharts([]), []);
});

test("menu «⋯»: le due matrici, poi «Curva del valore» con un approvato o in realizzazione con «Benefici e costi»", () => {
  const toDecide = item({ valueModel: SMALL, ...TO_DECIDE });
  const approved = item({ valueModel: FIX_A });
  const building = item({ valueModel: FIX_B, status: "in_progress" });
  const plain = item({ customScores: { impact: { efficiency: 4 } } });
  assert.deepEqual(hubCharts([]), [], "nessuna scheda: nessun grafico");
  assert.deepEqual(hubCharts([toDecide]), ["matrice", "benefici"], "da valutare con un modello: le matrici, non la curva");
  assert.deepEqual(hubCharts([approved]), ["matrice", "benefici", "curva"]);
  assert.deepEqual(hubCharts([building]), ["curva"], "in realizzazione: non è da mettere in ordine, ma è nella curva");
  assert.deepEqual(hubCharts([plain]), ["matrice"], "senza modello: solo la matrice");
  assert.deepEqual(hubCharts([plain, building]), ["matrice", "curva"]);
  // I filtri non contano: l'ordine delle schede non cambia nulla, e la pagina passa tutte le schede del workspace.
  const all = [toDecide, approved, building, plain];
  assert.deepEqual(hubCharts(all), ["matrice", "benefici", "curva"]);
  assert.deepEqual(hubCharts([...all].reverse()), hubCharts(all));
  const hub = readFileSync(new URL("../../components/use-cases/hub.tsx", import.meta.url), "utf8");
  assert.ok(hub.includes("hubCharts(list.items as HubItem[])"), "il menu dalle schede di tutto il workspace, non da quelle filtrate");
});

// ─── Roadmap ─────────────────────────────────────────────────────────

test("Roadmap: FIX_A + FIX_B, ore 177,9, J-curve sommata, pareggio «apr 27», entrata in uso «gen 27»", () => {
  const a = item({ valueModel: FIX_A });
  const b = item({ valueModel: FIX_B, status: "in_progress" });
  const done = item({ valueModel: FIX_A, status: "implemented" }); // «Fatti»: fuori dai conti
  const toDecide = item({ valueModel: FIX_A, ...TO_DECIDE });
  const plain = item({ valueEurYear: 50_000 });
  assert.deepEqual(
    roadmapValueItems([a, b, done, toDecide, plain]).map((card) => card.id),
    [a.id, b.id],
  );
  const value = buildRoadmapValue([a, b, done, toDecide, plain], PARAMS);
  assert.ok(value);
  near(value.hours, 115.5 + 62.4, "ore liberate");
  assert.equal(value.curve.net.length, 25);
  // Golden FIX_A [0, -280, -560, -497.71, -323.13, -36.25, 250.62] + FIX_B [0, -140, -280, -204.47, -53.42, 173.17].
  const expected = [0, -420, -840, -702.18, -376.55, 136.92];
  expected.forEach((net, m) => near(value.curve.net[m], net, `net[${m}]`, 0.01));
  assert.equal(value.curve.breakeven, 5);
  assert.equal(value.breakevenText, "apr 27");
  assert.deepEqual(value.goLives, [{ index: 2, month: "2027-01", label: "gen 27", names: [a.code, b.code] }]);
  assert.deepEqual(
    { index: value.low?.index, label: value.low?.label },
    { index: 2, label: "gen 27" },
  );
  near(value.low?.net, -840, "punto più basso");
  assert.equal(buildRoadmapValue([plain, done], PARAMS), null, "senza modelli: niente grafici");
});

test("Roadmap: senza piano i mesi vengono dal trimestre; pareggio «subito» senza costi, «oltre …» se non si recupera", () => {
  const free = item({ valueModel: { ...SMALL, costs: undefined }, targetQuarter: "2027-Q1" });
  const value = buildRoadmapValue([free], PARAMS)!;
  assert.deepEqual([value.cards[0].startMonth, value.cards[0].goLiveMonth], ["2027-01", "2027-03"]);
  assert.equal(value.breakevenText, BREAKEVEN_NOW);
  assert.equal(value.low, null);

  const costly: ValueModel = { ...SMALL, costs: { devDays: 0, internalHours: 10_000, runCostEurYear: 0 } };
  const never = buildRoadmapValue([item({ valueModel: costly })], PARAMS)!;
  assert.equal(never.curve.breakeven, null);
  assert.equal(never.breakevenText, "oltre nov 28");

  const words: ValueModel = valueModelSchema.parse({ v: 1, primary: "rischio", components: [{ key: "r", lever: "rischio", label: "Meno rischi", kind: "qualitativo", confidence: "ipotesi" }] });
  assert.equal(buildRoadmapValue([item({ valueModel: words })], PARAMS)!.breakevenText, null, "niente costi né benefici: nessun pareggio");
});

test("Roadmap: i mesi vengono da tutte le schede del workspace, un filtro non sposta «Più avanti»", () => {
  const q1 = item({ valueModel: SMALL, targetQuarter: "2027-Q1" });
  const later = [1, 2, 3].map(() => item({ valueModel: SMALL, targetQuarter: null }));
  const all = [q1, ...later];
  const plan = roadmapPlan(all, PARAMS);
  assert.deepEqual(
    later.map((card) => plan.get(card.id)?.startMonth),
    ["2027-04", "2027-04", "2027-04"],
    "il trimestre dopo l'ultimo usato (2027-Q1)",
  );
  // La vista filtrata su «Più avanti»: le stesse schede, gli stessi mesi.
  const filtered = buildRoadmapValue(later, PARAMS, { plan })!;
  assert.deepEqual(
    filtered.cards.map((card) => card.startMonth),
    ["2027-04", "2027-04", "2027-04"],
  );
  // Senza i mesi del workspace le stesse schede partirebbero a gennaio: è quello che non deve succedere.
  assert.deepEqual(
    buildRoadmapValue(later, PARAMS)!.cards.map((card) => card.startMonth),
    ["2027-01", "2027-01", "2027-01"],
  );
});

test("Roadmap: l'avvio di una best practice «Da diffondere» resta fuori dalla curva, come da «Costo impegnato»", () => {
  const build = item({ valueModel: SMALL, targetQuarter: "2027-Q1" });
  const diffuse = item({ valueModel: SMALL, targetQuarter: "2027-Q1", portfolioKind: "best_practice" });
  assert.equal(diffuse.kind, "da_diffondere");
  assert.equal(isCommittedCost(build), true);
  assert.equal(isCommittedCost(diffuse), false);
  const value = buildRoadmapValue([build, diffuse], PARAMS)!;
  assert.deepEqual(
    value.cards.map((card) => card.oneoff),
    [140, 0],
  );
  // Benefici e ore sì: sono nel «Valore atteso all'anno».
  assert.deepEqual(
    value.cards.map((card) => card.benefit),
    [1000, 1000],
  );
});

// ─── Valore per tipo di ritorno ──────────────────────────────────────

test("Valore per tipo di ritorno: 8 righe, un segmento per use case dal più grande, da misurare a parte, qualitativi contati", () => {
  const a = item({ valueModel: FIX_A });
  const b = item({ valueModel: FIX_B, status: "in_progress" });
  const chart = buildLeverChart([b, a, item({ valueModel: SMALL, ...TO_DECIDE })], PARAMS, groupPalette([a, b]));
  assert.deepEqual(
    chart.rows.map((row) => row.lever),
    [...LEVERS],
  );
  const by = Object.fromEntries(chart.rows.map((row) => [row.lever, row]));
  // Tempo: FIX_A 4.042,5 € prima di FIX_B 2.184 €; le ore da misurare di FIX_B (1.680 €) a parte.
  assert.deepEqual(
    by.tempo.segments.map((segment) => segment.id),
    [a.id, b.id],
  );
  near(by.tempo.total, 4042.5 + 2184, "totale contato");
  near(by.tempo.pendingTotal, 1680, "da misurare");
  assert.deepEqual(
    by.tempo.pending.map((segment) => segment.id),
    [b.id],
  );
  assert.equal(by.tempo.segments[0].slot, 2, "Servizio clienti dopo Amministrazione");
  assert.deepEqual(
    by.tempo.segments[1].components.map((line) => [line.label, line.amount, line.confidence, line.counted]),
    [
      ["Controllo delle fatture", "62 h · 2.184 €", "ipotesi", true],
      ["Solleciti ai fornitori", "48 h · 1.680 €", "da misurare", false],
    ],
  );
  assert.equal(by.costi.total, 535);
  assert.deepEqual(
    by.nuove_capacita.qualitative.map((segment) => segment.id),
    [a.id],
  );
  assert.equal(by.nuove_capacita.total, 0);
  assert.equal(by.nuove_capacita.qualitativeCount, 1);
  assert.deepEqual(by.rischio.qualitative.map((segment) => segment.components[0].amount), ["qualitativo"]);
  assert.equal(by.ricavi.segments.length, 0, "da decidere: non è nella Roadmap");
  near(chart.max, 4042.5 + 2184 + 1680, "la riga più lunga");
});

test("«(n qualitativi)» conta le voci, non gli use case", () => {
  const two: ValueModel = valueModelSchema.parse({
    v: 1,
    primary: "rischio",
    components: [
      { key: "r1", lever: "rischio", label: "Meno errori", kind: "qualitativo", confidence: "ipotesi" },
      { key: "r2", lever: "rischio", label: "Meno reclami", kind: "qualitativo", confidence: "ipotesi" },
    ],
  });
  const chart = buildLeverChart([item({ valueModel: two })], PARAMS, groupPalette([]));
  const rischio = chart.rows.find((row) => row.lever === "rischio")!;
  assert.equal(rischio.qualitative.length, 1, "un use case nel popover");
  assert.equal(rischio.qualitativeCount, 2, "due voci nel conteggio");
  assert.equal(qualitativeCountText(rischio.qualitativeCount), "(2 qualitativi)");
});

test("testi: voce, qualitativi, ore", () => {
  assert.equal(componentAmountText(FIX_A.components[1], PARAMS), "116 h · 4.043 €");
  assert.equal(componentAmountText(FIX_B.components[0], PARAMS), "535 €");
  assert.equal(componentAmountText(FIX_A.components[0], PARAMS), "qualitativo");
  assert.equal(qualitativeCountText(1), "(1 qualitativo)");
  assert.equal(qualitativeCountText(3), "(3 qualitativi)");
  assert.equal(hoursFreedText(177.9), "178 ore");
  assert.equal(hoursFreedText(1), "1 ora");
});
