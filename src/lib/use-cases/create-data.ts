import "server-only";
import { and, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ensureDbSchema } from "@/lib/db/ensure-schema";
import { activities, useCases } from "@/lib/db/schema";
import { getWorkspaceScoringModel, normalizeScoringConfig } from "@/lib/db/queries/scoring-model";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { reviewTeamName } from "@/lib/review-team";
import { activityMappingState, type ActivityMappingState } from "./create";
import { resolveCostBands, type CostBandInfo } from "./cost-bands";
import { REDACTED_TEXT } from "./service";
import { workspaceValuationModel } from "./views";

/**
 * Nuovo use case e Activity mapping: le letture che servono alle pagine (docs/use-case/DESIGN.md
 * §5.2, §5.3, §8.5; PIANO-LAVORI H3c). Nessuna lettura guarda chi ha proposto.
 */

/** Quanti valori di «AI Lab» propone il pannello rapido. */
const AI_LAB_OPTIONS_MAX = 100;

export interface QuickCreateOptions {
  /** I valori di `ai_lab` del workspace, dal più recente. */
  aiLabs: string[];
  /** L'ultimo usato nel workspace (non per persona): il campo parte da qui. */
  lastAiLab: string | null;
}

/**
 * Il campo «AI Lab» del pannello rapido (§5.2): i valori del workspace e l'ultimo usato, cioè
 * quello della scheda più recente che ne ha uno. Una query, per valore e per data.
 *
 * Il segnaposto di «Oscura testo» (`REDACTED_TEXT`, §6.8) non è un AI Lab: «Oscura testo» lo
 * scrive in `ai_lab` senza cambiare `created_at`, e altrimenti il pannello lo proporrebbe e lo
 * terrebbe per ogni scheda della sessione.
 */
export async function quickCreateOptions(workspaceId: string): Promise<QuickCreateOptions> {
  await ensureDbSchema();
  const lastAt = sql`max(${useCases.createdAt})`;
  const rows = await db
    .select({ aiLab: useCases.aiLab })
    .from(useCases)
    .where(and(eq(useCases.workspaceId, workspaceId), isNotNull(useCases.aiLab), ne(useCases.aiLab, REDACTED_TEXT)))
    .groupBy(useCases.aiLab)
    .orderBy(desc(lastAt), useCases.aiLab)
    .limit(AI_LAB_OPTIONS_MAX);
  const aiLabs = [
    ...new Set(
      rows.flatMap((row) => {
        const lab = row.aiLab?.trim();
        return lab && lab !== REDACTED_TEXT ? [lab] : [];
      }),
    ),
  ];
  return { aiLabs, lastAiLab: aiLabs[0] ?? null };
}

export interface NewUseCaseFormContext {
  /** Il nome del team che valuta (§14.2), per il sottotitolo. */
  teamName: string;
  /** «Impatto ambientale e sociale» solo con ESG attivo. */
  esgEnabled: boolean;
  /** Le 5 fasce del costo del workspace (D15), per il campo costo dei revisori. */
  costBands: readonly CostBandInfo[];
}

/**
 * Il contesto del modulo completo: nome del team, ESG e fasce del costo del workspace, lette
 * come le legge la pagina «Use case» (`workspaceValuationModel`, `resolveCostBands`).
 */
export async function newUseCaseFormContext(workspaceId: string): Promise<NewUseCaseFormContext> {
  const [workspace, scoring] = await Promise.all([getWorkspaceById(workspaceId), getWorkspaceScoringModel(workspaceId)]);
  const resolved = scoring?.resolvedConfig ?? normalizeScoringConfig(null);
  const model = workspaceValuationModel(resolved, scoring?.config ?? null);
  return {
    teamName: reviewTeamName(workspace),
    esgEnabled: workspace?.esgEnabled === true,
    costBands: resolveCostBands(model),
  };
}

/**
 * Il menu «⋯» › «Proponi da Activity mapping» (§8.5): con attività da classificare (o nessuna
 * attività) il messaggio «Prima classifica le attività in Activity mapping.», altrimenti il
 * dialogo. Due conteggi del workspace, nient'altro.
 */
export async function activityMappingReadiness(workspaceId: string): Promise<ActivityMappingState> {
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      classified: sql<number>`count(${activities.classification})::int`,
    })
    .from(activities)
    .where(eq(activities.workspaceId, workspaceId));
  return activityMappingState({ total: Number(counts?.total ?? 0), classified: Number(counts?.classified ?? 0) });
}
