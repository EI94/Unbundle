import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "..";
import {
  useCases,
  workspaces,
  workspaceScoringModels,
  type WorkspaceScoringModel,
  type NewWorkspaceScoringModel,
} from "../schema";
import { ensureDbSchema } from "../ensure-schema";
import { isUuid } from "@/lib/slack/workspace-context-cookie";
import { INITIAL_MODEL_SQL, initialModelParams } from "@/lib/use-cases/provisioning";
import {
  deriveUseCasePortfolioMetrics,
  mergeScoringConfig,
  normalizeScoringConfig,
  type ScoringModelConfig,
  type ScoringModelConfigPatch,
} from "../use-case-scoring";

/*
 * Forma, predefiniti, normalizzazione e merge del modello stanno nel modulo puro
 * `src/lib/db/use-case-scoring.ts` (lo carica anche `scripts/use-case-admin/scoring-v2.ts`,
 * senza database): qui si riesportano, con le letture e le scritture della riga.
 */
export {
  DEFAULT_ESG_KPIS,
  DEFAULT_FEASIBILITY_KPIS,
  DEFAULT_IMPACT_KPIS,
  DEFAULT_SCORING_MODEL_CONFIG,
  mergeScoringConfig,
  normalizeScoringConfig,
} from "../use-case-scoring";
export type {
  ResolvedScoringModelConfig,
  ScoringKpi,
  ScoringModelConfig,
  ScoringModelConfigPatch,
  ScoringThresholds,
} from "../use-case-scoring";

export type ScoringModelRow = WorkspaceScoringModel & {
  /**
   * Config sempre normalizzata (`normalizeScoringConfig`): a runtime ogni chiave di §7.2 e §7.6
   * ha un valore (`ResolvedScoringModelConfig`). Il tipo resta `ScoringModelConfig`, con quelle
   * chiavi facoltative, perché anche le righe scritte a mano (prove, letture parziali) lo siano.
   */
  resolvedConfig: ScoringModelConfig;
};

/** Il `jsonb` della riga, per Drizzle: le chiavi in più (§7.2, §7.6) il tipo della colonna non le nomina. */
type StoredConfig = NonNullable<NewWorkspaceScoringModel["config"]>;

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

/**
 * Il modello del workspace; se non c'è, lo crea con `INITIAL_MODEL_SQL`
 * (`src/lib/use-cases/provisioning.ts`): in v2 per un workspace senza use case, come lo lascia
 * `scoring-v2 --apply` (DESIGN §12.2), altrimenti il predefinito di sempre in v1. Un modello che
 * c'è già non cambia mai versione da qui (la cambia solo `scoring-v2`). Così anche la
 * prima proposta di un workspace nuovo si valuta in v2, da qualunque canale arrivi.
 */
export async function getOrCreateWorkspaceScoringModel(
  workspaceId: string
): Promise<ScoringModelRow> {
  const existing = await getRow(workspaceId);
  if (existing) {
    return { ...existing, resolvedConfig: normalizeScoringConfig(existing.config) };
  }
  await db.$client.query(INITIAL_MODEL_SQL, initialModelParams(workspaceId));
  const row = await getRow(workspaceId);
  if (!row) throw new Error("Modello di valutazione non creato: il workspace non c'è.");
  return { ...row, resolvedConfig: normalizeScoringConfig(row.config) };
}

/** Tentativi del salvataggio quando un altro salvataggio cambia il `config` nel frattempo. */
const UPSERT_ATTEMPTS = 3;

/**
 * Upsert robusto: evita `onConflictDoUpdate` (che in passato ha fallito
 * silenziosamente quando il constraint UNIQUE non era allineato in produzione)
 * e fa sempre SELECT → UPDATE | INSERT.
 *
 * `config` dice solo cosa cambia: si fonde con il `config` salvato (`mergeScoringConfig`,
 * DESIGN §7.6). Restano `scoringVersion`, `costKpiId`, `thresholds.costLowBand`,
 * `costBands` e ogni chiave che il salvataggio non nomina: un salvataggio del modulo non
 * riporta mai un workspace v2 alla v1. L'UPDATE vale solo se il `config` è ancora quello
 * letto; altrimenti si rilegge e si fonde di nuovo.
 */
export async function upsertWorkspaceScoringModel(params: {
  workspaceId: string;
  impactFlagEnabled: boolean;
  config: ScoringModelConfigPatch;
  updatedByUserId?: string | null;
}) {
  await ensureDbSchema();
  const updatedBy = isUuid(params.updatedByUserId ?? null)
    ? params.updatedByUserId!
    : null;
  for (let attempt = 0; attempt < UPSERT_ATTEMPTS; attempt++) {
    const existing = await getRow(params.workspaceId);
    if (existing) {
      const merged = mergeScoringConfig(existing.config, params.config) as StoredConfig;
      const sameConfig =
        existing.config === null
          ? isNull(workspaceScoringModels.config)
          : sql`${workspaceScoringModels.config} = ${JSON.stringify(existing.config)}::jsonb`;
      const [row] = await db
        .update(workspaceScoringModels)
        .set({
          impactFlagEnabled: params.impactFlagEnabled,
          config: merged,
          updatedByUserId: updatedBy,
          updatedAt: new Date(),
        })
        .where(and(eq(workspaceScoringModels.id, existing.id), sameConfig))
        .returning();
      if (row) return { ...row, resolvedConfig: normalizeScoringConfig(row.config) };
      continue;
    }
    const [row] = await db
      .insert(workspaceScoringModels)
      .values({
        workspaceId: params.workspaceId,
        impactFlagEnabled: params.impactFlagEnabled,
        config: mergeScoringConfig(null, params.config) as StoredConfig,
        updatedByUserId: updatedBy,
        updatedAt: new Date(),
      })
      .returning();
    return { ...row, resolvedConfig: normalizeScoringConfig(row.config) };
  }
  throw new Error("Il modello di valutazione è cambiato durante il salvataggio: riprova.");
}

