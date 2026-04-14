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
      esgEnvironmental: z
        .number()
        .min(1)
        .max(5)
        .describe(
          "Impatto ambientale: riduzione emissioni, risparmio energetico, riduzione carta/stampe, efficienza risorse"
        ),
      esgSocial: z
        .number()
        .min(1)
        .max(5)
        .describe(
          "Impatto sociale: miglioramento condizioni lavorative, riduzione burnout, inclusività, impatto sulla comunità"
        ),
      esgGovernance: z
        .number()
        .min(1)
        .max(5)
        .describe(
          "Impatto governance: trasparenza, audit trail, compliance, riduzione rischio operativo"
        ),
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
5. **Scoring ESG rigoroso** (1-5 per ogni dimensione):
   - **Ambientale (esgEnvironmental)**: riduzione emissioni CO2, risparmio energetico, riduzione carta/stampe/logistica, efficienza risorse naturali, riduzione rifiuti digitali e fisici
   - **Sociale (esgSocial)**: miglioramento condizioni lavorative, riduzione burnout e stress, inclusività e accessibilità, impatto sulla comunità locale, work-life balance, upskilling/reskilling
   - **Governance (esgGovernance)**: trasparenza decisionale, audit trail automatizzati, compliance normativa, riduzione rischio operativo, accountability, data privacy
   Sii onesto: se un use case non ha impatto ESG significativo, dai punteggi bassi (1-2). Non gonfiare.
6. **Business case dettagliato**: numeri, metriche attese, costi evitati
7. **Genera 3 categorie**:
   - Top 3 "Automate" streams (attività da automatizzare/comprimere)
   - Top 3 "Differentiate" domains (dove concentrare energia umana)
   - Top 3 "Innovate" opportunities (nuovi prodotti/servizi possibili con AI)
8. Ogni use case deve avere un timeline realistico
9. Non generare più di 12 use case totali

Genera gli use case in italiano.`,
  });

  return object.useCases;
}
