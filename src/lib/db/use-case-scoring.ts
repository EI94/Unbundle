/**
 * Punteggio degli use case (docs/use-case/DESIGN.md §7.2, §7.6; PIANO-LAVORI H3a).
 *
 * - **Modello di valutazione del workspace**: forma (`ScoringModelConfig`), predefiniti,
 *   normalizzazione (`normalizeScoringConfig`) e merge dei salvataggi (`mergeScoringConfig`).
 *   `src/lib/db/queries/scoring-model.ts` li riesporta e aggiunge letture e scritture. Le
 *   chiavi di §7.2 e §7.6 (`scoringVersion`, `costKpiId`, `thresholds.costLowMaxEur`,
 *   `costBands`) hanno sempre un valore nella config normalizzata; `thresholds.costLowBand`
 *   (D18) quando la config la salva o quando la soglia in euro da sola direbbe un'altra
 *   fascia: così chi legge la config normalizzata (la pagina, `use-case-admin scoring-v2`)
 *   trova lo stesso costo basso. Nessun salvataggio scrive `scoringVersion`: lo scrive solo
 *   `use-case-admin scoring-v2`.
 * - **Aggregati salvati** (`overall_*`, `category`): `deriveUseCasePortfolioMetrics`. In v1
 *   il calcolo di oggi, identico (un KPI vuoto vale 0); in v2 l'aggregatore unico di
 *   `valuation.ts` (`aggregateScores`), con i KPI dell'AI letti da `ai_suggestion.scores`.
 *   Così la matrice, che legge `valuation.ts`, e gli `overall_*` salvati danno gli stessi
 *   numeri.
 * - **L'AI in v2** (§7.6 regole 3-5): quali schede scrive (`aiMayWriteSuggestion`) e i
 *   blocchi della sua motivazione nelle note della v1 (`replaceAiRationale`,
 *   `splitAiRationale`, una sola espressione regolare).
 *
 * Modulo puro: a runtime solo import relativi `.ts`, perché lo carica anche
 * `scripts/use-case-admin/scoring-v2.ts` sotto Node, senza alias e senza database. Gli import
 * con `@/` sono solo di tipi.
 */
import type { UseCase, UseCaseKpiScores } from "@/lib/db/schema";
import { COST_BANDS_MAX_EUR, costLowBandFrom, isCostLowBand, resolveCostBands, validateCostBands, type CostBandInfo, type CostBandsConfig } from "../use-cases/cost-bands.ts";
import {
  aggregateScores,
  DEFAULT_COST_KPI_ID,
  DEFAULT_THRESHOLDS,
  type KpiScoreMap,
  type ScoringVersion,
} from "../use-cases/valuation.ts";

// ═══ Modello di valutazione del workspace ════════════════════════════

export type ScoringKpi = {
  id: string;
  label: string;
  description?: string;
  /** Peso assoluto (0..∞). Si normalizza in fase di calcolo. */
  weight: number;
  /**
   * `lower_better` serve per rubriche come Effort, dove 1 = sforzo minimo
   * e 5 = sforzo molto alto. La UI e l'LLM usano la scala "grezza", mentre
   * il ranking la inverte in fase di aggregazione per mantenere alta = meglio.
   */
  direction?: "higher_better" | "lower_better";
};

export type ScoringThresholds = {
  highImpact: number;
  highFeasibility: number;
  midImpact: number;
  /**
   * Costo basso fino a questo importo (§7.2, D15): la forma di prima di D18. Si legge ancora,
   * come la fascia che contiene l'importo (`costLowBandFrom`), finché `costLowBand` non c'è.
   */
  costLowMaxEur?: number;
  /**
   * «Costo basso fino alla fascia N» del workspace (D18), da 1 a 4. Quando c'è vince su
   * `costLowMaxEur`; la scrive Impostazioni › Valutazione, che toglie la soglia in euro.
   */
  costLowBand?: number;
};

/**
 * Configurazione del modello. Le chiavi facoltative sono quelle di §7.2 e §7.6: la config
 * normalizzata (`ResolvedScoringModelConfig`) le ha sempre.
 */
export type ScoringModelConfig = {
  dimensions: {
    impact: ScoringKpi[];
    feasibility: ScoringKpi[];
    esg: ScoringKpi[];
  };
  /** Peso delle tre dimensioni (impact/feasibility/esg) nel ranking complessivo. */
  overall: { impact: number; feasibility: number; esg: number };
  /** Soglie per collocare un use case sulla matrice e soglia del costo basso. */
  thresholds: ScoringThresholds;
  /** 1 se manca; 2 dopo `use-case-admin scoring-v2 --apply` (§7.6). */
  scoringVersion?: ScoringVersion;
  /** KPI da cui si deriva il costo (fonte 4 di §7.2). Predefinito `effort`. */
  costKpiId?: string;
  /** Fasce del costo del workspace (D15), già risolte con `resolveCostBands`. */
  costBands?: readonly CostBandInfo[];
};

