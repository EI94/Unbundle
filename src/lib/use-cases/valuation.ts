/**
 * Valore, costo, rischio, zone e aggregatore dei KPI (docs/use-case/DESIGN.md §7.1-7.4, §7.6).
 *
 * - **Un solo aggregatore**, qui: `aggregateScores`. In v1 dà gli stessi numeri di oggi
 *   (`deriveUseCasePortfolioMetrics` in `src/lib/db/use-case-scoring.ts`); in v2 applica le
 *   regole 1-2 di §7.6 (persona ?? AI ?? colonne legacy; un KPI vuoto esce dal denominatore;
 *   una dimensione senza valori è `null`, «da stimare»). H3a lo chiama da
 *   `deriveUseCasePortfolioMetrics` e non lo riscrive: matrice e `overall_*` salvati danno
 *   gli stessi numeri.
 * - Il modello del workspace entra per forma (`ValuationModel`): `ScoringModelConfig` di
 *   `src/lib/db/queries/scoring-model.ts` è assegnabile, comprese le chiavi nuove di H3a
 *   (`scoringVersion`, `costKpiId`, `thresholds.costLowBand`, `costBands`), qui con i loro
 *   predefiniti.
 * - Le fasce del costo sono quelle del workspace (D15): `costFigure` e `isCostLow` le leggono
 *   con `resolveCostBands(model)` (cost-bands.ts); senza `costBands`, o con una config non
 *   valida, valgono le fasce predefinite `COST_BANDS`.
 * - «Costo basso» è «fino alla fascia N» del workspace (D18, `thresholds.costLowBand`,
 *   predefinita la 1): una config di prima con `costLowMaxEur` vale la fascia che lo contiene.
 * - La stima di Claude (§7.5) non entra mai nel Valore, nel costo o nelle zone.
 * - **«Benefici e costi»** (`value_model`, drizzle/0022): i conti li fa `value-calc.ts`
 *   (`modelEstimate`) e arrivano qui come dati (`ModelEstimate`). Con un beneficio contato il
 *   Valore all'anno è il beneficio, il punteggio quello interpolato e la parola la solita
 *   `valueWord`; senza, «qualitativo» o «da misurare · fino a X €», senza parola né zona. Il
 *   costo è l'avvio (`oneoff`, fonte «stima»), collocato nelle fasce del workspace: così zone e
 *   matrice Valore × Costo funzionano. Una scheda con un modello ha sempre una valutazione del
 *   team (`hasTeamValuation`).
 *
 * Modulo puro: import relativi `.ts` (e `zod`, attraverso `value-model.ts`).
 */
import type { CostBand } from "./types.ts";
import {
  bandForAmount,
  costBandInfo,
  costLowBandFrom,
  costPosition,
  effortCostEur,
  isCostBand,
  resolveCostBands,
  type CostBandInfo,
  type CostLowBand,
} from "./cost-bands.ts";
import type { CostSource, RiskChip, ValueEurSource, ValueSource, ValueWord, Zone } from "./labels.ts";
import { parseValueModel } from "./value-model.ts";

// ─── Modello del workspace ───────────────────────────────────────────

