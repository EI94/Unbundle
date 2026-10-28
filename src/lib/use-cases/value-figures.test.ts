import test from "node:test";
import assert from "node:assert/strict";
import { COST_BANDS, bandForAmount, costPosition } from "./cost-bands.ts";
import { teamValuationMissing } from "./decision-ui.ts";
import {
  costLongText,
  costShortText,
  hasEuroValue,
  oneoffRunText,
  showsZone,
  valueLongText,
  valueScreenLongText,
  valueScreenText,
  valueShortText,
  valueWordText,
  zoneText,
} from "./format.ts";
import { projectForContributor, type ContributorSourceRow } from "./permissions.ts";
import { hasTeamValuation, type ValuationModel } from "./valuation.ts";
import { modelEstimate } from "./value-calc.ts";
import { DEFAULT_VALUE_PARAMS, valueModelSchema, type ValueModel, type ValueParams } from "./value-model.ts";
import {
  applyHubFilters,
  buildPriority,
  exportRow,
  hubValueParams,
  isOffMatrix,
  isToEstimate,
  offMatrixLabel,
  parseHubParams,
  projectHubItem,
  projectUseCaseDetail,
  roadmapTotals,
  type DetailSourceRow,
  type HubContext,
  type HubSourceRow,
} from "./views.ts";

// «Benefici e costi» nelle cifre dell'area (spec di Pierpaolo, 25/10/2026): Valore e costo con un
// modello, la forma breve delle righe, la matrice, le cifre della Roadmap e l'export. Dati sintetici.

const TODAY = "2026-11-03";
const PARAMS: ValueParams = { ...DEFAULT_VALUE_PARAMS, originMonth: "2026-11" };
const MODEL: ValuationModel = {
  dimensions: {
    impact: [{ id: "efficiency" }, { id: "profitability" }],
    feasibility: [{ id: "effort", direction: "lower_better" }],
    esg: [],
  },
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
  plan: PLAN,
});

/** Solo voci da misurare: 600 × 6 min × 80% = 48 h, 1.680 €; più 4.160 € da misurare. */
const PENDING_ONLY: ValueModel = valueModelSchema.parse({
  v: 1,
  primary: "tempo",
  components: [
    { key: "tempo", lever: "tempo", label: "Solleciti ai fornitori", kind: "ore", volumeYear: 600, minutesPerUnit: 6, automatablePct: 80, confidence: "da_misurare" },
    { key: "costi", lever: "costi", label: "Meno licenze", kind: "euro", eurYear: 4160, confidence: "da_misurare" },
  ],
});

/** Solo a parole, senza costi. */
const WORDS_ONLY: ValueModel = valueModelSchema.parse({
  v: 1,
  primary: "rischio",
  components: [{ key: "rischio", lever: "rischio", label: "Meno pagamenti doppi", kind: "qualitativo", confidence: "ipotesi" }],
});

let seq = 0;
function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function row(o: Partial<DetailSourceRow> = {}): DetailSourceRow {
  seq += 1;
  return {
    id: uuid(seq),
    code: `XX-${String(seq).padStart(4, "0")}`,
    title: `Use case di prova ${seq}`,
    description: "Smistare le richieste in arrivo.",
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
    version: 4,
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
    flowDescription: null,
    humanInTheLoop: null,
    guardrails: null,
    businessCase: null,
    dataRequirements: null,
    sustainabilityImpact: null,
    reviewNotes: null,
    timeline: null,
    requirements: null,
    dataDependencies: null,
    ...o,
  };
}

const item = (o: Partial<HubSourceRow> = {}, ctx: HubContext = CTX) => projectHubItem(row(o), ctx, null);

function near(actual: number | null | undefined, expected: number, label: string) {
  assert.ok(typeof actual === "number" && Math.abs(actual - expected) <= 1e-6, `${label}: ${actual} invece di ${expected}`);
}

// ─── Valore e costo con un modello ───────────────────────────────────

