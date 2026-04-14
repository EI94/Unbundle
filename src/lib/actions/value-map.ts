"use server";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { valueMapNodes, activities, organizations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { getActivitiesByWorkspace } from "@/lib/db/queries/activities";
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

export async function generateValueMapAction(workspaceId: string) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) throw new Error("Workspace non trovato");

  const allActivities = await getActivitiesByWorkspace(workspaceId);
  const classified = allActivities.filter((a) => a.classification);

  if (classified.length === 0) {
    throw new Error("Nessuna attività classificata.");
  }

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, workspace.organizationId))
    .limit(1);

  const activitySummaries = classified.map((a) => ({
    id: a.id,
    title: a.title,
    description: a.description,
    workType: a.workType,
    classification: a.classification,
    timeSpentHoursWeek: a.timeSpentHoursWeek,
  }));

  const { object: positions } = await generateObject({
    model: anthropic("claude-sonnet-4-20250514"),
    system: `Sei un esperto di Wardley Mapping. Posiziona ogni attività su una mappa Wardley con due assi:
- **X (Maturità/Evolution)**: 0 = Genesis/Sperimentale, 0.25 = Custom, 0.5 = Product, 0.75 = Commodity, 1 = Utility
- **Y (Valore Strategico)**: 0 = Basso valore, pura esecuzione, 1 = Altissimo valore strategico, differenziante

I 3 stream del framework Unbundle:
- **AUTOMATE** ("Questo lavoro non dovrebbe esistere nella sua forma attuale"): Y basso (0.05-0.35), X alto (0.65-0.95) — sono commodity/utility
- **DIFFERENTIATE** ("Qui concentrare l'energia umana"): Y alto (0.65-0.95), X basso-medio (0.15-0.55) — sono custom/product, il valore è nel giudizio umano
- **INNOVATE** ("Questo valore prima non esisteva"): Y medio-alto (0.5-0.85), X molto basso (0.0-0.3) — sono genesis/sperimentali, opportunità emergenti

Value Thesis dell'azienda (usala per capire cosa è davvero strategico): ${JSON.stringify(org?.companyValueThesis ?? {})}`,
    messages: [
      {
        role: "user",
        content: `Posiziona queste ${activitySummaries.length} attività sulla Wardley Map:\n\n${JSON.stringify(activitySummaries, null, 2)}`,
      },
    ],
    schema: z.object({
      nodes: z.array(
        z.object({
          activityId: z.string(),
          xMaturity: z.number().min(0).max(1),
          yStrategicValue: z.number().min(0).max(1),
        })
      ),
    }),
  });

  await db
    .delete(valueMapNodes)
    .where(eq(valueMapNodes.workspaceId, workspaceId));

  if (positions.nodes.length > 0) {
    await db.insert(valueMapNodes).values(
      positions.nodes.map((n) => ({
        workspaceId,
        activityId: n.activityId,
        xMaturity: n.xMaturity,
        yStrategicValue: n.yStrategicValue,
      }))
    );
  }

  return { positioned: positions.nodes.length };
}