export const DIMENSIONS = ["impact", "feasibility", "esg"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export type KpiDirection = "higher_better" | "lower_better";

export interface ValuationKpi {
  id: string;
  /** Peso assoluto; si normalizza nel calcolo. Assente: 1. */
  weight?: number;
  /** `lower_better` (es. lo sforzo): 1 è meglio di 5, l'aggregazione lo inverte. */
  direction?: KpiDirection;
}

export interface ValuationModel {
  dimensions: { impact: readonly ValuationKpi[]; feasibility: readonly ValuationKpi[]; esg: readonly ValuationKpi[] };
  /** Peso delle tre dimensioni nel punteggio complessivo. */
  overall?: { impact: number; feasibility: number; esg?: number };
  thresholds?: {
    highImpact?: number;
    midImpact?: number;
    highFeasibility?: number;
    /** «Costo basso fino alla fascia N» (D18): da 1 a 4, predefinita la 1. */
    costLowBand?: number;
    /** Le config di prima di D18: si legge come la fascia che contiene l'importo (`costLowBandOf`). */
    costLowMaxEur?: number;
  };
  /** 1 se manca; 2 dopo `use-case-admin scoring-v2 --apply` (§7.6). */
  scoringVersion?: number;
  /** KPI da cui si deriva il costo (fonte 4 di §7.2). Predefinito `effort`. */
  costKpiId?: string;
  /**
   * Fasce del costo del workspace (D15): `config.costBands`, nella forma `CostBandsConfig`.
   * Viene dal `jsonb` e si legge solo con `resolveCostBands`, che la valida: assente o non
   * valida valgono le fasce predefinite `COST_BANDS`.
   */
  costBands?: unknown;
}

/**
 * Soglie predefinite: `scoring-model.ts:101` e D18 (costo basso fino alla fascia 1, cioè 25.000 €
 * con le fasce predefinite). `costLowMaxEur` è la soglia in euro di prima: la config normalizzata
 * la porta ancora con questo predefinito, ma il costo basso lo decide la fascia (`costLowBandOf`).
 */
export const DEFAULT_THRESHOLDS = { highImpact: 3.5, midImpact: 2.5, highFeasibility: 3.5, costLowBand: 1, costLowMaxEur: 25_000 } as const;
export const DEFAULT_COST_KPI_ID = "effort";
/** Pesi che `deriveUseCasePortfolioMetrics` usa quando il modello non ne ha. */
const FALLBACK_OVERALL = { impact: 0.5, feasibility: 0.5, esg: 0.2 } as const;

export type ScoringVersion = 1 | 2;

export function scoringVersionOf(model: ValuationModel | null | undefined): ScoringVersion {
  return model?.scoringVersion === 2 ? 2 : 1;
}

function threshold(model: ValuationModel, key: keyof typeof DEFAULT_THRESHOLDS): number {
  const value = model.thresholds?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_THRESHOLDS[key];
}

function costKpiIdOf(model: ValuationModel): string {
  return typeof model.costKpiId === "string" && model.costKpiId.trim() ? model.costKpiId : DEFAULT_COST_KPI_ID;
}

// ─── Punteggi della scheda ───────────────────────────────────────────

/** Punteggi per KPI: `custom_scores` (persone) o `ai_suggestion.scores` (AI). */
export type KpiScoreMap = Partial<Record<Dimension, Readonly<Record<string, unknown>> | null>>;

/** Colonne legacy dei punteggi (Activity mapping e righe vecchie). */
export interface LegacyScoreColumns {
  impactEconomic?: number | null;
  impactTime?: number | null;
  impactQuality?: number | null;
  impactCoordination?: number | null;
  impactSocial?: number | null;
  feasibilityData?: number | null;
  feasibilityWorkflow?: number | null;
  feasibilityRisk?: number | null;
  feasibilityTech?: number | null;
  feasibilityTeam?: number | null;
  esgEnvironmental?: number | null;
  esgSocial?: number | null;
  esgGovernance?: number | null;
}

export interface ScoreInput extends LegacyScoreColumns {
  /** `custom_scores`: KPI inseriti da persone (in v2 solo loro). */
  customScores?: KpiScoreMap | null;
  /** `ai_suggestion.scores`: KPI dell'AI. In v1 non si leggono, come oggi. */
  aiScores?: KpiScoreMap | null;
}

type LegacyColumn = keyof LegacyScoreColumns;

function clamp05(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(5, v));
}

function mapValue(map: KpiScoreMap | null | undefined, dimension: Dimension, kpiId: string): unknown {
  const dim = map?.[dimension];
  if (!dim || typeof dim !== "object" || !Object.prototype.hasOwnProperty.call(dim, kpiId)) return undefined;
  return dim[kpiId];
}

/** Colonna legacy che c'è davvero: un numero maggiore di zero (come `readLegacyColumn` di oggi). */
function legacyColumn(input: ScoreInput, column: LegacyColumn): number | null {
  const value = input[column];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? clamp05(value) : null;
}

