"use server";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getUseCasesByWorkspace } from "@/lib/db/queries/use-cases";
import { getActivitiesByWorkspace } from "@/lib/db/queries/activities";
import { generateAgentBlueprints, type AgentBlueprint } from "@/lib/ai/generate-blueprints";
import { db } from "@/lib/db";
import { agentBlueprints } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function generateBlueprintsAction(
  workspaceId: string
): Promise<AgentBlueprint[]> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

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