/** La config come la legge l'app: ogni chiave ha un valore, predefinito se manca. */
export type ResolvedScoringModelConfig = ScoringModelConfig & {
  /**
   * `costLowBand` (D18) quando la config la salva o quando `costLowMaxEur` da solo, con il suo
   * predefinito, direbbe un'altra fascia di quella di D18 (`normalizeScoringConfig`). Chi legge
   * il costo basso usa `costLowBandFrom` (o `costLowBandOf`) su queste soglie.
   */
  thresholds: Required<Omit<ScoringThresholds, "costLowBand">> & Pick<ScoringThresholds, "costLowBand">;
  scoringVersion: ScoringVersion;
  costKpiId: string;
  costBands: readonly CostBandInfo[];
};

/**
 * Default dei KPI: ricalcano i 13 sub-criteri storici ma ora sono editabili
 * (label/descrizione/peso/nuovi KPI) dal cliente via UI.
 */
export const DEFAULT_IMPACT_KPIS: ScoringKpi[] = [
  {
    id: "efficiency",
    label: "Efficienza",
    description:
      "Scala 1-5. 1 = impatto nullo: 0-15 minuti risparmiati per esecuzione, qualita invariata. 2 = basso: 15-60 minuti risparmiati, lieve miglioramento qualitativo. 3 = medio: 1-3 ore risparmiate, miglioramento sensibile di completezza/copertura. 4 = alto: 3-8 ore risparmiate, output nettamente superiore. 5 = trasformativo: oltre 8 ore o oltre una giornata, output non raggiungibile manualmente.",
    weight: 1,
    direction: "higher_better",
  },
  {
    id: "profitability",
    label: "Profittabilità",
    description:
      "Scala 1-5 da compilare dal reviewer quando ci sono dati economici espliciti. 1 = impatto economico nullo o non dimostrato. 3 = upside economico plausibile e supportato da dati. 5 = upside economico trasformativo, documentato e verificabile. L'AI non stima automaticamente questo KPI se mancano numeri affidabili.",
    weight: 1,
    direction: "higher_better",
  },
];

export const DEFAULT_FEASIBILITY_KPIS: ScoringKpi[] = [
  {
    id: "effort",
    label: "Effort",
    description:
      "Scala 1-5. 1 = nullo/minimo: prompt engineering, meno di 1 settimana. 2 = basso: configurazione tool esistenti, 1-2 settimane. 3 = medio: sviluppo custom leggero, 1-2 mesi. 4 = alto: sviluppo complesso con integrazioni, 2-6 mesi. 5 = molto alto: progetto strutturato, oltre 6 mesi di sviluppo. Attenzione: qui 1 e meglio di 5, quindi il ranking lo inverte automaticamente.",
    weight: 1,
    direction: "lower_better",
  },
];

export const DEFAULT_ESG_KPIS: ScoringKpi[] = [
  {
    id: "environmental",
    label: "Ambientale",
    description:
      "Scala 1-5. 1 = impatto ambientale negativo o nullo. 2 = beneficio marginale su consumi/materiali. 3 = riduzione misurabile di sprechi, trasferte o risorse. 4 = beneficio ambientale forte e scalabile. 5 = impatto molto positivo, strutturale e replicabile su emissioni, energia o uso di materiali.",
    weight: 1,
    direction: "higher_better",
  },
  {
    id: "social",
    label: "Sociale",
    description:
      "Scala 1-5. 1 = nessun beneficio sociale o possibile peggioramento. 2 = beneficio limitato per pochi utenti. 3 = beneficio chiaro per un team/processo. 4 = miglioramento forte su benessere, inclusione, sicurezza o accessibilita. 5 = impatto sociale ampio, misurabile e durevole su persone, clienti o comunita interne.",
    weight: 1,
    direction: "higher_better",
  },
];

/**
 * La config di un modello nuovo, come si salva: dimensioni, pesi e soglie di oggi. Le chiavi
 * di §7.2 e §7.6 non ci sono (valgono i predefiniti): `scoringVersion` lo scrive solo
 * `use-case-admin scoring-v2`.
 */
export const DEFAULT_SCORING_MODEL_CONFIG: ScoringModelConfig = {
  dimensions: {
    impact: DEFAULT_IMPACT_KPIS,
    feasibility: DEFAULT_FEASIBILITY_KPIS,
    esg: DEFAULT_ESG_KPIS,
  },
  overall: { impact: 0.5, feasibility: 0.3, esg: 0.2 },
  thresholds: { highImpact: 3.5, highFeasibility: 3.5, midImpact: 2.5 },
};

