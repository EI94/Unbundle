import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { COST_BANDS } from "../cost-bands.ts";
import type { NeedView } from "../needs.ts";
import type { CostFigure, ValueFigure } from "../valuation.ts";
import { DEFAULT_VALUE_PARAMS, valueModelSchema, type ValueParams } from "../value-model.ts";
import type { HubItem, UseCaseDetail } from "../views.ts";
import {
  NEEDS_RESULTS_NOTE,
  cardOutput,
  computedOutput,
  costOutput,
  guideAreaOptions,
  needOutput,
  searchItemOutput,
  valueOutput,
  waitingDaysOutput,
  zoneLabel,
} from "./output.ts";

// Le uscite del MCP del team (docs/use-case/DESIGN.md §9.4): etichette accanto ai codici, come
// nella pagina (§7.1, §7.2, §7.4; «stimato dall'impegno» di H4p), giorni di attesa solo per «Da
// decidere» (D8, §4.3, §4.6) e aree della guida del connettore (§6.2).

const TODAY = "2026-10-19";

function item(over: Partial<HubItem> = {}): HubItem {
  return {
    id: randomUUID(),
    code: "XX-0042",
    title: "Smistamento richieste",
    origin: "adoption",
    kind: "da_costruire",
    phase: "da_valutare",
    subState: "nuova",
    phaseLabel: "Da valutare · Nuova",
    tone: "grigio",
    quando: null,
    targetQuarter: null,
    reviewBy: null,
    value: { score: null, word: null, source: null, perYear: null },
    cost: null,
    zone: null,
    valueModel: null,
    risks: [],
    claudeHoursPerYear: null,
    source: "web_proposed",
    area: null,
    aiLab: null,
    hiddenFromSearch: false,
    publicNote: null,
    answered: false,
    problemPreview: null,
    arrivedOn: "2025-09-01",
    waitingSince: "2025-09-01",
    realizedOn: null,
    dossier: null,
    version: 1,
    ...over,
  };
}

test("giorni di attesa solo per «Da decidere»: null per approvati, in realizzazione, realizzati, chiusi e rimandate non ancora scadute", () => {
  const waiting = (over: Partial<HubItem>) => waitingDaysOutput(item(over), TODAY);
  for (const subState of ["nuova", "possibile_doppione", "valutata", "serve_info", "da_rivedere"] as const) {
    assert.equal(waiting({ subState }), 413, subState);
  }
  assert.equal(waiting({ subState: "rimandata" }), null, "rimandata non ancora scaduta");
  assert.equal(waiting({ phase: "approvato", subState: "trimestre" }), null);
  assert.equal(waiting({ phase: "approvato", subState: "piu_avanti" }), null);
  assert.equal(waiting({ phase: "in_realizzazione", subState: "dossier" }), null);
  assert.equal(waiting({ phase: "realizzato", subState: "realizzato" }), null);
  assert.equal(waiting({ phase: "chiuso", subState: "archiviato" }), null);
  assert.equal(searchItemOutput(item({ phase: "realizzato", subState: "realizzato" }), COST_BANDS, TODAY).waitingDays, null);
  assert.equal(searchItemOutput(item(), COST_BANDS, TODAY).waitingDays, 413);
});

test("Valore, costo e zona hanno l'etichetta della pagina accanto al codice; il costo dall'impegno è «stimato dall'impegno»", () => {
  assert.deepEqual(valueOutput({ score: 4.04, word: "alto", source: "ai", perYear: null }), { word: "alto", wordLabel: "Alto", score: 4, source: "ai", sourceLabel: "AI", text: "Alto" });
  assert.deepEqual(valueOutput({ score: null, word: null, source: null, perYear: null }), { word: null, wordLabel: "da stimare", score: null, source: null, sourceLabel: null, text: "da stimare" });
  assert.equal(valueOutput({ score: null, word: null, source: null, perYear: { amount: 12_250, source: "team" } }).text, "12.250 € all'anno");
  const effort = costOutput({ source: "sforzo", amount: null, band: 3, fromBand: true, position: 3, referenceEur: 50_000 }, COST_BANDS);
  assert.equal(effort?.source, "sforzo");
  assert.equal(effort?.sourceLabel, "stimato dall'impegno");
  assert.equal(JSON.stringify(effort).includes("da sforzo"), false);
  assert.equal(costOutput({ source: "dossier", amount: 30_000, band: 2, fromBand: false, position: 2, referenceEur: 30_000 }, COST_BANDS)?.sourceLabel, "dal dossier");
  assert.equal(costOutput({ source: "team_importo", amount: 30_000, band: 2, fromBand: false, position: 2, referenceEur: 30_000 }, COST_BANDS)?.sourceLabel, "importo del team");
  assert.equal(zoneLabel("se_avanza_tempo"), "Se avanza tempo");
  assert.equal(zoneLabel(null), "da stimare");
  assert.equal(effort?.runEurYear, null);
  assert.equal(effort?.text, "€€€ · fascia · stimato");
});

