import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { Activity, UseCase, StrategicGoal, Department } from "@/lib/db/schema";

const reportSchema = z.object({
  executiveSummary: z.string(),
  valueThesisSummary: z.string(),
  topAutomate: z.array(
    z.object({ title: z.string(), description: z.string(), impact: z.string() })
  ),
  topDifferentiate: z.array(
    z.object({ title: z.string(), description: z.string(), impact: z.string() })
  ),
  topInnovate: z.array(
    z.object({ title: z.string(), description: z.string(), impact: z.string() })
  ),
  operatingModelImplications: z.array(z.string()),
  governanceBlockers: z.array(z.string()),
  sequencingRecommendation: z.string(),
  kpiBaseline: z.array(
    z.object({ metric: z.string(), current: z.string(), target: z.string(), timeframe: z.string() })
  ),
});

export type ReportContent = z.infer<typeof reportSchema>;

export async function generateReport(data: {
  companyValueThesis: unknown;
  departments: Department[];
  activities: Activity[];
  useCases: UseCase[];
  goals: StrategicGoal[];
}): Promise<ReportContent> {
  const { object } = await generateObject({
    model: anthropic("claude-sonnet-4-20250514"),
    schema: reportSchema,
    prompt: `Genera un report esecutivo completo per la trasformazione AI di questa organizzazione. Scrivi in italiano, professionale e orientato all'azione.

## Value Thesis
${JSON.stringify(data.companyValueThesis ?? {}, null, 2)}

## Dipartimenti mappati (${data.departments.length})
${data.departments.map((d) => `- ${d.name} (${d.mappingStatus}): ${d.description ?? ""}`).join("\n")}

## Attività mappate (${data.activities.length})
${data.activities
  .map(
    (a) =>
      `- "${a.title}" [${a.workType ?? "N/A"}] [${a.classification ?? "N/A"}] - ${a.description ?? ""}`
  )
  .join("\n")}

## Use Cases generati (${data.useCases.length})
${data.useCases
  .map(
    (uc) =>
      `- "${uc.title}" [${uc.category}] Score: ${uc.overallScore?.toFixed(1)} - ${uc.description}`
  )
  .join("\n")}

## Obiettivi Strategici
${data.goals.map((g) => `- [${g.type}] "${g.title}" → ${g.direction ?? "N/A"}`).join("\n")}

## Output richiesti

1. **Executive Summary**: 3-5 paragrafi che sintetizzano findings, opportunità e raccomandazioni
2. **Value Thesis Summary**: sintesi di dove si concentra il valore
3. **Top 3 Automate**: stream principali da automatizzare
4. **Top 3 Differentiate**: domini dove concentrare energia umana
5. **Top 3 Innovate**: nuove opportunità possibili con AI
6. **Operating Model Implications**: cosa cambia in ruoli, ownership, governance
7. **Governance Blockers**: impedimenti da risolvere
8. **Sequencing Recommendation**: priorità e ordine di esecuzione
9. **KPI Baseline**: metriche chiave con valori attuali e target`,
  });

  return object;
}
