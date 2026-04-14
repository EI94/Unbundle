import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { Activity, StrategicGoal } from "@/lib/db/schema";

const classificationSchema = z.object({
  classification: z.enum(["automate", "differentiate", "innovate"]),
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
    prompt: `Analizza questa attività lavorativa e classificala in uno dei 3 stream del framework Unbundle.

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

## I 3 STREAM

### AUTOMATE — "Questo lavoro non dovrebbe esistere nella sua forma attuale."
Processi da eliminare o ristrutturare. Lavoro dove l'energia umana viene spesa su task che le macchine dovrebbero gestire. Caratteristiche:
- Alta ripetitività, basso giudizio umano
- Input/output ben definiti
- Il valore sta nell'esecuzione veloce e accurata, non nell'interpretazione
- Spesso source di errori manuali e ritardi
- Include anche attività "bloccate" da sistemi legacy o governance che, una volta sbloccate, andrebbero automatizzate

### DIFFERENTIATE — "Qui concentrare l'energia umana."
Dove risiede il vantaggio competitivo. Il lavoro che solo le tue persone possono fare. Caratteristiche:
- Richiede giudizio, esperienza, relazioni
- È parte dei nodi strategici della value thesis
- L'AI può augmentare (assistere, accelerare) ma NON sostituire
- Se lo automatizzo, perdo vantaggio competitivo
- Include decision-making strategico, relazioni con clienti, design creativo

### INNOVATE — "Questo valore prima non esisteva."
Opportunità nuove che emergono dai pattern cross-organizzativi. Revenue stream, prodotti, servizi che diventano possibili quando vedi cosa gli altri non vedono. Caratteristiche:
- Non è un'attività "corrente" ottimizzabile — è un'opportunità latente
- Emerge dalla combinazione di dati, processi, competenze già esistenti
- L'AI abilita insight, prodotti o servizi completamente nuovi
- Ha potenziale di revenue o di trasformazione del modello di business

Classifica con rigore. Se l'attività è palesemente operativa e ripetitiva → AUTOMATE. Se è il cuore del valore → DIFFERENTIATE. Se nasconde un'opportunità di innovazione → INNOVATE. In caso di dubbio, scegli AUTOMATE (è il default per il lavoro che "c'è ma non dovrebbe esserci così").`,
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