function legacyAverage(input: ScoreInput, columns: readonly LegacyColumn[]): number | null {
  const values = columns.map((c) => legacyColumn(input, c)).filter((v): v is number => v !== null);
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
}

/** La mappa legacy di oggi: KPI → colonna. `social` cambia colonna con la dimensione. */
function legacyColumnFor(dimension: Dimension, kpiId: string): LegacyColumn | undefined {
  const map: Record<string, LegacyColumn> = {
    economic: "impactEconomic",
    time: "impactTime",
    quality: "impactQuality",
    coordination: "impactCoordination",
    social: dimension === "esg" ? "esgSocial" : "impactSocial",
    data: "feasibilityData",
    workflow: "feasibilityWorkflow",
    risk: "feasibilityRisk",
    tech: "feasibilityTech",
    team: "feasibilityTeam",
    environmental: "esgEnvironmental",
    governance: "esgGovernance",
  };
  return Object.prototype.hasOwnProperty.call(map, kpiId) ? map[kpiId] : undefined;
}

const LEGACY_FEASIBILITY: readonly LegacyColumn[] = ["feasibilityData", "feasibilityWorkflow", "feasibilityTech", "feasibilityTeam"];

/** Valore legacy di un KPI, con le stesse vie di oggi; `null` dove oggi esce 0 per mancanza. */
function legacyKpi(input: ScoreInput, dimension: Dimension, kpiId: string): number | null {
  if (dimension === "impact" && kpiId === "efficiency") {
    return (
      legacyAverage(input, ["impactTime", "impactQuality"]) ??
      legacyAverage(input, ["impactCoordination", "impactSocial"]) ??
      legacyColumn(input, "impactEconomic")
    );
  }
  if (dimension === "impact" && kpiId === "profitability") return null;
  if (dimension === "feasibility" && kpiId === "effort") {
    const feasibility = legacyAverage(input, LEGACY_FEASIBILITY);
    return feasibility === null ? null : clamp05(6 - feasibility);
  }
  const column = legacyColumnFor(dimension, kpiId);
  return column ? legacyColumn(input, column) : null;
}

/** Un valore di persona o dell'AI che c'è: un numero maggiore di zero, portato in [1, 5]. */
function presentScore(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.max(1, Math.min(5, value)) : null;
}

export type KpiOrigin = "persona" | "ai" | "legacy";

/**
 * Regola 1 di §7.6: `custom_scores[dim][kpi]`, poi `ai_suggestion.scores[dim][kpi]`, poi la
 * mappa legacy. `null` se nessuno ha un valore («Nessun valore» non vuol dire zero).
 */
export function readKpi(input: ScoreInput, dimension: Dimension, kpiId: string): { value: number; from: KpiOrigin } | null {
  const person = presentScore(mapValue(input.customScores, dimension, kpiId));
  if (person !== null) return { value: person, from: "persona" };
  const ai = presentScore(mapValue(input.aiScores, dimension, kpiId));
  if (ai !== null) return { value: ai, from: "ai" };
  const legacy = legacyKpi(input, dimension, kpiId);
  return legacy === null ? null : { value: Math.max(1, Math.min(5, legacy)), from: "legacy" };
}

/** v1: `readUseCaseRawKpiScore` di oggi, identico (un valore che manca vale 0). */
function readKpiV1(input: ScoreInput, dimension: Dimension, kpiId: string): number {
  const custom = mapValue(input.customScores, dimension, kpiId);
  if (typeof custom === "number" && Number.isFinite(custom)) return clamp05(custom);
  if (dimension === "impact" && kpiId === "efficiency") {
    return (
      legacyAverage(input, ["impactTime", "impactQuality"]) ??
      legacyAverage(input, ["impactCoordination", "impactSocial"]) ??
      legacyColumn(input, "impactEconomic") ??
      0
    );
  }
  if (dimension === "impact" && kpiId === "profitability") return 0;
  if (dimension === "feasibility" && kpiId === "effort") {
    const feasibility = legacyAverage(input, LEGACY_FEASIBILITY);
    return feasibility === null ? 0 : clamp05(6 - feasibility);
  }
  const column = legacyColumnFor(dimension, kpiId);
  if (!column) return 0;
  const value = input[column];
  return typeof value === "number" && Number.isFinite(value) ? clamp05(value) : 0;
}