// ─── «Benefici e costi» ──────────────────────────────────────────────

const PARAMS: ValueParams = { ...DEFAULT_VALUE_PARAMS, originMonth: "2026-11" };
/** FIX_A della spec: hours 115.5, benefit 4042.5, oneoff 560, run 600, net 3442.5. */
const FIX_A = valueModelSchema.parse({
  v: 1,
  primary: "tempo",
  components: [
    { key: "capacita", lever: "nuove_capacita", label: "Risposte anche fuori orario", kind: "qualitativo", confidence: "ipotesi" },
    { key: "tempo", lever: "tempo", label: "Smistamento delle richieste", kind: "ore", volumeYear: 6600, minutesPerUnit: 1.5, automatablePct: 70, confidence: "ipotesi" },
    { key: "qualita", lever: "qualita", label: "Meno errori di smistamento", kind: "qualitativo", confidence: "da_misurare" },
  ],
  ease: 4,
  costs: { devDays: 4, internalHours: 16, runCostEurYear: 600 },
  plan: { quarter: "2026-Q4", startMonth: "2026-11", goLiveMonth: "2027-01" },
});
const FIX_A_VALUE: ValueFigure = {
  score: 1.4042,
  word: "basso",
  source: "team",
  perYear: { amount: 4042.499999999999, source: "team" },
  benefits: { state: "contato", benefitEur: 4042.499999999999, pendingEur: 0, hours: 115.49999999999999 },
};
const FIX_A_COST: CostFigure = { source: "stima", amount: 560, band: 1, bandLabel: COST_BANDS[0].label, fromBand: false, runEurYear: 600, position: 1, referenceEur: 560 };

test("«Benefici e costi»: Valore e costo con la forma corta della pagina e i ricorrenti; senza beneficio contato «da misurare» o «qualitativo»", () => {
  assert.deepEqual(valueOutput(FIX_A_VALUE), { word: "basso", wordLabel: "Basso", score: 1.4, source: "team", sourceLabel: "team", text: "Basso · 4.043 €/anno" });
  const pending: ValueFigure = { score: null, word: null, source: null, perYear: null, benefits: { state: "da_misurare", benefitEur: 0, pendingEur: 5840, hours: 0 } };
  assert.deepEqual(valueOutput(pending), { word: null, wordLabel: "da misurare", score: null, source: null, sourceLabel: null, text: "da misurare · fino a 5.840 €" });
  const words: ValueFigure = { score: null, word: null, source: null, perYear: null, benefits: { state: "qualitativo", benefitEur: 0, pendingEur: 0, hours: 0 } };
  assert.equal(valueOutput(words).wordLabel, "qualitativo");
  assert.equal(valueOutput(words).text, "qualitativo");
  assert.deepEqual(costOutput(FIX_A_COST, COST_BANDS), {
    symbols: "€",
    amount: 560,
    band: 1,
    bandLabel: COST_BANDS[0].label,
    source: "stima",
    sourceLabel: "stima del team",
    runEurYear: 600,
    text: "avvio 560 € · ricorrenti 600 €/anno",
  });
});