test("FIX_A: Valore dal beneficio contato (4.042,5 €, Basso · 1,4), costo «stima» dall'avvio nelle fasce", () => {
  const a = item({ valueModel: FIX_A, customScores: { impact: { efficiency: 5, profitability: 5 } }, valueEurYear: 99_000, costEurOnce: 80_000 });
  // Il modello vale al posto dei KPI d'impatto, del valore all'anno e dell'importo del team.
  near(a.value.score, 1 + (4042.5 * 1.5) / 15_000, "punteggio interpolato");
  assert.equal(a.value.word, "basso");
  assert.equal(a.value.source, "team");
  assert.equal(a.value.perYear?.source, "team");
  near(a.value.perYear?.amount, 4042.5, "all'anno");
  assert.equal(valueShortText(a.value), "Basso · 4.043 €/anno", "4.042,4999… si legge 4.043");
  assert.equal(a.value.benefits?.state, "contato");
  near(a.value.benefits?.hours, 115.5, "ore");
  assert.equal(a.cost?.source, "stima");
  assert.equal(a.cost?.amount, 560);
  assert.equal(a.cost?.runEurYear, 600);
  assert.equal(a.cost?.fromBand, false);
  assert.equal(a.cost?.band, bandForAmount(560, COST_BANDS));
  assert.equal(a.cost?.position, costPosition({ amount: 560 }, COST_BANDS));
  assert.equal(a.cost?.referenceEur, 560);
  // Zona: Basso e costo basso → «Se avanza tempo».
  assert.equal(a.zone, "se_avanza_tempo");
  assert.equal(isToEstimate(a), false);
  assert.deepEqual(a.valueModel, FIX_A);
});

test("FIX_B: beneficio 2.719 €, 1.680 € da misurare fuori dal totale, ricorrenti a zero", () => {
  const b = item({ valueModel: FIX_B });
  assert.equal(b.value.benefits?.state, "contato");
  near(b.value.benefits?.benefitEur, 2719, "beneficio");
  near(b.value.benefits?.pendingEur, 1680, "da misurare");
  near(b.value.perYear?.amount, 2719, "all'anno");
  assert.equal(b.cost?.amount, 280);
  assert.equal(b.cost?.runEurYear, 0);
  assert.equal(costShortText(b.cost), "avvio 280 €");
});

test("modello senza beneficio contato: «da misurare · fino a X €» o «qualitativo»; mai da stimare, nessun punto in matrice", () => {
  const pending = item({ valueModel: PENDING_ONLY, valueEurYear: 12_250, customScores: { impact: { efficiency: 4, profitability: 4 } } });
  assert.equal(pending.value.score, null);
  assert.equal(pending.value.word, null);
  assert.equal(pending.value.perYear, null, "il valore all'anno scritto a mano non vale con un modello");
  assert.equal(pending.value.benefits?.state, "da_misurare");
  near(pending.value.benefits?.pendingEur, 5840, "fino a");
  assert.equal(pending.cost, null, "senza costi nel modello: la solita scala, qui vuota");
  assert.equal(pending.zone, null);
  assert.equal(isToEstimate(pending), false);
  assert.equal(valueShortText(pending.value), "da misurare · fino a 5.840 €");
  assert.equal(valueLongText(pending.value), "da misurare · fino a 5.840 €");

  const words = item({ valueModel: WORDS_ONLY, costEurOnce: 40_000 });
  assert.equal(words.value.benefits?.state, "qualitativo");
  assert.equal(valueShortText(words.value), "qualitativo");
  assert.equal(valueWordText(words.value), "qualitativo");
  // Senza costi nel modello vale l'importo del team.
  assert.equal(words.cost?.source, "team_importo");
  assert.equal(isToEstimate(words), false);

  const counted = item({ valueModel: FIX_A });
  const view = buildPriority([counted, pending, words, item()], null);
  assert.equal(view.tipo, "costruire");
  if (view.tipo !== "costruire") return;
  assert.deepEqual(
    view.points.map((p) => p.id),
    [counted.id],
    "in matrice solo chi ha punteggio e costo",
  );
  near(view.points[0].y, counted.value.score!, "y = punteggio interpolato");
  assert.equal(view.points[0].x, counted.cost!.position);
  assert.equal(view.toEstimate, 1, "solo la scheda senza modello e senza valutazione");
  assert.equal(view.list.at(-1)?.value.benefits, undefined, "la scheda da stimare resta in fondo");
  // Fuori dalla matrice, ma contate a parte: il chip «2 senza beneficio contato o costo» (a pending manca anche il costo).
  assert.deepEqual(view.offMatrix, { count: 2, withoutBenefit: 2 });
  assert.equal(offMatrixLabel(view.offMatrix), "2 senza beneficio contato");
  assert.equal(offMatrixLabel({ count: 3, withoutBenefit: 2 }), "3 senza beneficio contato o costo");
  assert.equal(isOffMatrix(pending), true);
  assert.equal(isOffMatrix(words), true);
  assert.equal(isOffMatrix(counted), false);
  assert.equal(isOffMatrix(item()), false, "senza modello: è «da stimare», non fuori dalla matrice");
  // Il filtro della lista: `stima=fuori-matrice`.
  const reviewer = { userId: "u1", email: "lead@lateralspace.it", emailVerified: true, role: "transformation_lead", isLateralSpace: true };
  const params = parseHubParams(new URLSearchParams("vista=priorita&mostra=lista&stima=fuori-matrice"), reviewer);
  assert.equal(params.stima, "fuori-matrice");
  assert.deepEqual(
    applyHubFilters([counted, pending, words, item()], params, { ignoreKind: true }).map((card) => card.id),
    [pending.id, words.id],
  );
  // La zona dice la stessa cosa del Valore.
  assert.equal(zoneText(pending.zone, pending.value), "senza beneficio contato");
  assert.equal(zoneText(words.zone, words.value), "senza beneficio contato");
  assert.equal(zoneText(null, item().value), "da stimare");
  assert.equal(zoneText("subito", counted.value), "Subito");
});

