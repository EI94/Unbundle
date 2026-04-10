import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { Activity, StrategicGoal } from "@/lib/db/schema";

const classificationSchema = z.object({
  classification: z.enum([
    "automatable",
    "augmentable",
    "differentiating",
    "emerging_opportunity",
    "blocked_by_system",
    "blocked_by_governance",
  ]),
  confidenceScore: z.number().min(0).max(1),
  reasoning: z.string(),
  aiPotential: z.string(),
});

export type ClassificationResult = z.infer<typeof classificationSchema>;

export async function classifyActivity(
  activity: Activity,
  strategicContext: {
    companyValueThesis: unknown;
    goals: StrategicGoal[];
  }
): Promise<ClassificationResult> {
  const { object } = await generateObject({
    model: anthropic("claude-sonnet-4-20250514"),
    schema: classificationSchema,
    prompt: `Analizza questa attività lavorativa e classificala secondo il framework Unbundle.

## Attività
- **Titolo**: ${activity.title}
- **Descrizione**: ${activity.description}
- **Work Type**: ${activity.workType ?? "non classificato"}
- **Frequenza**: ${activity.frequency ?? "non specificata"}
- **Ore/settimana**: ${activity.timeSpentHoursWeek ?? "non specificato"}
- **Strumenti**: ${activity.toolsUsed?.join(", ") ?? "non specificati"}
- **Input**: ${activity.inputDescription ?? "non specificato"}
- **Output**: ${activity.outputDescription ?? "non specificato"}
- **Decision points**: ${activity.decisionPoints ?? "non specificati"}
- **Pain points**: ${activity.painPoints ?? "non specificati"}

## Contesto strategico
${JSON.stringify(strategicContext.companyValueThesis ?? {}, null, 2)}

## Obiettivi strategici
${strategicContext.goals.map((g) => `- [${g.type}] ${g.title}`).join("\n")}

## Classificazioni possibili
- **automatable**: l'attività può essere automatizzata end-to-end con AI/software. Basso giudizio umano richiesto, alta ripetitività, input/output ben definiti.
- **augmentable**: l'AI può migliorare significativamente l'efficacia umana. Serve ancora giudizio ma l'AI accelera analisi, suggerimenti, qualità.
- **differentiating**: attività core che crea vantaggio competitivo. Il giudizio umano è il valore. Da proteggere e potenziare, non automatizzare.
- **emerging_opportunity**: con l'AI emergono possibilità nuove. Prodotti, servizi o insight che prima non erano possibili.
- **blocked_by_system**: potenzialmente automatizzabile ma bloccata da vincoli tecnici (dati frammentati, sistemi legacy, API mancanti).
- **blocked_by_governance**: potenzialmente automatizzabile ma bloccata da policy, compliance, qualità dati, privacy.

Classifica con il massimo rigore. La confidence score deve riflettere quanto sei sicuro.`,
  });

  return object;
}

export async function classifyActivitiesBatch(
  activities: Activity[],
  strategicContext: {
    companyValueThesis: unknown;
    goals: StrategicGoal[];
  }
): Promise<Map<string, ClassificationResult>> {
  const results = new Map<string, ClassificationResult>();

  const batchSize = 3;
  for (let i = 0; i < activities.length; i += batchSize) {
    const batch = activities.slice(i, i + batchSize);
    const classifications = await Promise.all(
      batch.map((activity) => classifyActivity(activity, strategicContext))
    );
    batch.forEach((activity, idx) => {
      results.set(activity.id, classifications[idx]);
    });
  }

  return results;
}