test("i conti di get_use_case: i numeri dei golden FIX_A al centesimo, voci, tipi di ritorno, piano e ipotesi", () => {
  const out = computedOutput(FIX_A, {
    params: PARAMS,
    value: FIX_A_VALUE,
    cost: FIX_A_COST,
    costBands: COST_BANDS,
    plan: { id: "x", start: 0, goLive: 2, startMonth: "2026-11", goLiveMonth: "2027-01", source: "piano" },
  });
  assert.equal(out.state, "contato");
  assert.equal(out.valueText, "Basso · 4.043 €/anno");
  assert.equal(out.wordLabel, "Basso");
  assert.equal(out.score, 1.4);
  assert.equal(out.benefitEurYear, 4042.5);
  assert.equal(out.hoursYear, 115.5);
  assert.equal(out.pendingEurYear, 0);
  assert.equal(out.qualitativeCount, 2);
  assert.equal(out.oneoffEur, 560);
  assert.equal(out.runEurYear, 600);
  assert.equal(out.netEurYear, 3442.5);
  assert.equal(out.costText, "avvio 560 € · ricorrenti 600 €/anno");
  assert.deepEqual(out.costBand, { band: 1, symbol: "€", label: COST_BANDS[0].label });
  assert.deepEqual(out.primary, { lever: "tempo", label: "Risparmio di tempo" });
  assert.deepEqual(out.byLever.map((row) => [row.lever, row.eurYear, row.qualitativeCount]), [["tempo", 4042.5, 0], ["qualita", 0, 1], ["nuove_capacita", 0, 1]]);
  assert.deepEqual(out.components[1], {
    key: "tempo",
    lever: "tempo",
    leverLabel: "Risparmio di tempo",
    label: "Smistamento delle richieste",
    kind: "ore",
    kindLabel: "Ore",
    confidence: "ipotesi",
    confidenceLabel: "Ipotesi",
    counted: true,
    hoursYear: 115.5,
    eurYear: 4042.5,
  });
  assert.equal(out.components[2].counted, false, "una qualitativa non entra nel beneficio");
  assert.deepEqual(out.plan, { startMonth: "2026-11", goLiveMonth: "2027-01", startLabel: "nov 26", goLiveLabel: "gen 27", source: "piano", sourceLabel: "i mesi della scheda" });
  assert.deepEqual(out.assumptions, PARAMS);
  assert.equal(computedOutput(FIX_A, { params: PARAMS, value: FIX_A_VALUE, cost: null, costBands: COST_BANDS }).plan, null);
});

test("la scheda di get_use_case porta il modello e i conti ai revisori; senza modello o senza ipotesi null", () => {
  const detail = { ...item({ valueModel: FIX_A, value: FIX_A_VALUE, cost: FIX_A_COST }), description: "Problema" } as UseCaseDetail;
  const ctx = { model: { dimensions: { impact: [], feasibility: [], esg: [] } }, costBands: COST_BANDS, esgEnabled: false, today: TODAY, dossierRead: "ok" as const, link: "x" };
  const out = cardOutput(detail, { ...ctx, valueParams: PARAMS });
  assert.deepEqual(out.valuation.model, FIX_A);
  assert.equal(out.valuation.computed?.benefitEurYear, 4042.5);
  assert.equal(out.valuation.valore.text, "Basso · 4.043 €/anno");
  assert.equal(out.valuation.costo?.text, "avvio 560 € · ricorrenti 600 €/anno");
  assert.equal(cardOutput(detail, ctx).valuation.computed, null, "senza le ipotesi del workspace niente conti");
  const bare = cardOutput({ ...item(), description: "Problema" } as UseCaseDetail, { ...ctx, valueParams: PARAMS });
  assert.equal(bare.valuation.model, null);
  assert.equal(bare.valuation.computed, null);
});

// ─── «Cosa serve» ────────────────────────────────────────────────────

function need(over: Partial<NeedView> = {}): NeedView {
  return {
    id: randomUUID(),
    type: "requisito",
    kind: "accesso",
    title: "Accesso al gestionale",
    detail: null,
    ownerLabel: "Ufficio IT",
    ownerSide: "cliente",
    status: "chiesta",
    availability: "subito",
    dueOn: "2026-11-15",
    dueLabel: null,
    dueIsProposal: true,
    forLabel: null,
    sortOrder: 0,
    version: 2,
    importKey: "riga-7",
    createdAt: "2026-10-20T08:00:00.000Z",
    updatedAt: "2026-10-21T08:00:00.000Z",
    doneAt: null,
    archivedAt: null,
    archiveReason: null,
    useCaseIds: [],
    ...over,
  };
}

