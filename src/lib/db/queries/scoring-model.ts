import { eq } from "drizzle-orm";
import { db } from "..";
import {
  workspaceScoringModels,
  type WorkspaceScoringModel,
  type NewWorkspaceScoringModel,
} from "../schema";

export const DEFAULT_SCORING_MODEL_CONFIG: NonNullable<
  WorkspaceScoringModel["config"]
> = {
  weights: {
    impact: {
      economic: 1,
      time: 1,
      quality: 1,
      coordination: 1,
      social: 1,
    },
    feasibility: {
      data: 1,
      workflow: 1,
      risk: 1,
      tech: 1,
      team: 1,
    },
    esg: {
      environmental: 1,
      social: 1,
      governance: 1,
    },
    overall: {
      impact: 0.5,
      feasibility: 0.5,
      /**
       * Peso relativo della componente ESG nel ranking finale quando l'Impact Flag è attivo.
       * Il calcolo normalizza automaticamente i pesi.
       */
      esgWhenEnabled: 0.2,
    },
  },
  thresholds: {
    highImpact: 3.5,
    highFeasibility: 3.5,
    midImpact: 2.5,
  },
};

export async function getWorkspaceScoringModel(workspaceId: string) {
  const [row] = await db
    .select()
    .from(workspaceScoringModels)
    .where(eq(workspaceScoringModels.workspaceId, workspaceId))
    .limit(1);
  return row ?? null;
}

export async function getOrCreateWorkspaceScoringModel(workspaceId: string) {
  const existing = await getWorkspaceScoringModel(workspaceId);
  if (existing) return existing;

  const [row] = await db
    .insert(workspaceScoringModels)
    .values({
      workspaceId,
      impactFlagEnabled: false,
      config: DEFAULT_SCORING_MODEL_CONFIG,
      updatedAt: new Date(),
    } satisfies NewWorkspaceScoringModel)
    .returning();
  return row;
}

export async function upsertWorkspaceScoringModel(params: {
  workspaceId: string;
  impactFlagEnabled: boolean;
  config: WorkspaceScoringModel["config"];
  updatedByUserId?: string | null;
}) {
  const [row] = await db
    .insert(workspaceScoringModels)
    .values({
      workspaceId: params.workspaceId,
      impactFlagEnabled: params.impactFlagEnabled,
      config: params.config ?? DEFAULT_SCORING_MODEL_CONFIG,
      updatedByUserId: params.updatedByUserId ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: workspaceScoringModels.workspaceId,
      set: {
        impactFlagEnabled: params.impactFlagEnabled,
        config: params.config ?? DEFAULT_SCORING_MODEL_CONFIG,
        updatedByUserId: params.updatedByUserId ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

