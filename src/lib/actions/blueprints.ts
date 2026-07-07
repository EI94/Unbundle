"use server";

import { requireSession } from "@/lib/auth/redirect-to-login";
import { getUseCasesByWorkspace } from "@/lib/db/queries/use-cases";
import { getActivitiesByWorkspace } from "@/lib/db/queries/activities";
import { generateAgentBlueprints, type AgentBlueprint } from "@/lib/ai/generate-blueprints";
import { db } from "@/lib/db";
import { agentBlueprints } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function generateBlueprintsAction(
  workspaceId: string
): Promise<AgentBlueprint[]> {
  await requireSession();

  const [useCases, activities] = await Promise.all([
    getUseCasesByWorkspace(workspaceId),
    getActivitiesByWorkspace(workspaceId),
  ]);

  if (useCases.length === 0) {
    throw new Error("Nessun use case disponibile. Genera prima i use case.");
  }

  const result = await generateAgentBlueprints(useCases, activities);

  await db.insert(agentBlueprints).values({
    workspaceId,
    content: result,
  });

  return result;
}

export async function getLatestBlueprints(
  workspaceId: string
): Promise<AgentBlueprint[] | null> {
  const [latest] = await db
    .select()
    .from(agentBlueprints)
    .where(eq(agentBlueprints.workspaceId, workspaceId))
    .orderBy(desc(agentBlueprints.generatedAt))
    .limit(1);

  return (latest?.content as AgentBlueprint[]) ?? null;
}