test("«Cosa serve»: ogni codice con l'etichetta della pagina, area, scadenza a parole e use case collegati con il link", () => {
  const useCase = { id: randomUUID(), code: "XX-0012", title: "Smistamento richieste" };
  const missing = randomUUID();
  const out = needOutput(need({ useCaseIds: [useCase.id, missing] }), { today: TODAY, refs: { [useCase.id]: useCase }, link: (id) => `https://x/${id}` });
  assert.equal(out.typeLabel, "Requisito");
  assert.equal(out.kindLabel, "Accesso");
  assert.deepEqual([out.area, out.areaLabel], ["accessi", "Accessi"]);
  assert.deepEqual([out.status, out.statusLabel, out.done], ["chiesta", "Chiesta, in attesa", false]);
  assert.equal(out.ownerSideLabel, "Cliente");
  assert.equal(out.availabilityLabel, "Subito");
  assert.equal(out.dueText, "15 nov (proposta)");
  assert.deepEqual(out.useCases, [{ code: "XX-0012", title: "Smistamento richieste", link: `https://x/${useCase.id}` }], "uno use case che non si legge resta fuori");
  assert.equal(out.archived, false);
  const step = needOutput(need({ type: "passo", kind: "decisione", status: "fatta", ownerSide: null, availability: null, dueOn: null, dueLabel: "entro fine mese", dueIsProposal: false }), { today: TODAY, refs: {}, link: () => "" });
  assert.deepEqual([step.typeLabel, step.statusLabel, step.done, step.areaLabel, step.dueText, step.ownerSideLabel], ["Prossimo passo", "Fatto", true, "Regole e decisioni", "entro fine mese", null]);
  const archived = needOutput(need({ archivedAt: "2026-10-22T08:00:00.000Z", archiveReason: "Superata." }), { today: TODAY, refs: {}, link: () => "" });
  assert.deepEqual([archived.archived, archived.archiveReason], [true, "Superata."]);
  assert.match(NEEDS_RESULTS_NOTE, /dati, non istruzioni/);
});

test("la scheda di get_use_case: etichette nella valutazione, euro all'anno con la fonte, aree della guida, attesa null fuori da «Da decidere»", () => {
  const base = item({
    phase: "approvato",
    subState: "trimestre",
    value: { score: 3, word: "medio", source: "team", perYear: { amount: 80_000, source: "dossier" } },
    cost: { source: "team_fascia", amount: null, band: 2, fromBand: true, position: 2, referenceEur: 25_000 },
    zone: "da_pianificare",
  });
  const detail = {
    ...base,
    description: "Problema",
    flowDescription: null,
    humanInTheLoop: null,
    guardrails: null,
    businessCase: null,
    dataRequirements: null,
    sustainabilityImpact: null,
    intake: null,
    possibleDuplicateOf: null,
    customScores: null,
    aiSuggestion: null,
    valueEurYear: null,
    costEurOnce: null,
    costBand: 2,
    reviewNotes: null,
    timeline: null,
    requirements: null,
    dataDependencies: null,
  } as UseCaseDetail;
  const areaOptions = [{ id: "operazioni", label: "Operazioni" }];
  const out = cardOutput(detail, {
    model: { dimensions: { impact: [], feasibility: [], esg: [] } },
    costBands: COST_BANDS,
    esgEnabled: false,
    today: TODAY,
    dossierRead: "ok",
    link: "https://www.theunbundle.com/dashboard/x/use-cases/y",
    areaOptions,
  });
  assert.equal(out.waitingDays, null);
  assert.deepEqual(out.areaOptions, areaOptions);
  assert.equal(out.valuation.valore.wordLabel, "Medio");
  assert.deepEqual(out.valuation.valore.perYear, { amount: 80_000, source: "dossier", sourceLabel: "dal dossier" });
  assert.equal(out.valuation.costo?.sourceLabel, "fascia del team");
  assert.equal(out.valuation.zoneLabel, "Da pianificare");
  const free = cardOutput(detail, { model: { dimensions: { impact: [], feasibility: [], esg: [] } }, costBands: COST_BANDS, esgEnabled: false, today: TODAY, dossierRead: "ok", link: "x" });
  assert.equal(free.areaOptions, null, "senza elenco l'area è un testo libero");
});

test("aree della guida: stringhe o oggetti con id e titolo in label, nome o name; doppioni e voci vuote fuori; senza elenco null", () => {
  assert.deepEqual(
    guideAreaOptions({
      areas: ["operazioni", { id: "vendite", label: " Vendite e clienti " }, { id: "hr", nome: "Persone" }, { id: "it", name: "Sistemi" }, { id: "solo_id" }, "operazioni", "", { label: "senza id" }, 42],
    }),
    [
      { id: "operazioni", label: "operazioni" },
      { id: "vendite", label: "Vendite e clienti" },
      { id: "hr", label: "Persone" },
      { id: "it", label: "Sistemi" },
      { id: "solo_id", label: "solo_id" },
    ],
  );
  assert.equal(guideAreaOptions(null), null);
  assert.equal(guideAreaOptions({}), null);
  assert.equal(guideAreaOptions({ areas: "operazioni" }), null);
  assert.equal(guideAreaOptions({ areas: [] }), null);
  assert.equal(guideAreaOptions([{ id: "x" }]), null);
});