// ─── Aggregatore ─────────────────────────────────────────────────────

export interface AggregateOptions {
  /** Predefinita: quella del modello (`scoringVersion`, 1 se manca). */
  version?: ScoringVersion;
  /** ESG entra solo con il flag del workspace acceso, come oggi. */
  esgEnabled?: boolean;
}

/**
 * Aggregati della scheda. In v1 impatto, fattibilità e complessivo sono sempre numeri (oggi
 * un KPI vuoto vale 0); in v2 sono `null` quando non c'è nessun valore («da stimare»).
 * `esg` è `null` con ESG spento.
 */
export interface AggregatedScores {
  impact: number | null;
  feasibility: number | null;
  esg: number | null;
  overall: number | null;
}

function weightOf(kpi: ValuationKpi): number {
  const w = kpi.weight ?? 1;
  return Number.isFinite(w) ? Math.max(0, w) : 1;
}

function aggregateV1(input: ScoreInput, model: ValuationModel, esgEnabled: boolean): AggregatedScores {
  // Stesse operazioni, nello stesso ordine, di `deriveUseCasePortfolioMetrics`: i numeri coincidono al bit.
  const weightedAvg = (kpis: readonly ValuationKpi[], dimension: Dimension) => {
    if (kpis.length === 0) return 0;
    const denom = kpis.reduce((s, k) => s + Math.max(0, k.weight ?? 1), 0);
    if (denom <= 0) return 0;
    const num = kpis.reduce((s, k) => {
      const raw = clamp05(readKpiV1(input, dimension, k.id));
      const normalized = k.direction === "lower_better" ? (raw === 0 ? 0 : clamp05(6 - raw)) : raw;
      return s + normalized * Math.max(0, k.weight ?? 1);
    }, 0);
    return num / denom;
  };
  const impact = weightedAvg(model.dimensions.impact, "impact");
  const feasibility = weightedAvg(model.dimensions.feasibility, "feasibility");
  const esg = esgEnabled ? weightedAvg(model.dimensions.esg, "esg") : null;

  const ow = model.overall ?? FALLBACK_OVERALL;
  const wImpactRaw = Math.max(0, ow.impact);
  const wFeasibilityRaw = Math.max(0, ow.feasibility);
  const wEsgRaw = esgEnabled && esg !== null ? Math.max(0, ow.esg ?? 0) : 0;
  const sum = wImpactRaw + wFeasibilityRaw + wEsgRaw;
  const wi = sum > 0 ? wImpactRaw / sum : 0.5;
  const wf = sum > 0 ? wFeasibilityRaw / sum : 0.5;
  const we = sum > 0 ? wEsgRaw / sum : 0;
  const overall = impact * wi + feasibility * wf + (esg ?? 0) * we;
  return { impact, feasibility, esg, overall };
}

/** Regola 2 di §7.6: media pesata sui soli KPI con un valore; nessun valore → `null`. */
function dimensionV2(input: ScoreInput, kpis: readonly ValuationKpi[], dimension: Dimension): number | null {
  let num = 0;
  let den = 0;
  for (const kpi of kpis) {
    const read = readKpi(input, dimension, kpi.id);
    if (!read) continue;
    const weight = weightOf(kpi);
    const value = kpi.direction === "lower_better" ? 6 - read.value : read.value;
    num += value * weight;
    den += weight;
  }
  return den > 0 ? num / den : null;
}

