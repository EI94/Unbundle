import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LEVERS } from "../uc/vocab.ts";
import type { ValuationModel } from "./valuation.ts";
import {
  BREAKEVEN_NOW,
  NO_GROUP_LABEL,
  agentPointLegend,
  agentPointSlot,
  bubbleRadius,
  bubbleWhen,
  bubbleWhenText,
  buildBenefitBubbles,
  buildLeverChart,
  buildRoadmapValue,
  componentAmountText,
  curveScale,
  groupLabelOf,
  groupLegend,
  groupPalette,
  groupSlot,
  groupText,
  hasPriorityValueModels,
  hubCharts,
  isCommittedCost,
  markLegend,
  markSlot,
  niceScale,
  otherGroupsLabel,
  priorityCharts,
  roadmapPlan,
  roadmapValueItems,
} from "./value-charts.ts";
import { NO_AGENT_LABEL, agentPalette, agentToneOf } from "./agents.ts";
import { hoursFreedText, qualitativeCountText, roundAmount } from "./format.ts";
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
/** Una scheda approvata «Da costruire», per i colori dei gruppi: i grafici la disegnano. */
const APPROVED = { phase: "approvato", kind: "da_costruire", subState: "trimestre" } as const;

function near(actual: number | null | undefined, expected: number, label: string, eps = 1e-6) {
  assert.ok(typeof actual === "number" && Math.abs(actual - expected) <= eps, `${label}: ${actual} invece di ${expected}`);
}

// ─── Gruppi ──────────────────────────────────────────────────────────

test("colori dei gruppi: dal più grande, tre colori, il grigio dice chi c'è dentro; un filtro non ridipinge", () => {
  const groups = ["Vendite", "Vendite", "Vendite", "Amministrazione", "Produzione", "Logistica", "Logistica", null];
  const items = groups.map((group) => ({ ...APPROVED, valueModel: group ? { ...SMALL, group } : SMALL }));
  const palette = groupPalette([...items, { ...APPROVED, valueModel: null }, { ...APPROVED, valueModel: { ...SMALL, group: "  Produzione  " } }]);
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
      { ...APPROVED, valueModel: { ...SMALL, group: "Acquisti" } },
      { ...APPROVED, valueModel: { ...FIX_A, group: "Zeta" } },
    ],
    PARAMS,
  );
  assert.deepEqual(tie.slots, { Zeta: 1, Acquisti: 2 });
  // Senza gruppi: un colore solo, nessuna legenda.
  const single = groupPalette([
    { ...APPROVED, valueModel: SMALL },
    { ...APPROVED, valueModel: null },
  ]);
  assert.equal(single.single, true);
  assert.equal(groupSlot(single, null), 1);
  assert.deepEqual(groupLegend(single, [null]), []);
});

