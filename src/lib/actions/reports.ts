"use server";

import { requireSession } from "@/lib/auth/redirect-to-login";
import { revalidatePath } from "next/cache";
import { getActivitiesByWorkspace } from "@/lib/db/queries/activities";
import {
  getDepartmentsByWorkspace,
  getStrategicGoalsByWorkspace,
} from "@/lib/db/queries/workspaces";
import { getUseCasesByWorkspace } from "@/lib/db/queries/use-cases";
import { db } from "@/lib/db";
import { reports } from "@/lib/db/schema";
import { getWorkspaceValueThesis } from "@/lib/db/queries/value-thesis";
import { loadPromptContext } from "@/lib/db/queries/context-work";
import { generateReport } from "@/lib/ai/generate-report";
import { getCollaboratorAccess } from "@/lib/workspace-access";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";

export async function generateReportAction(workspaceId: string) {
  const session = await requireSession();

  const access = await getCollaboratorAccess(session.user.id, workspaceId);
  if (!access) throw new Error("Workspace non trovato");
  if (!canReviewWorkspacePortfolio(access.role)) {
    throw new Error("Non hai i permessi per generare report.");
  }
  const { workspace } = access;

  // (9a) La tesi del valore del workspace, non più quella dell'organizzazione.
  const thesis = await getWorkspaceValueThesis(workspaceId);

  // (Rilascio 9b, docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.12) Con il blocco «Contesto»: «In breve» e i fatti «Per
  // tutti» confermati, perché il report non contraddica quello che si sa già. "" senza l'ok ai fornitori di AI.
  const [departments, activities, useCases, goals, contesto] = await Promise.all([
    getDepartmentsByWorkspace(workspaceId),
    getActivitiesByWorkspace(workspaceId),
    getUseCasesByWorkspace(workspaceId),
    getStrategicGoalsByWorkspace(workspaceId),
    loadPromptContext(workspaceId, { profile: "report", consent: "request" }),
  ]);

  const reportContent = await generateReport(
    {
      companyValueThesis: thesis,
      departments,
      activities,
      useCases,
      goals,
    },
    contesto,
  );

  const [report] = await db
    .insert(reports)
    .values({
      workspaceId,
      type: "full_report",
      title: `Report Unbundle - ${workspace.name}`,
      content: reportContent,
    })
    .returning();

  revalidatePath(`/dashboard/${workspaceId}/reports`);
  return report;
}
