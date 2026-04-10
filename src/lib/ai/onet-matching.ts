import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { Activity } from "@/lib/db/schema";

const onetMatchSchema = z.object({
  matches: z.array(
    z.object({
      activityId: z.string(),
      suggestedOnetCode: z.string(),
      occupationTitle: z.string(),
      relevantTasks: z.array(z.string()),
      aiExposureEstimate: z
        .number()
        .min(0)
        .max(1)
        .describe(
          "Stima dell'AI exposure (0-1) basata su ricerca Anthropic e capability teorica"
        ),
      augmentationVsAutomation: z
        .enum(["mostly_automation", "mostly_augmentation", "mixed"])
        .describe("Se l'AI interviene come automazione o augmentation"),
      reasoning: z.string(),
    })
  ),
});

export async function matchActivitiesToOnet(activities: Activity[]) {
  const activitySummaries = activities.map(
    (a) =>
      `[${a.id}] "${a.title}": ${a.description ?? ""} (workType: ${a.workType ?? "N/A"}, classification: ${a.classification ?? "N/A"})`
  );

  const { object } = await generateObject({
    model: anthropic("claude-sonnet-4-20250514"),
    schema: onetMatchSchema,
    prompt: `Sei un esperto di O*NET e di AI exposure research. Per ogni attività lavorativa, identifica:
1. Il codice O*NET SOC più vicino e il titolo occupazionale
2. I task statements O*NET più rilevanti
3. Una stima di AI exposure basata su ricerca Anthropic (observed usage vs theoretical capability)
4. Se l'impatto AI è più automazione o augmentation

## Attività da analizzare
${activitySummaries.join("\n")}

## Riferimenti per la stima AI exposure
- Usa i principi della ricerca Anthropic sull'Economic Index: l'uso reale dell'AI è spesso molto inferiore alla capability teorica
- Attività con alto judgment → bassa automation, possibile augmentation
- Attività ripetitive con input/output chiari → alta automazione
- L'AI exposure osservata media è circa 0.05-0.15 per la maggior parte delle occupazioni
- Le occupazioni più esposte (coding, writing, analysis) arrivano a 0.30-0.40 di observed exposure

Per ogni attività, fornisci un match O*NET e una stima informata.`,
  });

  return object.matches;
}
