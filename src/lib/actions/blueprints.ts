"use server";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getUseCasesByWorkspace } from "@/lib/db/queries/use-cases";
import { getActivitiesByWorkspace } from "@/lib/db/queries/activities";
import { generateAgentBlueprints, type AgentBlueprint } from "@/lib/ai/generate-blueprints";

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

  return generateAgentBlueprints(useCases, activities);
}