/** Tentativi del ricalcolo per le schede cambiate tra lettura e scrittura. */
const RECOMPUTE_ATTEMPTS = 3;

/**
 * Ricalcola `overall_*` e `category` delle schede del workspace con il modello salvato, dopo un
 * salvataggio del modello. Come `recomputePortfolioMetricsByWorkspace` di
 * `queries/use-cases.ts`, ma legge anche `ai_suggestion`: in v2 i KPI dell'AI contano (§7.6
 * regola 1), e senza quella colonna una scheda valutata solo dall'AI diventerebbe «da
 * stimare». In v1 gli stessi numeri e le stesse schede di quella funzione (i contributi,
 * `portfolio_kind` non nullo); in v2 tutte le schede del workspace, come `scoring-v2 --apply`.
 *
 * Un solo UPDATE per tutte le schede, e ognuna solo se `updated_at` è ancora quello letto: una
 * valutazione o un suggerimento dell'AI salvati nel frattempo non si coprono con aggregati
 * calcolati sui dati di prima. Le schede cambiate si rileggono e si ricalcolano.
 */
export async function recomputeWorkspaceScores(workspaceId: string): Promise<number> {
  await ensureDbSchema();
  const [model, [workspace]] = await Promise.all([
    getOrCreateWorkspaceScoringModel(workspaceId),
    db.select({ esgEnabled: workspaces.esgEnabled }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1),
  ]);
  const config = model.resolvedConfig;
  const v2 = config.scoringVersion === 2;
  const scope = v2 ? eq(useCases.workspaceId, workspaceId) : and(eq(useCases.workspaceId, workspaceId), isNotNull(useCases.portfolioKind));
  let pending: string[] | null = null;
  let updated = 0;
  for (let attempt = 0; attempt < RECOMPUTE_ATTEMPTS && pending?.length !== 0; attempt++) {
    const rows = await db
      .select({
        id: useCases.id,
        stamp: sql<string>`${useCases.updatedAt}::text`,
        impactEconomic: useCases.impactEconomic,
        impactTime: useCases.impactTime,
        impactQuality: useCases.impactQuality,
        impactCoordination: useCases.impactCoordination,
        impactSocial: useCases.impactSocial,
        feasibilityData: useCases.feasibilityData,
        feasibilityWorkflow: useCases.feasibilityWorkflow,
        feasibilityRisk: useCases.feasibilityRisk,
        feasibilityTech: useCases.feasibilityTech,
        feasibilityTeam: useCases.feasibilityTeam,
        esgEnvironmental: useCases.esgEnvironmental,
        esgSocial: useCases.esgSocial,
        esgGovernance: useCases.esgGovernance,
        customScores: useCases.customScores,
        aiSuggestion: useCases.aiSuggestion,
      })
      .from(useCases)
      .where(pending ? and(scope, inArray(useCases.id, pending)) : scope);
    if (rows.length === 0) break;
    const payload = rows.map(({ id, stamp, ...source }) => {
      const derived = deriveUseCasePortfolioMetrics(source, {
        model: { impactFlagEnabled: model.impactFlagEnabled, config },
        esgEnabled: workspace?.esgEnabled === true,
      });
      return {
        id,
        stamp,
        impact: derived.overallImpactScore,
        feasibility: derived.overallFeasibilityScore,
        esg: derived.overallEsgScore,
        overall: derived.overallScore,
        category: derived.category,
      };
    });
    const { rows: written } = await db.execute(sql`WITH d AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS d(
        id uuid, stamp text, impact double precision, feasibility double precision, esg double precision,
        overall double precision, category text)
    )
    UPDATE use_cases u SET
      overall_impact_score = d.impact,
      overall_feasibility_score = d.feasibility,
      overall_esg_score = d.esg,
      overall_score = d.overall,
      category = d.category::use_case_category,
      updated_at = now()
    FROM d
    WHERE u.id = d.id AND u.workspace_id = ${workspaceId}::uuid AND u.updated_at::text IS NOT DISTINCT FROM d.stamp
    RETURNING u.id`);
    const done = new Set(written.map((row) => String((row as { id: unknown }).id)));
    updated += done.size;
    pending = rows.map((row) => row.id).filter((id) => !done.has(id));
  }
  return updated;
}