test("un modello non valido si legge come nessun modello", () => {
  const broken = item({ valueModel: { v: 1, primary: "tempo", components: [] }, valueEurYear: 12_250 });
  assert.equal(broken.valueModel, null);
  assert.equal(broken.value.benefits, undefined);
  assert.equal(isToEstimate(broken), true);
  // Senza parola ma con il valore all'anno: «12.250 € all'anno».
  assert.equal(valueShortText(broken.value), "12.250 € all'anno");
});

// ─── Testi ───────────────────────────────────────────────────────────

test("forme corte e lunghe: «Medio · 4.043 €/anno», «avvio 560 € · ricorrenti 600 €/anno»", () => {
  const benefits = { state: "contato" as const, benefitEur: 4042.5, pendingEur: 0, hours: 115.5 };
  const medium = { score: 2.6, word: "medio" as const, source: "team" as const, perYear: { amount: 4042.5, source: "team" as const }, benefits };
  assert.equal(valueShortText(medium), "Medio · 4.043 €/anno");
  assert.equal(valueLongText(medium), "Medio · 2,6");
  assert.equal(valueShortText({ word: null, perYear: null }), "da stimare");
  assert.equal(valueShortText({ word: "alto", perYear: { amount: 60_000, source: "team" } }), "Alto", "senza modello la parola sola");
  assert.equal(oneoffRunText(560, 600), "avvio 560 € · ricorrenti 600 €/anno");
  assert.equal(oneoffRunText(1_250, 0), "avvio 1.250 €");
  const cost = { source: "stima" as const, amount: 560, band: 1 as const, fromBand: false, runEurYear: 600 };
  assert.equal(costShortText(cost), "avvio 560 € · ricorrenti 600 €/anno", "corta: senza fonte, come la spec");
  assert.equal(costLongText(cost), "avvio 560 € · ricorrenti 600 €/anno");
});

