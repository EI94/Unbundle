import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workspaces, weeklySignals, activities } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { CLAUDE_MODEL, ClaudeRefusalError, claudeCallSettings, throwIfRefused } from "@/lib/ai/models";
import { logSafeError } from "@/lib/log/safe-error";
import { z } from "zod";
import { runUseCaseDigestStep } from "@/lib/db/queries/use-case-digest";
import { loadPromptContext } from "@/lib/db/queries/context-work";
import { checkCronAuthorization } from "@/lib/uc/notify/cron-auth";

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
  // Un CRON_SECRET assente o vuoto rifiuta sempre: il confronto di prima faceva passare
  // «Bearer undefined», e da qui ora parte anche una scrittura (il passo dell'hub).
  if (checkCronAuthorization(req.headers.get("authorization"), process.env.CRON_SECRET) !== "ok") {
    return new Response("Unauthorized", { status: 401 });
  }

  // Passo dell'hub (docs/use-case/DESIGN.md §14.3): riepilogo «Use case» dei workspace con
  // l'area accesa, senza AI. Gira prima del ciclo AI qui sotto. Ha il suo try/catch per
  // workspace e non lancia mai.
  const useCaseHub = await runUseCaseDigestStep();

  const activeWorkspaces = await db
    .select()
    .from(workspaces)
    .where(
      and(
        eq(workspaces.status, "mapping"),
      )
    );

  // Un rifiuto o un errore del modello su un workspace non ferma gli altri. Nel log, con l'id del workspace, un
  // rifiuto ha solo il riepilogo dello stop (throwIfRefused); un altro errore, nome e codice.
  let failed = 0;
  for (const workspace of activeWorkspaces) {
    try {
      const allActivities = await db
        .select()
        .from(activities)
        .where(eq(activities.workspaceId, workspace.id));

      const unclassified = allActivities.filter((a) => !a.classification);
      const recentlyAdded = allActivities.filter(
        (a) =>
          a.createdAt > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      );
      // (Rilascio 9b, docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.12) Solo «In breve», «Per tutti». Il giro è lungo: l'ok
      // ai fornitori di AI si rilegge per ogni workspace ("now"). "" senza: il prompt di prima.
      const contesto = await loadPromptContext(workspace.id, { profile: "weeklySignals", consent: "now" });

      const { object } = await throwIfRefused("cron/weekly-pulse", generateObject({
        model: anthropic(CLAUDE_MODEL),
        schema: signalsSchema,
        prompt: `Analizza lo stato attuale del workspace "${workspace.name}" e genera segnali settimanali.

Stato:
- Attività totali: ${allActivities.length}
- Non classificate: ${unclassified.length}
- Aggiunte questa settimana: ${recentlyAdded.length}
- Status workspace: ${workspace.status}
${contesto}
Genera 2-5 segnali rilevanti per il team di trasformazione. Segnali possibili:
- new_task_detected: nuove attività emerse
- classification_change: cambio nella classificazione consigliato
- new_use_case_opportunity: nuova opportunità di use case
- risk_alert: rischio o problema emerso
- progress_update: aggiornamento sullo stato di avanzamento

Scrivi in italiano.`,
        ...claudeCallSettings("weeklySignals"),
      }), { workspaceId: workspace.id });

      for (const signal of object.signals) {
        await db.insert(weeklySignals).values({
          workspaceId: workspace.id,
          signalType: signal.signalType,
          title: signal.title,
          description: signal.description,
        });
      }
    } catch (error) {
      failed += 1;
      if (!(error instanceof ClaudeRefusalError)) logSafeError("cron/weekly-pulse", "segnali_non_generati", error, { workspaceId: workspace.id });
    }
  }

  // Nessun workspace riuscito (per esempio il modello che risponde 404 a tutti, come quando è stato ritirato): 500 con
  // lo stesso corpo, così il giro risulta fallito nei log del cron. Se ne fallisce solo una parte, 200 con quanti.
  const allFailed = activeWorkspaces.length > 0 && failed === activeWorkspaces.length;
  return NextResponse.json({ processed: activeWorkspaces.length, failed, useCaseHub }, { status: allFailed ? 500 : 200 });
}