const LEGACY_DIMENSION_IDS: Record<keyof ScoringModelConfig["dimensions"], string[]> = {
  impact: ["economic", "time", "quality", "coordination", "social"],
  feasibility: ["data", "workflow", "risk", "tech", "team"],
  esg: ["environmental", "social", "governance"],
};

function normalizeWeight(value: unknown, fallback = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : fallback;
}

function normalizeKpi(kpi: ScoringKpi): ScoringKpi {
  return {
    id: String(kpi.id),
    label: String(kpi.label),
    description: kpi.description ? String(kpi.description) : undefined,
    weight: normalizeWeight(kpi.weight),
    direction: kpi.direction === "lower_better" ? "lower_better" : "higher_better",
  };
}

function hasOnlyKnownIds(kpis: ScoringKpi[], knownIds: string[]) {
  const known = new Set(knownIds);
  return kpis.every((kpi) => known.has(kpi.id));
}

function isLegacyDefaultDimension(
  dim: keyof ScoringModelConfig["dimensions"],
  kpis: ScoringKpi[]
) {
  if (kpis.length === 0) return false;
  const ids = new Set(kpis.map((kpi) => kpi.id));
  const legacyIds = LEGACY_DIMENSION_IDS[dim];
  const legacyOnly = hasOnlyKnownIds(kpis, legacyIds);

  if (dim === "impact") {
    return (
      legacyOnly &&
      !ids.has("efficiency") &&
      !ids.has("profitability") &&
      legacyIds.some((id) => ids.has(id))
    );
  }

  if (dim === "feasibility") {
    return legacyOnly && !ids.has("effort") && legacyIds.some((id) => ids.has(id));
  }

  return legacyOnly && ids.has("governance");
}