test("colori con gli agenti nei titoli: ogni bolla e ogni segmento nel tono dell'agente del suo titolo, mai del gruppo", () => {
  const agents = agentPalette([
    { title: "LIBRA L1 · Lettura delle fatture estere" },
    { title: "ORSA O1 · Solleciti ai clienti" },
    { title: "AUTO A1 · Riepilogo settimanale" },
    { title: "Strategia per volo" },
  ]);
  const items = ["LIBRA", "LIBRA", "Automazioni", "Automazioni", "Automazioni", "orsa", null].map((group) => ({ valueModel: group ? { ...SMALL, group } : SMALL }));
  const palette = groupPalette(items, PARAMS, agents);
  // I gruppi non hanno colori: né i tre dei gruppi, né quello di un agente.
  assert.deepEqual(palette, { slots: {}, single: false, agents });
  const tone = (agent: string) => `agente-${agentToneOf(agents, agent)}`;
  assert.equal(markSlot(palette, { title: "LIBRA L2 · Pagamenti", group: "Automazioni" }), tone("LIBRA"), "il titolo, non il gruppo");
  // Un gruppo con il nome di un agente non fa di quell'agente una scheda senza il prefisso.
  assert.equal(markSlot(palette, { title: "Controllo dei preventivi del catering", group: "ORSA" }), 0);
  assert.equal(markSlot(palette, { title: "Controllo dei preventivi del catering", group: "orsa" }), 0);
  assert.equal(markSlot(palette, { title: "IVA · Calcolo dell'imposta", group: null }), 0, "un agente senza tono (solo proposte): grigio");
  // Lo stesso colore del punto della «Matrice Valore × Costo» e del tag.
  for (const title of ["LIBRA L2 · Pagamenti", "ORSA O1 · Solleciti ai clienti", "Strategia per volo", "IVA · Calcolo dell'imposta"]) {
    assert.equal(markSlot(palette, { title, group: "LIBRA" }), agentPointSlot(agents, title), title);
  }
  // Il gruppo non si scrive: il colore è dell'agente, che il titolo dice già.
  assert.deepEqual([groupLabelOf(palette, "LIBRA"), groupLabelOf(palette, "Automazioni"), groupLabelOf(palette, null)], [null, null, null]);
  // La legenda: quella della matrice, gli agenti dei segni e poi «Altri use case».
  const marks = [
    { title: "ORSA O1 · Solleciti ai clienti", group: "Automazioni" },
    { title: "Controllo dei preventivi del catering", group: "ORSA" },
    { title: "LIBRA L2 · Pagamenti", group: null },
  ];
  assert.deepEqual(markLegend(palette, marks), [
    { slot: tone("LIBRA"), label: "LIBRA" },
    { slot: tone("ORSA"), label: "ORSA" },
    { slot: 0, label: "Altri use case" },
  ]);
  assert.deepEqual(markLegend(palette, marks), agentPointLegend(agents, marks.map((mark) => mark.title)));
  // Agenti nei titoli e nessun gruppo: i toni degli agenti lo stesso (prima tutto grigio, senza legenda).
  const none = groupPalette([{ valueModel: SMALL }], PARAMS, agents);
  assert.equal(none.single, false);
  assert.equal(markSlot(none, { title: "LIBRA L1 · Fatture", group: null }), tone("LIBRA"));
  assert.deepEqual(markLegend(none, [{ title: "LIBRA L1 · Fatture", group: null }]), [{ slot: tone("LIBRA"), label: "LIBRA" }]);
  // Senza agenti nei titoli i colori dei gruppi di sempre: il prefisso non conta.
  const plain = groupPalette(items, PARAMS, agentPalette([{ title: "Strategia per volo" }]));
  assert.equal(plain.agents, null);
  assert.deepEqual(plain.slots, { Automazioni: 1, LIBRA: 2, orsa: 3 });
  assert.equal(markSlot(plain, { title: "ORSA O1 · Solleciti ai clienti", group: "LIBRA" }), 2);
  assert.equal(groupLabelOf(plain, "orsa"), "Gruppo orsa");
  assert.deepEqual(markLegend(plain, marks), groupLegend(plain, marks.map((mark) => mark.group)));
});

