import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { Activity, StrategicGoal } from "@/lib/db/schema";

const useCasesArraySchema = z.object({
  useCases: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      businessCase: z.string(),
      impactEconomic: z.number().min(1).max(5),
      impactTime: z.number().min(1).max(5),
      impactQuality: z.number().min(1).max(5),
      impactCoordination: z.number().min(1).max(5),
      impactSocial: z.number().min(1).max(5),
      feasibilityData: z.number().min(1).max(5),
      feasibilityWorkflow: z.number().min(1).max(5),
      feasibilityRisk: z.number().min(1).max(5),
      feasibilityTech: z.number().min(1).max(5),
      feasibilityTeam: z.number().min(1).max(5),
      requirements: z.array(z.string()),
      dataDependencies: z.array(z.string()),
      relatedActivityIds: z.array(z.string()),
      timeline: z.string(),
      relatedKrTitles: z.array(z.string()),
      leverType: z
        .string()
        .describe(
          "Tipo di leva: revenue_growth, cost_reduction, time_to_value, margin_protection, quality_uplift, coordination_improvement, esg_impact"
        ),
    })
  ),
});

export async function generateUseCases(
  activities: Activity[],
  strategicContext: {
    companyValueThesis: unknown;
    goals: StrategicGoal[];
  }
) {
  const activitiesSummary = activities
    .map(
      (a) =>
        `[${a.id}] "${a.title}" (${a.workType ?? "N/A"}, ${a.classification ?? "non classificata"}) - ${a.description ?? ""}`
    )
    .join("\n");

  const goalsSummary = strategicContext.goals
    .map(
      (g) =>
        `[${g.type}] "${g.title}" - Direction: ${g.direction ?? "N/A"}, Target: ${g.targetValue ?? "N/A"}, Owner: ${g.owner ?? "N/A"}`
    )
    .join("\n");

  const { object } = await generateObject({
    model: anthropic("claude-sonnet-4-20250514"),
    schema: useCasesArraySchema,
    prompt: `Sei un esperto di AI transformation. Analizza le attività classificate e il contesto strategico per generare use case AI concreti e azionabili.

## Attività mappate
${activitiesSummary}

## Contesto strategico (Value Thesis)
${JSON.stringify(strategicContext.companyValueThesis ?? {}, null, 2)}

## Obiettivi strategici / OKR
${goalsSummary}

## Regole per la generazione

1. **Ogni use case deve essere concreto e implementabile**: non idee vaghe ma progetti con scope chiaro
2. **Ogni use case deve essere legato a specifiche attività**: usa gli ID delle attività in relatedActivityIds
3. **Ogni use case deve essere legato a KR/obiettivi quando possibile**
4. **Scoring rigoroso** (1-5 per ogni asse):
   - Impatto: economico, tempo, qualità, coordinamento, sociale
   - Fattibilità: disponibilità dati, chiarezza workflow, rischio, complessità tech, prontezza team
5. **Business case dettagliato**: numeri, metriche attese, costi evitati
6. **Genera 3 categorie**:
   - Top 3 "Automate" streams (attività da automatizzare/comprimere)
   - Top 3 "Differentiate" domains (dove concentrare energia umana)
   - Top 3 "Innovate" opportunities (nuovi prodotti/servizi possibili con AI)
7. Ogni use case deve avere un timeline realistico
8. Non generare più di 12 use case totali

Genera gli use case in italiano.`,
  });

  return object.useCases;
}
