import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { CLAUDE_MODEL, ClaudeRefusalError, MOTIVAZIONE_DESCRIPTION, claudeCallSettings, throwIfRefused } from "@/lib/ai/models";
import { logSafeError } from "@/lib/log/safe-error";
import { z } from "zod";
import type { Activity, StrategicGoal } from "@/lib/db/schema";

/** Lo schema che il modello riempie: la motivazione ha un nome neutro (MOTIVAZIONE_DESCRIPTION in models.ts). */
const classificationSchema = z.object({
  classification: z.enum(["automate", "differentiate", "innovate"]),
  confidenceScore: z.number().min(0).max(1),
  motivazione: z.string().describe(MOTIVAZIONE_DESCRIPTION),
  aiPotential: z.string(),
});

/** La classificazione per l'app: la motivazione torna in `reasoning`, come sempre. */
export type ClassificationResult = Omit<z.infer<typeof classificationSchema>, "motivazione"> & { reasoning: string };

export async function classifyActivity(
  activity: Activity,
  strategicContext: {
    companyValueThesis: unknown;
    goals: StrategicGoal[];
  }
): Promise<ClassificationResult> {
  const { object } = throwIfRefused("ai/classify", await generateObject({
    model: anthropic(CLAUDE_MODEL),
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
    ...claudeCallSettings("classifyActivity"),
  }));

  const { motivazione, ...classification } = object;
  return { ...classification, reasoning: motivazione };
}

/**
 * Le classificazioni riuscite, per id dell'attività. Un rifiuto o un errore del modello su un'attività non fa perdere
 * le altre: quell'attività resta senza classificazione (chi chiama conta quante ne mancano) e si riprova dopo.
 */
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
    const outcomes = await Promise.allSettled(
      batch.map((activity) => classifyActivity(activity, strategicContext))
    );
    outcomes.forEach((outcome, idx) => {
      if (outcome.status === "fulfilled") {
        results.set(batch[idx].id, outcome.value);
      } else if (!(outcome.reason instanceof ClaudeRefusalError)) {
        // Un rifiuto è già nel log con il solo riepilogo dello stop (throwIfRefused); un altro errore, per nome e codice.
        logSafeError("ai/classify", "classificazione_non_riuscita", outcome.reason);
      }
    });
  }

  return results;
}

/** Quante attività sono rimaste senza classificazione, in parole («» se nessuna). */
export function skippedClassificationsText(skipped: number): string {
  if (skipped <= 0) return "";
  return skipped === 1 ? "1 attività è rimasta da classificare." : `${skipped} attività sono rimaste da classificare.`;
}