test("colori con gli agenti nei titoli: TopJet, le bolle e la curva come la matrice e le card", () => {
  // La forma di TopJet (29/10/2026): i gruppi hanno il nome dell'agente, «Automazioni» i sette AUTO;
  // «TJ-0051» è una copia approvata di un ORSA senza il prefisso, nel gruppo «ORSA».
  const titles = [
    "ALCIONE A1 · Presenze del personale di terra",
    "AUTO X1 · Estratti conto in Echo",
    "DENEB D1 · Richieste di riposo e ferie",
    "LIBRA L1 · Lettura delle fatture estere",
    "MAIA M3 · Canale unico per le note spese",
    "MEROPE R3 · Checklist di ingresso e uscita",
    "ORSA O1 · Voli pieni, vuoti ed empty leg",
    "SIRIO S3 · File F24 delle tasse passeggeri",
    "SPICA P3 · Calendario dei pagamenti",
    "TAIGETE T3 · Pratiche ENAC",
  ];
  const agents = agentPalette(titles.map((title) => ({ title })));
  const card = (title: string, group: string | null, o: Partial<HubSourceRow> = {}) => item({ title, valueModel: { ...FIX_A, group: group ?? undefined }, ...o });
  const auto = [1, 2, 3, 4, 5, 6, 7].map((n) => card(`AUTO X${n} · Automazione ${n}`, "Automazioni"));
  const orsa = card("ORSA O1 · Voli pieni, vuoti ed empty leg", "ORSA");
  const copy = card("Controllo dei preventivi dei fornitori di catering", "ORSA");
  // Due agenti nello stesso gruppo: ognuno il suo tono (prima il gruppo era grigio).
  const libra = card("LIBRA L1 · Lettura delle fatture estere", "Operazioni", { status: "in_progress" });
  const sirio = card("SIRIO S3 · File F24 delle tasse passeggeri", "Operazioni");
  // Un gruppo con il nome di un agente non dà l'agente: «maia» non fa MAIA una bozza senza prefisso.
  const draft = card("Bozza di registrazione", "maia");
  // Un agente senza gruppo ha il suo tono (prima il grigio di «Senza gruppo»).
  const alcione = card("ALCIONE A1 · Presenze del personale di terra", null);
  // Una proposta senza prefisso con la facilità, nel gruppo di AUTO: grigia lei sola.
  const proposal = card("Smistamento automatico delle PEC", "Automazioni", TO_DECIDE);
  const all = [...auto, orsa, copy, libra, sirio, draft, alcione, proposal];
  const palette = groupPalette(all, PARAMS, agents);
  const bubbles = buildBenefitBubbles(all, PARAMS, TODAY, palette).bubbles;
  const tempo = buildLeverChart(all, PARAMS, palette).rows.find((row) => row.lever === "tempo")!;
  const slotOf = (marks: readonly { id: string; slot: unknown }[], id: string) => marks.find((mark) => mark.id === id)?.slot;
  for (const it of all) {
    // Il tono del tag della card (lanes.ts) e del punto della matrice.
    const expected = agentPointSlot(agents, it.title);
    if (bubbles.some((bubble) => bubble.id === it.id)) assert.equal(slotOf(bubbles, it.id), expected, `bolla ${it.title}`);
    if (it.phase !== "da_valutare") assert.equal(slotOf(tempo.segments, it.id), expected, `segmento ${it.title}`);
  }
  assert.deepEqual(
    [orsa, copy, libra, sirio, draft, alcione, proposal, auto[0]].map((it) => slotOf(it.phase === "in_realizzazione" ? tempo.segments : bubbles, it.id)),
    ["agente-7", 0, "agente-4", "agente-8", 0, "agente-1", 0, "agente-2"],
  );
  // La proposta senza prefisso non toglie ai sette AUTO il loro tono (prima il gruppo diventava grigio).
  assert.ok(auto.every((it) => slotOf(bubbles, it.id) === "agente-2"));
  assert.ok([...bubbles, ...tempo.segments, ...tempo.qualitative].every((mark) => mark.groupLabel === null), "nessun «Gruppo …» né nome dell'agente in coda");
  assert.deepEqual(
    markLegend(palette, bubbles).map((entry) => entry.label),
    ["ALCIONE", "AUTO", "ORSA", "SIRIO", "Altri use case"],
  );
  // Senza agenti nei titoli i gruppi tengono i loro tre colori, e la proposta resta del suo gruppo.
  const plain = groupPalette(all, PARAMS, agentPalette([{ title: "Strategia per volo" }]));
  assert.deepEqual(plain.slots, { Automazioni: 1, Operazioni: 2, ORSA: 3 });
  const plainBubbles = buildBenefitBubbles(all, PARAMS, TODAY, plain).bubbles;
  assert.deepEqual(
    [copy, proposal, orsa].map((it) => plainBubbles.find((bubble) => bubble.id === it.id)).map((bubble) => [bubble?.slot, bubble?.groupLabel]),
    [
      [3, "Gruppo ORSA"],
      [1, "Gruppo Automazioni"],
      [3, "Gruppo ORSA"],
    ],
  );
});