function aggregateV2(input: ScoreInput, model: ValuationModel, esgEnabled: boolean): AggregatedScores {
  const impact = dimensionV2(input, model.dimensions.impact, "impact");
  const feasibility = dimensionV2(input, model.dimensions.feasibility, "feasibility");
  const esg = esgEnabled ? dimensionV2(input, model.dimensions.esg, "esg") : null;
  // Anche nel complessivo una dimensione senza valori esce dal denominatore.
  const ow = model.overall ?? FALLBACK_OVERALL;
  const positive = (w: number | undefined) => (typeof w === "number" && Number.isFinite(w) ? Math.max(0, w) : 0);
  let weights = { impact: positive(ow.impact), feasibility: positive(ow.feasibility), esg: esgEnabled ? positive(ow.esg) : 0 };
  // Come in v1: con tutti i pesi complessivi a zero, impatto e fattibilità a metà, ESG fuori.
  // §7.6 cambia solo le regole 1-5, non questo ripiego.
  if (weights.impact + weights.feasibility + weights.esg <= 0) weights = { impact: 0.5, feasibility: 0.5, esg: 0 };
  const parts: Array<[number | null, number]> = [
    [impact, weights.impact],
    [feasibility, weights.feasibility],
    [esg, weights.esg],
  ];
  let num = 0;
  let den = 0;
  for (const [value, weight] of parts) {
    if (value === null) continue;
    num += value * weight;
    den += weight;
  }
  return { impact, feasibility, esg, overall: den > 0 ? num / den : null };
}

/** L'aggregatore dei KPI della scheda, v1 o v2 (§7.6). */
export function aggregateScores(input: ScoreInput, model: ValuationModel, opts: AggregateOptions = {}): AggregatedScores {
  const version = opts.version ?? scoringVersionOf(model);
  const esgEnabled = opts.esgEnabled === true;
  return version === 2 ? aggregateV2(input, model, esgEnabled) : aggregateV1(input, model, esgEnabled);
}

// ─── Valore (§7.1) ───────────────────────────────────────────────────

/** «Alto» se ≥ `highImpact`, «Medio» se ≥ `midImpact`, «Basso» altrimenti; `null` = «da stimare». */
export function valueWord(score: number | null | undefined, model: ValuationModel): ValueWord | null {
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  if (score >= threshold(model, "highImpact")) return "alto";
  if (score >= threshold(model, "midImpact")) return "medio";
  return "basso";
}

/** Lo stato del Valore di «Benefici e costi»: con un beneficio contato, solo da misurare, solo a parole. */
export type ValueModelState = "contato" | "da_misurare" | "qualitativo";

/**
 * I conti di «Benefici e costi» della scheda, già fatti con le ipotesi del workspace
 * (`modelEstimate` di `value-calc.ts`). Mai salvati: si rifanno a ogni lettura.
 */
export interface ModelEstimate {
  state: ValueModelState;
  /** Beneficio contato, euro all'anno. */
  benefitEur: number;
  /** Euro all'anno delle voci da misurare: fuori dal totale. */
  pendingEur: number;
  /** Ore all'anno contate. */
  hours: number;
  /** Punteggio da 1 a 5 del beneficio contato (`valueScore`); null senza beneficio contato. */
  score: number | null;
  /** Avvio (euro) e ricorrenti (euro all'anno); null se il modello non ha costi. */
  costs: { oneoffEur: number; runEurYear: number } | null;
}

/** Il Valore di «Benefici e costi» come lo scrivono riga, pannello, card e scheda. */
export type ValueBenefits = Pick<ModelEstimate, "state" | "benefitEur" | "pendingEur" | "hours">;

export interface ValueInput extends ScoreInput {
  /** `annualBenefit` del ROI del dossier (letture protette di `use-case-dossiers.ts`). */
  dossierAnnualBenefitEur?: number | null;
  /** `value_eur_year`, valore stimato dal team. */
  valueEurYear?: number | null;
  /** «Benefici e costi» della scheda, se ha un modello valido: vale al posto dei KPI d'impatto. */
  estimate?: ModelEstimate | null;
}

