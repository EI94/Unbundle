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
  { id: "economic", label: "Impatto economico", description: "Risparmi / ricavi attesi, riduzione costi.", weight: 1 },
  { id: "time", label: "Tempo liberato", description: "Ore risparmiate per persona/team.", weight: 1 },
  { id: "quality", label: "Qualità / errore", description: "Riduzione difetti, miglior customer outcome.", weight: 1 },
  { id: "coordination", label: "Coordinamento", description: "Meno attriti tra team, meno handoff.", weight: 1 },
  { id: "social", label: "Impatto sulle persone", description: "Riduzione carico cognitivo, benessere.", weight: 1 },
];

export const DEFAULT_FEASIBILITY_KPIS: ScoringKpi[] = [
  { id: "data", label: "Dati disponibili", description: "Qualità e accessibilità dei dati necessari.", weight: 1 },
  { id: "workflow", label: "Chiarezza del workflow", description: "Processo definito, deterministico o ben misurabile.", weight: 1 },
  { id: "risk", label: "Rischio residuo", description: "Rischio regolatorio, reputazionale, di errore.", weight: 1 },
  { id: "tech", label: "Tecnologia", description: "Maturità tecnica e integrazione con stack esistente.", weight: 1 },
  { id: "team", label: "Team & change", description: "Capacità di change management e ownership del team.", weight: 1 },
];

export const DEFAULT_ESG_KPIS: ScoringKpi[] = [
  { id: "environmental", label: "Environmental", description: "Impatto ambientale (consumi, emissioni, risorse).", weight: 1 },
  { id: "social", label: "Social", description: "Impatto su persone, comunità, DEI.", weight: 1 },
  { id: "governance", label: "Governance", description: "Trasparenza, controllo, accountability.", weight: 1 },
];

export const DEFAULT_SCORING_MODEL_CONFIG: ScoringModelConfig = {
  dimensions: {
    impact: DEFAULT_IMPACT_KPIS,
    feasibility: DEFAULT_FEASIBILITY_KPIS,
    esg: DEFAULT_ESG_KPIS,
  },
  overall: { impact: 0.5, feasibility: 0.5, esg: 0.2 },
  thresholds: { highImpact: 3.5, highFeasibility: 3.5, midImpact: 2.5 },
};

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
    dimArr: ScoringKpi[] | undefined
  ): ScoringKpi[] => {
    if (Array.isArray(dimArr) && dimArr.length > 0) {
      return dimArr.map((k) => ({
        id: String(k.id),
        label: String(k.label),
        description: k.description ? String(k.description) : undefined,
        weight: Number.isFinite(Number(k.weight)) ? Math.max(0, Number(k.weight)) : 1,
      }));
    }
    if (legacy && typeof legacy === "object") {
      return defaults.map((d) => ({
        ...d,
        weight: Number.isFinite(Number(legacy[d.id])) ? Math.max(0, Number(legacy[d.id])) : d.weight,
      }));
    }
    return defaults;
  };

  const impact = toKpis(DEFAULT_IMPACT_KPIS, cfg.weights?.impact, cfg.dimensions?.impact);
  const feasibility = toKpis(DEFAULT_FEASIBILITY_KPIS, cfg.weights?.feasibility, cfg.dimensions?.feasibility);
  const esg = toKpis(DEFAULT_ESG_KPIS, cfg.weights?.esg, cfg.dimensions?.esg);

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
      config: DEFAULT_SCORING_MODEL_CONFIG,
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
