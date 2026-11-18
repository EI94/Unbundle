"use server";

import { requireSession } from "@/lib/auth/redirect-to-login";
import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import { getUseCasesByWorkspace } from "@/lib/db/queries/use-cases";
import { getActivitiesByWorkspace } from "@/lib/db/queries/activities";
import { getDepartmentsByWorkspace } from "@/lib/db/queries/workspaces";
import { db } from "@/lib/db";
import { simulations } from "@/lib/db/schema";
import { getWorkspaceValueThesis } from "@/lib/db/queries/value-thesis";
import { loadPromptContext } from "@/lib/db/queries/context-work";
import { eq, desc } from "drizzle-orm";
import { generateSimulation, type SimulationResult } from "@/lib/ai/generate-simulation";
import { getCollaboratorAccess } from "@/lib/workspace-access";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";

export async function generateSimulationAction(
  workspaceId: string
): Promise<SimulationResult> {
  const session = await requireSession();

  const access = await getCollaboratorAccess(session.user.id, workspaceId);
  if (!access) throw new Error("Workspace non trovato");
  if (!canReviewWorkspacePortfolio(access.role)) {
    throw new Error("Non hai i permessi per generare simulazioni.");
  }
  // (9a) La tesi del valore del workspace, non più quella dell'organizzazione.
  const thesis = await getWorkspaceValueThesis(workspaceId);

  // (Rilascio 9b, docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.12) Con il blocco «Contesto» («In breve» e i fatti «Per
  // tutti» sull'azienda e sugli obiettivi); "" senza l'ok ai fornitori di AI.
  const [useCases, activities, departments, contesto] = await Promise.all([
    getUseCasesByWorkspace(workspaceId),
    getActivitiesByWorkspace(workspaceId),
    getDepartmentsByWorkspace(workspaceId),
    loadPromptContext(workspaceId, { profile: "simulation", consent: "request" }),
  ]);

  const result = await generateSimulation(
    {
      useCases,
      activities,
      departments,
      companyValueThesis: thesis,
    },
    contesto,
  );

  await db.insert(simulations).values({
    workspaceId,
    content: result,
  });

  return result;
}

export async function getLatestSimulation(
  workspaceId: string
): Promise<SimulationResult | null> {
  // La generazione qui sopra era protetta, la lettura no: la simulazione di
  // qualunque cliente era leggibile da chiunque conoscesse un workspaceId.
  await requireWorkspaceAccess(workspaceId);

  const [latest] = await db
    .select()
    .from(simulations)
    .where(eq(simulations.workspaceId, workspaceId))
    .orderBy(desc(simulations.generatedAt))
    .limit(1);

  return (latest?.content as SimulationResult) ?? null;
}