function averageLegacyWeight(
  weights: Map<string, number>,
  ids: string[],
  fallback: number
) {
  const values = ids
    .map((id) => weights.get(id))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function migrateLegacyDimension(
  dim: keyof ScoringModelConfig["dimensions"],
  defaults: ScoringKpi[],
  legacyKpis: ScoringKpi[]
) {
  const weights = new Map(legacyKpis.map((kpi) => [kpi.id, kpi.weight]));

  return defaults.map((defaultKpi) => {
    let weight = defaultKpi.weight;
    if (dim === "impact" && defaultKpi.id === "efficiency") {
      weight = averageLegacyWeight(weights, ["time", "quality"], defaultKpi.weight);
    } else if (dim === "impact" && defaultKpi.id === "profitability") {
      weight = averageLegacyWeight(weights, ["economic"], defaultKpi.weight);
    } else if (dim === "feasibility" && defaultKpi.id === "effort") {
      weight = averageLegacyWeight(
        weights,
        ["data", "workflow", "tech", "team"],
        defaultKpi.weight
      );
    } else if (dim === "esg") {
      weight = averageLegacyWeight(weights, [defaultKpi.id], defaultKpi.weight);
    }

    return { ...defaultKpi, weight };
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Soglia del costo basso: un importo da 0 a 100.000.000 (§7.2), altrimenti 25.000 €. */
function costLowMaxEurOf(value: unknown): number {
  const n = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? Math.min(n, COST_BANDS_MAX_EUR) : DEFAULT_THRESHOLDS.costLowMaxEur;
}

/**
 * Normalizza qualsiasi `config` (vecchio o nuovo) nello schema canonico, con i predefiniti
 * delle chiavi di §7.2 e §7.6:
 * - `scoringVersion`: 2 solo se la config lo dice, altrimenti 1;
 * - `costKpiId`: il KPI del costo, predefinito `effort`;
 * - `thresholds.costLowMaxEur`: predefinito 25.000 €;
 * - `thresholds.costLowBand` (D18): la fascia del costo basso del `config` grezzo
 *   (`costLowBandFrom`: la fascia salvata, altrimenti quella che contiene una soglia in euro
 *   salvata, altrimenti la 1), scritta quando la config la salva o quando la soglia in euro
 *   normalizzata da sola ne direbbe un'altra. Succede con fasce del workspace il cui primo
 *   confine è sotto 25.000 € e nessuna soglia salvata: il 25.000 predefinito cadrebbe nella
 *   fascia 2, D18 vuole la 1. Così `costLowBandFrom` sulle soglie normalizzate dà sempre la
 *   fascia di D18, a chiunque le legga;
 * - `costBands`: le fasce del workspace se la config è valida (`resolveCostBands`), altrimenti
 *   quelle predefinite. Qui sono già risolte (5 `CostBandInfo`); nel `jsonb` restano nella
 *   forma `CostBandsConfig`.
 */
export function normalizeScoringConfig(raw: unknown | null | undefined): ResolvedScoringModelConfig {
  const base = DEFAULT_SCORING_MODEL_CONFIG;
  const cfg = (isPlainRecord(raw) ? raw : {}) as {
    dimensions?: ScoringModelConfig["dimensions"];
    weights?: {
      impact?: Record<string, number>;
      feasibility?: Record<string, number>;
      esg?: Record<string, number>;
      overall?: {
        impact?: number;
        feasibility?: number;
        esg?: number;
        esgWhenEnabled?: number;
      };
    };
    overall?: { impact?: number; feasibility?: number; esg?: number };
    thresholds?: { highImpact?: number; highFeasibility?: number; midImpact?: number; costLowMaxEur?: unknown; costLowBand?: unknown };
    scoringVersion?: unknown;
    costKpiId?: unknown;
    costBands?: unknown;
  };

  const toKpis = (
    defaults: ScoringKpi[],
    legacy: Record<string, number> | undefined,
    dimArr: ScoringKpi[] | undefined,
    dim: keyof ScoringModelConfig["dimensions"]
  ): ScoringKpi[] => {
    if (Array.isArray(dimArr) && dimArr.length > 0) {
      const normalized = dimArr.map(normalizeKpi);
      if (isLegacyDefaultDimension(dim, normalized)) {
        return migrateLegacyDimension(dim, defaults, normalized);
      }
      return normalized;
    }
    if (legacy && typeof legacy === "object") {
      return defaults.map((d) => ({
        ...d,
        weight: normalizeWeight(legacy[d.id], d.weight),
      }));
    }
    return defaults;
  };

  const impact = toKpis(
    DEFAULT_IMPACT_KPIS,
    cfg.weights?.impact,
    cfg.dimensions?.impact,
    "impact"
  );
  const feasibility = toKpis(
    DEFAULT_FEASIBILITY_KPIS,
    cfg.weights?.feasibility,
    cfg.dimensions?.feasibility,
    "feasibility"
  );
  const esg = toKpis(
    DEFAULT_ESG_KPIS,
    cfg.weights?.esg,
    cfg.dimensions?.esg,
    "esg"
  );

  const ow = cfg.overall ?? cfg.weights?.overall ?? {};
  const overall = {
    impact: Number.isFinite(Number(ow.impact)) ? Math.max(0, Number(ow.impact)) : base.overall.impact,
    feasibility: Number.isFinite(Number(ow.feasibility)) ? Math.max(0, Number(ow.feasibility)) : base.overall.feasibility,
    esg: Number.isFinite(Number((ow as { esg?: number }).esg))
      ? Math.max(0, Number((ow as { esg?: number }).esg))
      : Number.isFinite(Number((ow as { esgWhenEnabled?: number }).esgWhenEnabled))
        ? Math.max(0, Number((ow as { esgWhenEnabled?: number }).esgWhenEnabled))
        : base.overall.esg,
  };

  const th = isPlainRecord(cfg.thresholds) ? cfg.thresholds : {};
  const costBands = resolveCostBands({ costBands: cfg.costBands });
  const costLowMaxEur = costLowMaxEurOf(th.costLowMaxEur);
  // D18: la fascia del `config` grezzo. Si scrive se è salvata, o se la soglia in euro
  // normalizzata (con il suo predefinito) da sola si leggerebbe come un'altra fascia.
  const costLowBand = costLowBandFrom(th, costBands);
  const bandNeeded = isCostLowBand(th.costLowBand) || costLowBandFrom({ costLowMaxEur }, costBands) !== costLowBand;
  const thresholds = {
    highImpact: Number.isFinite(Number(th.highImpact)) ? Math.max(0, Math.min(5, Number(th.highImpact))) : base.thresholds.highImpact,
    highFeasibility: Number.isFinite(Number(th.highFeasibility)) ? Math.max(0, Math.min(5, Number(th.highFeasibility))) : base.thresholds.highFeasibility,
    midImpact: Number.isFinite(Number(th.midImpact)) ? Math.max(0, Math.min(5, Number(th.midImpact))) : base.thresholds.midImpact,
    costLowMaxEur,
    ...(bandNeeded ? { costLowBand } : {}),
  };

  return {
    dimensions: { impact, feasibility, esg },
    overall,
    thresholds,
    scoringVersion: cfg.scoringVersion === 2 ? 2 : 1,
    costKpiId: typeof cfg.costKpiId === "string" && cfg.costKpiId.trim() ? cfg.costKpiId : DEFAULT_COST_KPI_ID,
    costBands,
  };
}

/**
 * Cosa cambia un salvataggio del modello. Mai `scoringVersion`: lo scrive solo
 * `use-case-admin scoring-v2`. Le soglie si fondono una per una con quelle salvate; una
 * `costLowBand` toglie la soglia in euro di prima (`costLowMaxEur`, D18); `costBands: null`
 * toglie le fasce del workspace (tornano le predefinite).
 */
export type ScoringModelConfigPatch = {
  dimensions?: ScoringModelConfig["dimensions"];
  overall?: ScoringModelConfig["overall"];
  thresholds?: Partial<ScoringThresholds>;
  costKpiId?: string;
  costBands?: CostBandsConfig | null;
};

/**
 * Il `config` da salvare: quello salvato (il `jsonb` grezzo della riga) più le chiavi del
 * salvataggio (§7.6 «Il salvataggio del modello non cancella le chiavi nuove»). Le chiavi che
 * il salvataggio non nomina restano come sono, comprese `scoringVersion`, `costKpiId`,
 * `thresholds.costLowMaxEur`, `costBands` e le chiavi che questo codice non conosce. Le fasce
 * passano da `validateCostBands`: una config non valida si rifiuta (lo dice chi chiama, con
 * l'errore del campo).
 */
export function mergeScoringConfig(saved: unknown, patch: ScoringModelConfigPatch): Record<string, unknown> {
  const next: Record<string, unknown> = isPlainRecord(saved) ? { ...saved } : {};
  if (patch.dimensions !== undefined) next.dimensions = patch.dimensions;
  if (patch.overall !== undefined) next.overall = patch.overall;
  if (patch.thresholds !== undefined) {
    const changed = Object.fromEntries(Object.entries(patch.thresholds).filter(([, value]) => value !== undefined));
    const saved: Record<string, unknown> = { ...(isPlainRecord(next.thresholds) ? next.thresholds : {}) };
    // D18: la fascia del costo basso sostituisce la soglia in euro di prima.
    if (changed.costLowBand !== undefined) delete saved.costLowMaxEur;
    next.thresholds = { ...saved, ...changed };
  }
  if (patch.costKpiId !== undefined) next.costKpiId = patch.costKpiId;
  if (patch.costBands === null) {
    delete next.costBands;
  } else if (patch.costBands !== undefined) {
    const checked = validateCostBands(patch.costBands);
    if (!checked.ok) throw new Error("Fasce del costo non valide: validale con validateCostBands prima di salvare.");
    next.costBands = checked.value;
  }
  return next;
}

/** Gli id dei KPI di oggi, per dimensione: un modello con altri id è «personalizzato». */
export function isCustomScoringModel(config: Pick<ScoringModelConfig, "dimensions">): boolean {
  const ids = (kpis: readonly ScoringKpi[]) => kpis.map((kpi) => kpi.id).join("\u0000");
  return (
    ids(config.dimensions.impact) !== ids(DEFAULT_IMPACT_KPIS) ||
    ids(config.dimensions.feasibility) !== ids(DEFAULT_FEASIBILITY_KPIS) ||
    ids(config.dimensions.esg) !== ids(DEFAULT_ESG_KPIS)
  );
}

// ═══ Aggregati salvati: overall_* e category ═════════════════════════

export type UseCaseCategory =
  | "quick_win"
  | "strategic_bet"
  | "capability_builder"
  | "not_yet";

/**
 * Gli aggregati salvati. In v1 sono sempre numeri (un KPI vuoto vale 0); in v2 `null` quando
 * nessun KPI della dimensione ha un valore («da stimare», §7.6 regola 2).
 */
export type DerivedUseCaseScores = {
  overallEsgScore: number | null;
  overallImpactScore: number | null;
  overallFeasibilityScore: number | null;
  overallScore: number | null;
  category: UseCaseCategory;
};

/** Alias esposto per retrocompatibilità degli import esterni. */
export type UseCaseScoringModel = {
  impactFlagEnabled: boolean;
  config: ScoringModelConfig;
};

/**
 * Input usato per calcolare i punteggi: le colonne storiche (sub-dimensioni hardcoded), i
 * `customScores` jsonb (KPI delle persone) e, solo in v2, `aiSuggestion.scores` (KPI
 * dell'AI).
 */
export type ScoreSource = Partial<
  Pick<
    UseCase,
    | "impactEconomic"
    | "impactTime"
    | "impactQuality"
    | "impactCoordination"
    | "impactSocial"
    | "feasibilityData"
    | "feasibilityWorkflow"
    | "feasibilityRisk"
    | "feasibilityTech"
    | "feasibilityTeam"
    | "esgEnvironmental"
    | "esgSocial"
    | "esgGovernance"
    | "customScores"
    | "aiSuggestion"
  >
>;

/**
 * Legge il punteggio per un KPI combinando (v1, come oggi):
 * 1) `customScores[dim][kpiId]` (nuova via)
 * 2) mapping 1:1 con le colonne legacy per i kpiId storici (economic/time/data/...)
 */
export function readUseCaseRawKpiScore(
  data: ScoreSource,
  dimension: "impact" | "feasibility" | "esg",
  kpiId: string
): number {
  const custom = data.customScores?.[dimension]?.[kpiId];
  if (typeof custom === "number" && Number.isFinite(custom)) return clamp05(custom);

  if (dimension === "impact" && kpiId === "efficiency") {
    return (
      averageLegacyColumns(data, ["impactTime", "impactQuality"]) ??
      averageLegacyColumns(data, ["impactCoordination", "impactSocial"]) ??
      readLegacyColumn(data, "impactEconomic") ??
      0
    );
  }

  if (dimension === "impact" && kpiId === "profitability") {
    return 0;
  }

  if (dimension === "feasibility" && kpiId === "effort") {
    const legacyFeasibility = averageLegacyColumns(data, [
      "feasibilityData",
      "feasibilityWorkflow",
      "feasibilityTech",
      "feasibilityTeam",
    ]);
    return legacyFeasibility === null ? 0 : clamp05(6 - legacyFeasibility);
  }

  const legacyMap: Record<string, keyof ScoreSource | undefined> = {
    // impact
    economic: "impactEconomic",
    time: "impactTime",
    quality: "impactQuality",
    coordination: "impactCoordination",
    social: dimension === "esg" ? "esgSocial" : "impactSocial",
    // feasibility
    data: "feasibilityData",
    workflow: "feasibilityWorkflow",
    risk: "feasibilityRisk",
    tech: "feasibilityTech",
    team: "feasibilityTeam",
    // esg
    environmental: "esgEnvironmental",
    governance: "esgGovernance",
  };
  const col = legacyMap[kpiId];
  if (!col) return 0;
  const value = data[col];
  return typeof value === "number" && Number.isFinite(value) ? clamp05(value) : 0;
}

function clamp05(v: number) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(5, v));
}

function readLegacyColumn(data: ScoreSource, col: keyof ScoreSource) {
  const value = data[col];
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? clamp05(value)
    : null;
}

function averageLegacyColumns(data: ScoreSource, cols: (keyof ScoreSource)[]) {
  const values = cols
    .map((col) => readLegacyColumn(data, col))
    .filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function normalizeKpiScoreForAggregation(score: number, kpi: ScoringKpi) {
  const raw = clamp05(score);
  if (kpi.direction === "lower_better") {
    return raw === 0 ? 0 : clamp05(6 - raw);
  }
  return raw;
}

function weightedAvg(
  kpis: ScoringKpi[],
  getScore: (kpi: ScoringKpi) => number
) {
  if (kpis.length === 0) return 0;
  const denom = kpis.reduce((s, k) => s + Math.max(0, k.weight ?? 1), 0);
  if (denom <= 0) return 0;
  const num = kpis.reduce(
    (s, k) => s + getScore(k) * Math.max(0, k.weight ?? 1),
    0
  );
  return num / denom;
}

/**
 * Quadrante di oggi, con le soglie del workspace. In v2 una dimensione «da stimare» conta come
 * sotto ogni soglia: `category` resta calcolata nel database ma non si mostra più (§7.4).
 */
function categoryOf(
  impact: number | null,
  feasibility: number | null,
  thresholds: Partial<ScoringThresholds> | undefined
): UseCaseCategory {
  const hi = thresholds?.highImpact ?? 3.5;
  const hf = thresholds?.highFeasibility ?? 3.5;
  const mi = thresholds?.midImpact ?? 2.5;
  const i = impact ?? 0;
  const f = feasibility ?? 0;
  if (i >= hi && f >= hf) return "quick_win";
  if (i >= hi && f < hf) return "strategic_bet";
  if (i >= mi) return "capability_builder";
  return "not_yet";
}

/** I KPI dell'AI della scheda: `ai_suggestion.scores` (§7.6 regola 3). */
export function aiScoresOf(aiSuggestion: unknown): KpiScoreMap | null {
  if (!isPlainRecord(aiSuggestion) || !isPlainRecord(aiSuggestion.scores)) return null;
  return aiSuggestion.scores as KpiScoreMap;
}

const EMPTY_CONFIG: Pick<ScoringModelConfig, "dimensions"> = { dimensions: { impact: [], feasibility: [], esg: [] } };

/** v2: l'aggregatore unico di `valuation.ts`, con persona ?? AI ?? colonne legacy. */
function deriveV2(data: ScoreSource, config: Pick<ScoringModelConfig, "dimensions"> & Partial<ScoringModelConfig>, esgEnabled: boolean): DerivedUseCaseScores {
  const scores = aggregateScores(
    { ...data, customScores: (data.customScores ?? null) as KpiScoreMap | null, aiScores: aiScoresOf(data.aiSuggestion) },
    config,
    { version: 2, esgEnabled },
  );
  return {
    overallEsgScore: scores.esg,
    overallImpactScore: scores.impact,
    overallFeasibilityScore: scores.feasibility,
    overallScore: scores.overall,
    category: categoryOf(scores.impact, scores.feasibility, config.thresholds),
  };
}

/**
 * Calcola impatto/fattibilità/ESG complessivi + categoria di matrice usando
 * il modello KPI custom e il flag ESG del workspace.
 *
 * ESG entra nel ranking **solo se** `esgEnabled === true`.
 *
 * La versione è quella del modello (`config.scoringVersion`, 1 se manca) o `opts.version`:
 * - v1: il calcolo di oggi, identico (un KPI vuoto vale 0 e resta nel denominatore);
 * - v2: `aggregateScores` di `valuation.ts` (§7.6 regole 1 e 2), senza riscriverlo: un KPI
 *   vuoto esce dal denominatore, una dimensione senza valori è `null`.
 */
export function deriveUseCasePortfolioMetrics(
  data: ScoreSource,
  opts?: {
    model?: UseCaseScoringModel | null;
    esgEnabled?: boolean;
    version?: ScoringVersion;
  }
): DerivedUseCaseScores {
  const config = opts?.model?.config;
  const version = opts?.version ?? (config?.scoringVersion === 2 ? 2 : 1);
  if (version === 2) return deriveV2(data, config ?? EMPTY_CONFIG, opts?.esgEnabled === true);

  const impactKpis = config?.dimensions.impact ?? [];
  const feasibilityKpis = config?.dimensions.feasibility ?? [];
  const esgKpis = config?.dimensions.esg ?? [];

  const overallImpact = weightedAvg(impactKpis, (kpi) =>
    normalizeKpiScoreForAggregation(
      readUseCaseRawKpiScore(data, "impact", kpi.id),
      kpi
    )
  );
  const overallFeasibility = weightedAvg(feasibilityKpis, (kpi) =>
    normalizeKpiScoreForAggregation(
      readUseCaseRawKpiScore(data, "feasibility", kpi.id),
      kpi
    )
  );

  const esgEnabled = opts?.esgEnabled === true;
  const overallEsg = esgEnabled
    ? weightedAvg(esgKpis, (kpi) =>
        normalizeKpiScoreForAggregation(
          readUseCaseRawKpiScore(data, "esg", kpi.id),
          kpi
        )
      )
    : null;

  const ow = config?.overall ?? { impact: 0.5, feasibility: 0.5, esg: 0.2 };
  const wImpactRaw = Math.max(0, ow.impact);
  const wFeasibilityRaw = Math.max(0, ow.feasibility);
  const wEsgRaw = esgEnabled && overallEsg !== null ? Math.max(0, ow.esg ?? 0) : 0;
  const sum = wImpactRaw + wFeasibilityRaw + wEsgRaw;
  const wi = sum > 0 ? wImpactRaw / sum : 0.5;
  const wf = sum > 0 ? wFeasibilityRaw / sum : 0.5;
  const we = sum > 0 ? wEsgRaw / sum : 0;

  const overallScore =
    overallImpact * wi + overallFeasibility * wf + (overallEsg ?? 0) * we;

  return {
    overallEsgScore: overallEsg,
    overallImpactScore: overallImpact,
    overallFeasibilityScore: overallFeasibility,
    overallScore,
    category: categoryOf(overallImpact, overallFeasibility, config?.thresholds),
  };
}

// ═══ L'AI in v2 (§7.6 regole 3-5) ═══════════════════════════════════

/** Il percorso dell'AI: valutazione all'invio, «Suggerimento AI» chiesto da chi valuta, ricalibrazione. */
export type AiSuggestionKind = "auto" | "suggerimento" | "ricalibrazione";

/**
 * Regola 4 di §7.6, in v2: quali schede l'AI scrive. L'AI scrive solo `ai_suggestion` (il
 * servizio, `recordAiSuggestion`) e porta «in valutazione» solo una scheda ricevuta senza
 * persona. Mai `custom_scores`, `reviewed_by`, `reviewed_at`, `review_notes`.
 * - `auto` (all'invio): solo una scheda intatta (`needs_inputs` e nessuna revisione:
 *   `onlyIfUntouched`, che in v2 vale per ogni invio);
 * - `ricalibrazione`: solo le schede ancora da valutare (`needs_inputs`, `in_review`); salta le
 *   valutate e le archiviate, che restano come sono;
 * - `suggerimento` («Chiedi un nuovo suggerimento», §6.3): lo chiede chi valuta, su qualunque
 *   scheda; cambia solo `ai_suggestion`, mai lo stato.
 */
export function aiMayWriteSuggestion(
  card: Pick<UseCase, "portfolioReviewStatus" | "reviewedAt">,
  kind: AiSuggestionKind
): boolean {
  if (kind === "suggerimento") return true;
  if (kind === "auto") return card.portfolioReviewStatus === "needs_inputs" && card.reviewedAt == null;
  return card.portfolioReviewStatus === "needs_inputs" || card.portfolioReviewStatus === "in_review";
}

/** Le etichette dei blocchi della motivazione dell'AI nelle note della v1. */
export const AI_RATIONALE_LABELS = ["Auto-ranking AI", "Suggerimento AI", "Ricalibrazione AI"] as const;
export type AiRationaleLabel = (typeof AI_RATIONALE_LABELS)[number];

/**
 * Un blocco va dall'etichetta al blocco dell'AI dopo, o alla fine del testo. È l'espressione
 * di `replaceAiRationale` di oggi; `scoring-v2 --apply` sposta gli stessi blocchi.
 */
function aiRationaleBlockPattern(): RegExp {
  const labels = AI_RATIONALE_LABELS.join("|");
  return new RegExp(`(^|\\n\\n)(${labels}):[\\s\\S]*?(?=\\n\\n(?:${labels}):|$)`, "g");
}

/** v1: le note senza i blocchi dell'AI, più il blocco nuovo in fondo (comportamento di oggi). */
export function replaceAiRationale(existing: string | null | undefined, rationale: string, label: string): string {
  const cleaned = existing?.replace(aiRationaleBlockPattern(), "").trim();
  const stamped = `${label}:\n${rationale.trim()}`;
  return cleaned ? `${cleaned}\n\n${stamped}` : stamped;
}

/**
 * Le note divise (regola 5 di §7.6): i blocchi dell'AI, nell'ordine, e quel che resta delle
 * note (`null` se non resta niente). Senza blocchi le note tornano come sono.
 */
export function splitAiRationale(notes: string | null | undefined): {
  notes: string | null;
  blocks: Array<{ label: AiRationaleLabel; text: string }>;
} {
  if (typeof notes !== "string") return { notes: notes ?? null, blocks: [] };
  const blocks: Array<{ label: AiRationaleLabel; text: string }> = [];
  for (const match of notes.matchAll(aiRationaleBlockPattern())) {
    const label = match[2] as AiRationaleLabel;
    blocks.push({ label, text: match[0].slice(match[1].length + label.length + 1).trim() });
  }
  if (blocks.length === 0) return { notes, blocks };
  const rest = notes.replace(aiRationaleBlockPattern(), "").trim();
  return { notes: rest || null, blocks };
}

/**
 * Le note con ogni blocco dell'AI sostituito dal testo che `keep(blocco)` lascia nelle note, al
 * suo posto e senza etichetta (`""` per niente). Stessa espressione di `replaceAiRationale` e
 * di `splitAiRationale`: un blocco arriva fino al blocco dell'AI dopo o alla fine, quindi
 * comprende anche quel che una persona ha scritto sotto l'etichetta. `scoring-v2 --apply` sposta
 * solo il testo dell'AI e lascia nelle note quello della persona. `null` se non resta niente.
 */
export function rewriteAiRationale(notes: string, keep: (block: { label: AiRationaleLabel; text: string }) => string): string | null {
  const rest = notes.replace(aiRationaleBlockPattern(), (match: string, lead: string, label: AiRationaleLabel) => {
    const kept = keep({ label, text: match.slice(lead.length + label.length + 1).trim() }).trim();
    return kept ? `${lead}${kept}` : "";
  });
  return rest.trim() || null;
}

/** I KPI della scheda come li scrive `custom_scores`: un oggetto per dimensione, solo numeri. */
export function kpiScoresOf(value: unknown): UseCaseKpiScores | null {
  if (!isPlainRecord(value)) return null;
  const out: UseCaseKpiScores = {};
  for (const dimension of ["impact", "feasibility", "esg"] as const) {
    const map = value[dimension];
    if (!isPlainRecord(map)) continue;
    const kept = Object.fromEntries(Object.entries(map).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])));
    if (Object.keys(kept).length) out[dimension] = kept;
  }
  return out;
}