test("un nome solo per il grigio: «Altri use case» nelle tre legende, nessun «Gruppo …» sulle bolle e sui segmenti", () => {
  // La forma di TopJet con «TJ-0051» (29/10/2026): una copia senza il prefisso nel gruppo «Varie».
  const titles = ["AUTO X1 · Estratti conto in Echo", "LIBRA L1 · Lettura delle fatture estere", "SIRIO S1 · Cassa"];
  const agents = agentPalette(titles.map((title) => ({ title })));
  const auto = item({ title: "AUTO X1 · Estratti conto in Echo", valueModel: { ...FIX_A, group: "Automazioni" } });
  const libra = item({ title: "LIBRA L1 · Lettura delle fatture estere", valueModel: { ...FIX_A, group: "LIBRA" } });
  const copy = item({ title: "Controllo dei preventivi dei fornitori di catering", valueModel: { ...FIX_A, group: "Varie" } });
  // SIRIO senza gruppo: SIRIO, come nella matrice (prima il grigio di «Senza gruppo»).
  const sirio = item({ title: "SIRIO S1 · Cassa", valueModel: { ...FIX_A, group: undefined } });
  const all = [auto, libra, copy, sirio];
  const palette = groupPalette(all, PARAMS, agents);
  const bubbles = buildBenefitBubbles(all, PARAMS, TODAY, palette).bubbles;
  const tempo = buildLeverChart(all, PARAMS, palette).rows.find((row) => row.lever === "tempo")!;
  const greyOf = (legend: { slot: unknown; label: string }[]) => legend.find((entry) => entry.slot === 0)?.label;
  // Le bolle, la curva e la matrice: lo stesso nome del grigio, quello di «Per agente» e del filtro «Agente».
  assert.equal(greyOf(markLegend(palette, bubbles)), NO_AGENT_LABEL);
  assert.equal(greyOf(markLegend(palette, roadmapValueItems(all).map((it) => ({ title: it.title, group: it.valueModel?.group ?? null })))), NO_AGENT_LABEL);
  assert.equal(greyOf(agentPointLegend(agents, all.map((it) => it.title))), NO_AGENT_LABEL);
  assert.equal(NO_AGENT_LABEL, "Altri use case");
  // Il grigio è solo la copia senza prefisso; nessun segno dice il suo colore a parole, grigio o agente.
  assert.deepEqual(
    bubbles.filter((bubble) => bubble.slot === 0).map((bubble) => bubble.id),
    [copy.id],
  );
  assert.equal(bubbles.find((bubble) => bubble.id === sirio.id)?.slot, agentPointSlot(agents, sirio.title));
  assert.ok([...bubbles, ...tempo.segments, ...tempo.qualitative].every((mark) => mark.groupLabel === null));
  // Senza agenti nei titoli i gruppi hanno i loro nomi, come sempre.
  const plain = groupPalette([...all, item({ valueModel: SMALL })], PARAMS, agentPalette([{ title: "Strategia per volo" }]));
  assert.deepEqual([groupLabelOf(plain, "Varie"), groupLabelOf(plain, null)], ["Gruppo Varie", "Senza gruppo"]);
  assert.deepEqual(
    groupLegend(plain, ["Automazioni", "LIBRA", "Varie", null, "Vendite"]).map((entry) => entry.label),
    ["Automazioni", "LIBRA", "Varie", "Altri gruppi (Vendite) e senza gruppo"],
  );
});

test("matrice Valore × Costo con gli agenti nei titoli: il punto nel tono dell'agente, grigio senza; la legenda per agente", () => {
  const agents = agentPalette([{ title: "LIBRA L1 · Fatture" }, { title: "AUTO X1 · Bonifici" }, { title: "ORSA O1 · Voli" }]);
  assert.equal(agentPointSlot(agents, "LIBRA L2 · Pagamenti"), `agente-${agentToneOf(agents, "LIBRA")}`);
  assert.equal(agentPointSlot(agents, "Strategia per volo"), 0, "senza agente: grigio");
  assert.equal(agentPointSlot(agents, "IVA · Calcolo dell'imposta"), 0, "un agente senza tono (solo proposte): grigio");
  assert.equal(agentPointSlot(agentPalette([{ title: "Strategia per volo" }]), "LIBRA L1 · Fatture"), null, "senza agenti nel workspace: l'origine");
  assert.equal(agentPointSlot(null, "LIBRA L1 · Fatture"), null);
  assert.deepEqual(agentPointLegend(agents, ["ORSA O1 · Voli", "LIBRA L1 · Fatture", "LIBRA L2 · Pagamenti", "Strategia per volo"]), [
    { slot: `agente-${agentToneOf(agents, "LIBRA")}`, label: "LIBRA" },
    { slot: `agente-${agentToneOf(agents, "ORSA")}`, label: "ORSA" },
    { slot: 0, label: "Altri use case" },
  ]);
  assert.deepEqual(agentPointLegend(agents, ["AUTO X1 · Bonifici"]), [{ slot: `agente-${agentToneOf(agents, "AUTO")}`, label: "AUTO" }], "solo gli agenti che hanno un punto");
  assert.deepEqual(agentPointLegend(agentPalette([]), ["LIBRA L1 · Fatture"]), []);
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
  // Un titolo con l'agente: sulla curva il tag delle card della Panoramica, non il codice.
  const libra = item({ valueModel: FIX_A, title: "LIBRA L1 · Lettura delle fatture estere" });
  assert.deepEqual(buildRoadmapValue([libra, b], PARAMS)?.goLives.map((mark) => mark.names), [["LIBRA L1", b.code]]);
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
  // Il totale della riga è la somma delle cifre dei segmenti come le scrivono: 4.043 € + 2.184 €.
  assert.equal(by.tempo.total, 4_043 + 2_184, "totale contato");
  assert.equal(
    by.tempo.total,
    by.tempo.segments.reduce((sum, segment) => sum + roundAmount(segment.eur), 0),
  );
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
  near(chart.max, 4_043 + 2_184 + 1680, "la riga più lunga");
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