test("a schermo: con una cifra in euro solo la cifra, senza parola né zona; il MCP e l'export tengono la parola", () => {
  // Beneficio contato: la cifra sola, la zona resta nella proiezione (matrice, export, MCP).
  const a = item({ valueModel: FIX_A });
  assert.equal(valueScreenText(a.value), "4.043 €/anno");
  assert.equal(valueScreenLongText(a.value), "4.043 € all'anno");
  assert.equal(showsZone(a.value), false);
  assert.equal(a.zone, "se_avanza_tempo");
  assert.equal(valueShortText(a.value), "Basso · 4.043 €/anno", "la forma con la parola non cambia");
  assert.equal(valueScreenText(item({ valueModel: FIX_B }).value), "2.719 €/anno");

  // Solo il tetto «da misurare»: anche questa è una cifra in euro.
  const pending = item({ valueModel: PENDING_ONLY });
  assert.equal(valueScreenText(pending.value), "da misurare · fino a 5.840 €");
  assert.equal(valueScreenLongText(pending.value), "da misurare · fino a 5.840 €");
  assert.equal(hasEuroValue(pending.value), true);
  assert.equal(showsZone(pending.value), false);

  // Solo a parole: nessuna cifra, la zona resta.
  const words = item({ valueModel: WORDS_ONLY });
  assert.equal(valueScreenText(words.value), "qualitativo");
  assert.equal(showsZone(words.value), true);
  assert.equal(zoneText(words.zone, words.value), "senza beneficio contato");

  // Senza modello: punteggio basso e valore all'anno del team (il caso di produzione).
  const team = { customScores: { impact: { efficiency: 2, profitability: 2 } }, valueEurYear: 12_250, costEurOnce: 10_000 };
  const low = item(team);
  assert.equal(low.value.word, "basso");
  assert.equal(valueScreenText(low.value), "12.250 €/anno");
  assert.equal(valueScreenLongText(low.value), "12.250 € all'anno");
  assert.equal(showsZone(low.value), false);
  const detail = projectUseCaseDetail(row(team), CTX, null);
  const out = exportRow(detail, detail);
  assert.equal(out.Valore, "Basso", "l'export tiene la parola");
  assert.equal(out.Zona, zoneText(detail.zone, detail.value), "e la zona");
  assert.equal(out.Zona, "Se avanza tempo");

  // Il solo punteggio dell'AI: la parola e la zona, come prima.
  const ai = item({ aiSuggestion: { scores: { impact: { efficiency: 5, profitability: 5 } } } }, { ...CTX, model: { ...MODEL, scoringVersion: 2 } });
  assert.equal(ai.value.source, "ai");
  assert.equal(valueScreenText(ai.value), "Alto");
  assert.equal(showsZone(ai.value), true);

  // 0 € non è una cifra: resta la parola.
  const zero = item({ customScores: { impact: { efficiency: 4, profitability: 4 } }, valueEurYear: 0 });
  assert.equal(valueScreenText(zero.value), "Alto");
  assert.equal(valueScreenLongText(zero.value), "Alto · 4,0");
  assert.equal(showsZone(zero.value), true);

  // Un modello non valido vale come nessun modello: gli euro del team nella forma corta a schermo.
  const broken = item({ valueModel: { v: 1, primary: "tempo", components: [] }, valueEurYear: 12_250 });
  assert.equal(valueScreenText(broken.value), "12.250 €/anno");
  assert.equal(valueShortText(broken.value), "12.250 € all'anno");

  assert.equal(valueScreenText(item().value), "da stimare");
  assert.equal(showsZone(item().value), true);
});

// ─── Valutazione del team, Roadmap, export ───────────────────────────

test("con un modello: valutazione del team (Riapri, Approva)", () => {
  assert.equal(hasTeamValuation({ valueModel: FIX_A }), true);
  assert.equal(hasTeamValuation({ valueModel: { v: 1 } }), false, "un modello non valido non conta");
  assert.equal(hasTeamValuation({}), false);
  const words = item({ valueModel: WORDS_ONLY });
  assert.equal(teamValuationMissing({ value: { source: words.value.source, perYear: null }, cost: null }), false);
  const counted = item({ valueModel: FIX_B });
  assert.equal(teamValuationMissing({ value: null, cost: counted.cost ? { source: counted.cost.source } : null }), false);
});

