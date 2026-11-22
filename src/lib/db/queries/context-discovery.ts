import "server-only";
/**
 * I dati della Discovery, letti dal vivo per la Memoria (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §7.2):
 * la tesi del valore del workspace, il perimetro, le unità con le attività mappate, gli obiettivi. Dipendenti e ricavo
 * solo ai revisori, come «Programma». Niente si copia tra i fatti: si legge dov'è.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getWorkspaceValueThesis } from "@/lib/db/queries/value-thesis";
import { activities, departments, strategicGoals, type Workspace } from "@/lib/db/schema";
import { buildLiveRows, type LiveDiscoveryData, type LiveRow } from "@/lib/context/live";
import { contextAbilities, type ContextActor } from "@/lib/context/visibility";
import { logSafeError } from "@/lib/log/safe-error";

export type { LiveRow } from "@/lib/context/live";

/** Dipendenti e ricavo dell'ultimo anno, dalle impostazioni di «Programma». Senza la sua tabella, o se non riesce: niente. */
async function companyFigures(workspaceId: string): Promise<{ employees: number | null; revenueEur: number | null }> {
  try {
    const { readProgramSettings } = await import("@/lib/db/queries/use-case-program");
    const settings = await readProgramSettings(workspaceId);
    return { employees: settings.employees, revenueEur: settings.revenueEur };
  } catch (error) {
    logSafeError("context/discovery", "cifre_non_lette", error, { workspaceId });
    return { employees: null, revenueEur: null };
  }
}

/** I dati della Discovery come righe (§7.2): tesi del valore, perimetro, unità con le attività, obiettivi; dipendenti e ricavo solo ai revisori. */
export async function loadLiveDiscovery(workspace: Workspace, viewer: Pick<ContextActor, "role" | "isLateralSpace">): Promise<LiveRow[]> {
  const data = await loadLiveDiscoveryData(workspace, viewer);
  return data ? buildLiveRows(data) : [];
}

/**
 * I dati della Discovery come sono, prima delle righe: per «In breve», che ne fa le righe del prompt e quelle della sua
 * impronta (con le etichette ferme, `liveHashLines`). null per chi non apre «Contesto».
 */
export async function loadLiveDiscoveryData(workspace: Workspace, viewer: Pick<ContextActor, "role" | "isLateralSpace">): Promise<LiveDiscoveryData | null> {
  const abilities = contextAbilities(viewer);
  if (!abilities.canOpen) return null;
  const [thesis, units, counts, goals, figures] = await Promise.all([
    getWorkspaceValueThesis(workspace.id),
    db
      .select({ id: departments.id, name: departments.name, description: departments.description, teamSize: departments.teamSize })
      .from(departments)
      .where(eq(departments.workspaceId, workspace.id))
      .orderBy(departments.name),
    db
      .select({ departmentId: activities.departmentId, n: sql<number>`count(*)::int` })
      .from(activities)
      .where(eq(activities.workspaceId, workspace.id))
      .groupBy(activities.departmentId),
    db
      .select({ id: strategicGoals.id, type: strategicGoals.type, title: strategicGoals.title })
      .from(strategicGoals)
      .where(eq(strategicGoals.workspaceId, workspace.id))
      .orderBy(strategicGoals.createdAt),
    abilities.canSeeCompanyFigures ? companyFigures(workspace.id) : Promise.resolve({ employees: null, revenueEur: null }),
  ]);
  return {
    thesis,
    boundary: workspace.systemBoundary,
    departments: units,
    activityCounts: new Map(counts.map((c) => [c.departmentId, Number(c.n)])),
    goals,
    employees: figures.employees,
    revenueEur: figures.revenueEur,
  };
}
