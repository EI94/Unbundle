import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workspaces, weeklySignals, activities } from "@/lib/db/schema";
import { eq, isNull, and, gte } from "drizzle-orm";
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

const signalsSchema = z.object({
  signals: z.array(
    z.object({
      signalType: z.enum([
        "new_task_detected",
        "classification_change",
        "new_benchmark",
        "new_use_case_opportunity",
        "risk_alert",
        "progress_update",
      ]),
      title: z.string(),
      description: z.string(),
    })
  ),
});

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const activeWorkspaces = await db
    .select()
    .from(workspaces)
    .where(
      and(
        eq(workspaces.status, "mapping"),
      )
    );

  for (const workspace of activeWorkspaces) {
    const allActivities = await db
      .select()
      .from(activities)
      .where(eq(activities.workspaceId, workspace.id));

    const unclassified = allActivities.filter((a) => !a.classification);
    const recentlyAdded = allActivities.filter(
      (a) =>
        a.createdAt > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    );

    const { object } = await generateObject({
      model: anthropic("claude-sonnet-4-20250514"),
      schema: signalsSchema,
      prompt: `Analizza lo stato attuale del workspace "${workspace.name}" e genera segnali settimanali.

Stato:
- Attività totali: ${allActivities.length}
- Non classificate: ${unclassified.length}
- Aggiunte questa settimana: ${recentlyAdded.length}
- Status workspace: ${workspace.status}

Genera 2-5 segnali rilevanti per il team di trasformazione. Segnali possibili:
- new_task_detected: nuove attività emerse
- classification_change: cambio nella classificazione consigliato
- new_use_case_opportunity: nuova opportunità di use case
- risk_alert: rischio o problema emerso
- progress_update: aggiornamento sullo stato di avanzamento

Scrivi in italiano.`,
    });

    for (const signal of object.signals) {
      await db.insert(weeklySignals).values({
        workspaceId: workspace.id,
        signalType: signal.signalType,
        title: signal.title,
        description: signal.description,
      });
    }
  }

  return NextResponse.json({ processed: activeWorkspaces.length });
}
