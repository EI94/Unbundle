import { eq } from "drizzle-orm";
import { db } from "..";
import {
  workspaceScoringModels,
  type WorkspaceScoringModel,
  type NewWorkspaceScoringModel,
} from "../schema";
import { ensureDbSchema } from "../ensure-schema";
import { isUuid } from "@/lib/slack/workspace-context-cookie";

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

/**
 * Configurazione "canonica" del modello. Sempre popolata (anche coi default)
 * quando letta via `getOrCreateWorkspaceScoringModel`.
 */
export type ScoringModelConfig = {
  dimensions: {
    impact: ScoringKpi[];
    feasibility: ScoringKpi[];
    esg: ScoringKpi[];
  };
  /** Peso delle tre dimensioni (impact/feasibility/esg) nel ranking complessivo. */
  overall: { impact: number; feasibility: number; esg: number };
  /** Soglie per collocare un use case sulla matrice Impatto / Fattibilità. */
  thresholds: { highImpact: number; highFeasibility: number; midImpact: number };
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
      "Scala 1-5. 1 = nessun impatto economico tangibile o valore annuo <10k EUR. 2 = upside limitato: 10k-50k EUR tra nuovi ricavi, saving o margine protetto. 3 = upside medio: 50k-150k EUR annui. 4 = upside alto: 150k-500k EUR annui o contributo forte a upsell / retention. 5 = upside trasformativo: oltre 500k EUR annui o nuova linea di valore significativa.",
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

/**
 * Normalizza qualsiasi `config` (vecchio o nuovo) nello schema canonico.
 */
export function normalizeScoringConfig(
  raw: unknown | null | undefined
): ScoringModelConfig {
  const base = DEFAULT_SCORING_MODEL_CONFIG;
  if (!raw || typeof raw !== "object") return base;
  const cfg = raw as {
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
    thresholds?: { highImpact?: number; highFeasibility?: number; midImpact?: number };
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

  const th = cfg.thresholds ?? {};
  const thresholds = {
    highImpact: Number.isFinite(Number(th.highImpact)) ? Math.max(0, Math.min(5, Number(th.highImpact))) : base.thresholds.highImpact,
    highFeasibility: Number.isFinite(Number(th.highFeasibility)) ? Math.max(0, Math.min(5, Number(th.highFeasibility))) : base.thresholds.highFeasibility,
    midImpact: Number.isFinite(Number(th.midImpact)) ? Math.max(0, Math.min(5, Number(th.midImpact))) : base.thresholds.midImpact,
  };

  return { dimensions: { impact, feasibility, esg }, overall, thresholds };
}

export type ScoringModelRow = WorkspaceScoringModel & {
  /** Config sempre normalizzata. */
  resolvedConfig: ScoringModelConfig;
};

async function getRow(workspaceId: string) {
  await ensureDbSchema();
  const [row] = await db
    .select()
    .from(workspaceScoringModels)
    .where(eq(workspaceScoringModels.workspaceId, workspaceId))
    .limit(1);
  return row ?? null;
}

export async function getWorkspaceScoringModel(
  workspaceId: string
): Promise<ScoringModelRow | null> {
  const row = await getRow(workspaceId);
  if (!row) return null;
  return { ...row, resolvedConfig: normalizeScoringConfig(row.config) };
}

export async function getOrCreateWorkspaceScoringModel(
  workspaceId: string
): Promise<ScoringModelRow> {
  const existing = await getRow(workspaceId);
  if (existing) {
    return { ...existing, resolvedConfig: normalizeScoringConfig(existing.config) };
  }
  const [row] = await db
    .insert(workspaceScoringModels)
    .values({
      workspaceId,
      impactFlagEnabled: false,
      config: {
        ...DEFAULT_SCORING_MODEL_CONFIG,
        dimensions: {
          impact: DEFAULT_SCORING_MODEL_CONFIG.dimensions.impact.map((k) => ({ ...k })),
          feasibility: DEFAULT_SCORING_MODEL_CONFIG.dimensions.feasibility.map((k) => ({
            ...k,
          })),
          esg: DEFAULT_SCORING_MODEL_CONFIG.dimensions.esg.map((k) => ({ ...k })),
        },
      },
      updatedAt: new Date(),
    } satisfies NewWorkspaceScoringModel)
    .returning();
  return { ...row, resolvedConfig: normalizeScoringConfig(row.config) };
}

/**
 * Upsert robusto: evita `onConflictDoUpdate` (che in passato ha fallito
 * silenziosamente quando il constraint UNIQUE non era allineato in produzione)
 * e fa sempre SELECT → UPDATE | INSERT.
 */
export async function upsertWorkspaceScoringModel(params: {
  workspaceId: string;
  impactFlagEnabled: boolean;
  config: ScoringModelConfig;
  updatedByUserId?: string | null;
}) {
  await ensureDbSchema();
  const updatedBy = isUuid(params.updatedByUserId ?? null)
    ? params.updatedByUserId!
    : null;
  const existing = await getRow(params.workspaceId);
  if (existing) {
    const [row] = await db
      .update(workspaceScoringModels)
      .set({
        impactFlagEnabled: params.impactFlagEnabled,
        config: params.config,
        updatedByUserId: updatedBy,
        updatedAt: new Date(),
      })
      .where(eq(workspaceScoringModels.id, existing.id))
      .returning();
    return { ...row, resolvedConfig: normalizeScoringConfig(row.config) };
  }
  const [row] = await db
    .insert(workspaceScoringModels)
    .values({
      workspaceId: params.workspaceId,
      impactFlagEnabled: params.impactFlagEnabled,
      config: params.config,
      updatedByUserId: updatedBy,
      updatedAt: new Date(),
    })
    .returning();
  return { ...row, resolvedConfig: normalizeScoringConfig(row.config) };
}