export interface ValueFigure {
  /** Punteggio d'impatto (1-5); `null` = «da stimare» (o, con un modello, nessun beneficio contato). */
  score: number | null;
  word: ValueWord | null;
  /** «team», «AI»; `null` = «da stimare». */
  source: ValueSource | null;
  /** Euro all'anno accanto, se ci sono: prima il dossier, poi il beneficio contato del modello o il team. */
  perYear: { amount: number; source: ValueEurSource } | null;
  /** Con un modello: stato, beneficio contato, da misurare e ore. Assente o null senza modello. */
  benefits?: ValueBenefits | null;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Euro all'anno: `annualBenefit` del dossier («dal dossier»), poi `value_eur_year` («team»). */
export function annualValue(input: Pick<ValueInput, "dossierAnnualBenefitEur" | "valueEurYear">): ValueFigure["perYear"] {
  const dossier = finiteOrNull(input.dossierAnnualBenefitEur);
  if (dossier !== null) return { amount: dossier, source: "dossier" };
  const team = finiteOrNull(input.valueEurYear);
  return team === null ? null : { amount: team, source: "team" };
}

/**
 * Il Valore della scheda (§7.1): punteggio d'impatto dal modello del workspace (D7), parola,
 * fonte ed euro all'anno. «team» se almeno un KPI d'impatto del modello ha un valore di una
 * persona; «AI» se il punteggio viene solo dall'AI o dalle colonne legacy; «da stimare» se
 * nessun KPI d'impatto ha un valore (anche in v1, dove l'aggregato varrebbe 0). In v1 i
 * punteggi di `ai_suggestion` non contano nemmeno qui, come nell'aggregatore v1.
 */
export function valueFigure(input: ValueInput, model: ValuationModel, opts: AggregateOptions = {}): ValueFigure {
  if (input.estimate) return modelValueFigure(input, input.estimate, model);
  const perYear = annualValue(input);
  const version = opts.version ?? scoringVersionOf(model);
  const readable: ScoreInput = version === 1 ? { ...input, aiScores: null } : input;
  const reads = model.dimensions.impact.map((kpi) => readKpi(readable, "impact", kpi.id)).filter((r) => r !== null);
  const score = reads.length ? aggregateScores(input, model, opts).impact : null;
  if (score === null) return { score: null, word: null, source: null, perYear };
  return {
    score,
    word: valueWord(score, model),
    source: reads.some((r) => r.from === "persona") ? "team" : "ai",
    perYear,
  };
}

/**
 * Il Valore con «Benefici e costi»: il modello vale al posto dei KPI d'impatto e del valore
 * all'anno scritto a mano. Con un beneficio contato, punteggio interpolato, parola e beneficio
 * all'anno (il dossier, quando c'è, resta prima); senza, nessuna parola: «qualitativo» o «da
 * misurare · fino a X €». La fonte è sempre il team.
 */
function modelValueFigure(input: Pick<ValueInput, "dossierAnnualBenefitEur">, estimate: ModelEstimate, model: ValuationModel): ValueFigure {
  const counted = estimate.state === "contato";
  const score = counted ? estimate.score : null;
  const dossier = finiteOrNull(input.dossierAnnualBenefitEur);
  const perYear: ValueFigure["perYear"] =
    dossier !== null ? { amount: dossier, source: "dossier" } : counted ? { amount: estimate.benefitEur, source: "team" } : null;
  return {
    score,
    word: valueWord(score, model),
    source: "team",
    perYear,
    benefits: { state: estimate.state, benefitEur: estimate.benefitEur, pendingEur: estimate.pendingEur, hours: estimate.hours },
  };
}

// ─── Costo di realizzazione (§7.2) ───────────────────────────────────

export interface CostFigureInput extends Pick<ScoreInput, "customScores" | "aiScores"> {
  /** `computeRoi(...).implementation` del ROI del dossier, se non è null. */
  dossierImplementationEur?: number | null;
  /** `cost_eur_once`, importo del team. */
  costEurOnce?: number | null;
  /** `cost_band`, fascia del team (1-5). */
  costBand?: number | null;
  /** «Benefici e costi» della scheda: con i costi, avvio e ricorrenti (fonte «stima»). */
  estimate?: Pick<ModelEstimate, "costs"> | null;
}

/** Il costo con la sua fonte. `null` = «da stimare». */
export interface CostFigure {
  source: CostSource;
  /** Importo (dossier o team); `null` quando il costo è una fascia. */
  amount: number | null;
  /** Fascia nelle fasce del workspace: quella dell'importo, la fascia del team o quella dello sforzo. */
  band: CostBand;
  /**
   * Etichetta di `band` nelle fasce del workspace (D15), per «€€ · fascia da 25.000 a 65.000 €».
   * `costFigure` la scrive sempre; nel tipo è facoltativa perché i pacchetti scritti su H1b
   * costruiscono `CostFigure` senza (in sua assenza: `costBandInfo(band, bands).label`).
   */
  bandLabel?: string;
  /** Vero per una fascia (team o sforzo): a schermo «fascia» al posto dell'importo. */
  fromBand: boolean;
  /** Solo per la fonte «stima»: i costi ricorrenti, euro all'anno. */
  runEurYear?: number | null;
  /** Posizione orizzontale in matrice, da 0,5 a 5,5, sulla scala delle fasce del workspace. */
  position: number;
  /**
   * Quanto vale nei totali: l'importo; per la fascia del team il suo valore di riferimento
   * nelle fasce del workspace; per lo sforzo l'importo stimato (`effortCostEur`), come oggi.
   */
  referenceEur: number;
}

function amountFigure(source: "dossier" | "stima" | "team_importo", amount: number, bands: readonly CostBandInfo[]): CostFigure {
  const band = bandForAmount(amount, bands);
  return {
    source,
    amount,
    band,
    bandLabel: costBandInfo(band, bands).label,
    fromBand: false,
    position: costPosition({ amount }, bands),
    referenceEur: amount,
  };
}

function bandFigure(source: "team_fascia" | "sforzo", band: CostBand, bands: readonly CostBandInfo[], referenceEur?: number): CostFigure {
  const info = costBandInfo(band, bands);
  return {
    source,
    amount: null,
    band,
    bandLabel: info.label,
    fromBand: true,
    position: costPosition({ band }, bands),
    referenceEur: referenceEur ?? info.referenceEur,
  };
}

/** La dimensione che contiene il KPI del costo; `null` se il modello non lo ha. */
function costKpiDimension(model: ValuationModel, kpiId: string): Dimension | null {
  for (const dimension of ["feasibility", "impact", "esg"] as const) {
    if (model.dimensions[dimension].some((kpi) => kpi.id === kpiId)) return dimension;
  }
  return null;
}

/**
 * Scala con fonte, la prima disponibile vince (§7.2): 1 dossier, 2 «Benefici e costi» con i
 * costi (fonte «stima»: l'avvio come importo, i ricorrenti accanto), 3 importo del team,
 * 4 fascia del team, 5 derivato dallo sforzo (KPI `costKpiId`, da persona o AI; non esiste se
 * il modello non ha quel KPI), 6 nessuna. Mai «6 − fattibilità».
 * Fascia, etichetta, posizione e valore nei totali seguono le fasce del workspace
 * (`resolveCostBands(model)`, D15). Lo sforzo dà l'importo stimato di oggi (tabella di
 * `estimateImplementationCost`), l'importo dà la fascia del workspace; nei totali vale
 * l'importo stimato.
 */
export function costFigure(input: CostFigureInput, model: ValuationModel): CostFigure | null {
  const bands = resolveCostBands(model);
  const dossier = finiteOrNull(input.dossierImplementationEur);
  if (dossier !== null) return amountFigure("dossier", Math.max(0, dossier), bands);
  const costs = input.estimate?.costs;
  if (costs && Number.isFinite(costs.oneoffEur)) {
    return { ...amountFigure("stima", Math.max(0, costs.oneoffEur), bands), runEurYear: Number.isFinite(costs.runEurYear) ? Math.max(0, costs.runEurYear) : 0 };
  }
  const amount = finiteOrNull(input.costEurOnce);
  if (amount !== null) return amountFigure("team_importo", Math.max(0, amount), bands);
  if (isCostBand(input.costBand)) return bandFigure("team_fascia", input.costBand, bands);
  const kpiId = costKpiIdOf(model);
  const dimension = costKpiDimension(model, kpiId);
  if (dimension) {
    const effort =
      presentScore(mapValue(input.customScores, dimension, kpiId)) ?? presentScore(mapValue(input.aiScores, dimension, kpiId));
    if (effort !== null) {
      const estimatedEur = effortCostEur(effort);
      return bandFigure("sforzo", bandForAmount(estimatedEur, bands), bands, estimatedEur);
    }
  }
  return null;
}

/**
 * «Costo basso fino alla fascia N» del workspace (D18): `thresholds.costLowBand` da 1 a 4,
 * predefinita la 1; una config di prima con `costLowMaxEur` vale la fascia che contiene
 * quell'importo nelle fasce del workspace (`costLowBandFrom`).
 */
export function costLowBandOf(model: Pick<ValuationModel, "thresholds" | "costBands">): CostLowBand {
  return costLowBandFrom(model.thresholds, resolveCostBands(model));
}

/**
 * Costo basso (D18): la fascia del costo (dell'importo, del team o dello sforzo, nelle fasce del
 * workspace) è al massimo la fascia N del costo basso.
 */
export function isCostLow(cost: CostFigure, model: ValuationModel): boolean {
  return cost.band <= costLowBandOf(model);
}

// ─── Zone (§7.4) ─────────────────────────────────────────────────────

/**
 * Subito (Valore alto, costo basso), Da pianificare (alto, alto), Se avanza tempo (medio o
 * basso, basso), Non ora (medio o basso, alto). Senza Valore o Costo: `null`, «da stimare».
 * È un suggerimento: la decisione la prende una persona.
 */
export function zoneOf(value: Pick<ValueFigure, "word"> | null, cost: CostFigure | null, model: ValuationModel): Zone | null {
  if (!value?.word || !cost) return null;
  const high = value.word === "alto";
  const low = isCostLow(cost, model);
  if (high) return low ? "subito" : "da_pianificare";
  return low ? "se_avanza_tempo" : "non_ora";
}

// ─── Rischio (§7.3) ──────────────────────────────────────────────────

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Chip di rischio da `intake` (dati del connettore). Solo un segnale: non cambia Valore,
 * Costo o zona.
 * - «Serve decisione AI Board»: semaforo di chi propone rosso (`proposerEstimate.impactFlag`)
 *   oppure segnalazione «fuori perimetro» (`flags.outsideFoundation`);
 * - «Dati personali»: `flags.personalData`; «Sicurezza»: `flags.safetyRelated`.
 */
export function riskChips(intake: unknown): RiskChip[] {
  const data = record(intake);
  if (!data) return [];
  const flags = record(data.flags);
  const impactFlag = record(record(data.proposerEstimate)?.impactFlag);
  const chips: RiskChip[] = [];
  if (impactFlag?.value === "rosso" || flags?.outsideFoundation === true) chips.push("ai_board");
  if (flags?.personalData === true) chips.push("dati_personali");
  if (flags?.safetyRelated === true) chips.push("sicurezza");
  return chips;
}

// ─── Valutazione del team ────────────────────────────────────────────

/**
 * Vero se il team ha messo almeno un valore: un KPI di una persona (`custom_scores`), il
 * valore all'anno, il costo o «Benefici e costi» (`value_model` valido). Serve a «Riapri»
 * (§3.7: `scored` se ci sono valori del team) e all'avviso non bloccante di «Approva».
 */
export function hasTeamValuation(card: {
  customScores?: KpiScoreMap | null;
  valueEurYear?: number | null;
  costEurOnce?: number | null;
  costBand?: number | null;
  valueModel?: unknown;
}): boolean {
  if (finiteOrNull(card.valueEurYear) !== null || finiteOrNull(card.costEurOnce) !== null || isCostBand(card.costBand)) return true;
  if (parseValueModel(card.valueModel) !== null) return true;
  for (const dimension of DIMENSIONS) {
    const scores = card.customScores?.[dimension];
    if (scores && typeof scores === "object" && Object.values(scores).some((v) => presentScore(v) !== null)) return true;
  }
  return false;
}