test("cifre della Roadmap: beneficio contato e avvio entrano nei totali", () => {
  const a = item({ valueModel: FIX_A });
  const b = item({ valueModel: FIX_B, status: "in_progress" });
  const words = item({ valueModel: WORDS_ONLY });
  const totals = roadmapTotals([a, b, words]);
  near(totals.expectedValue?.amountEur, 4042.5 + 2719, "valore atteso");
  assert.equal(totals.expectedValue?.count, 2);
  assert.equal(totals.committedCost?.amountEur, 560 + 280);
  assert.equal(totals.committedCost?.fromBand, 0);
});

test("export: Valore, valore all'anno, costo e fonte del costo con un modello, più le cifre di «Benefici e costi»", () => {
  const detail = projectUseCaseDetail(row({ valueModel: FIX_A }), CTX, null);
  const out = exportRow(detail, detail);
  assert.equal(out.Valore, "Basso");
  assert.equal(out["Valore all'anno"], 4042.5);
  assert.equal(out["Ritorno principale"], "Risparmio di tempo");
  assert.equal(out["Ore all'anno"], 115.5);
  assert.equal(out["Da misurare all'anno"], 0);
  assert.equal(out.Costo, 560);
  assert.equal(out["Fonte del costo"], "stima del team");
  assert.equal(out["Ricorrenti all'anno"], 600);
  assert.equal(out.Facilità, 4);
  const b = projectUseCaseDetail(row({ valueModel: FIX_B }), CTX, null);
  const outB = exportRow(b, b);
  assert.equal(outB["Ore all'anno"], 62.4);
  assert.equal(outB["Da misurare all'anno"], 1680);
  assert.equal(outB["Ritorno principale"], "Meno costi");
  assert.equal(outB["Ricorrenti all'anno"], 0);
  assert.equal(outB.Facilità, null, "senza facilità la cella resta vuota");
  const words = projectUseCaseDetail(row({ valueModel: WORDS_ONLY }), CTX, null);
  const outWords = exportRow(words, words);
  assert.equal(outWords.Valore, "qualitativo");
  assert.equal(outWords["Ricorrenti all'anno"], null, "un modello senza costi non ha ricorrenti");
  const none = projectUseCaseDetail(row(), CTX, null);
  const outNone = exportRow(none, none);
  for (const column of ["Ore all'anno", "Da misurare all'anno", "Ricorrenti all'anno", "Facilità"] as const) assert.equal(outNone[column], null, column);
  assert.equal(outNone["Ritorno principale"], "");
});

test("ipotesi del contesto: quelle del workspace, altrimenti le predefinite dal mese di oggi", () => {
  assert.equal(hubValueParams(CTX), PARAMS);
  assert.deepEqual(hubValueParams({ today: "2027-02-10" }), { ...DEFAULT_VALUE_PARAMS, originMonth: "2027-02" });
  // Un costo orario diverso cambia beneficio e avvio.
  const dear = item({ valueModel: FIX_A }, { ...CTX, valueParams: { ...PARAMS, hourlyCostEur: 70 } });
  near(dear.value.benefits?.benefitEur, 8085, "beneficio a 70 €/h");
  assert.equal(dear.cost?.amount, 1120);
  assert.deepEqual(modelEstimate(FIX_A, PARAMS, MODEL).costs, { oneoffEur: 560, runEurYear: 600 });
});

// ─── Chi non è revisore non vede il modello ──────────────────────────

test("contributore: la proiezione non porta mai il modello né le sue cifre", () => {
  const source = { ...row({ valueModel: FIX_A }), proposedBy: "persona.prova@cliente.test" } as unknown as ContributorSourceRow;
  for (const viewer of [
    { userId: uuid(9001), email: "persona.prova@cliente.test", emailVerified: true },
    { userId: uuid(9002), email: "altra.persona@cliente.test", emailVerified: true },
  ]) {
    const projected = projectForContributor(viewer, { ...source, linkedCaseCode: null, dossierStatus: null, duplicateOfCode: null, today: TODAY });
    assert.ok(projected);
    const text = JSON.stringify(projected);
    for (const word of ["valueModel", "components", "benefit", "Smistamento delle richieste", "4042", "560"]) {
      assert.ok(!text.includes(word), `«${word}» non arriva al contributore: ${text}`);
    }
  }
});
