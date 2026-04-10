import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { UseCase, Activity, Department } from "@/lib/db/schema";

const simulationSchema = z.object({
  scenarios: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      useCasesImplemented: z.array(z.string()),
      impacts: z.object({
        fteReduction: z.number(),
        fteReallocation: z.number(),
        newRolesCreated: z.array(z.string()),
        rolesTransformed: z.array(z.object({ role: z.string(), from: z.string(), to: z.string() })),
        estimatedCostSaving: z.string(),
        estimatedRevenueImpact: z.string(),
        timeToValue: z.string(),
      }),
      orgChanges: z.array(z.string()),
      aiOsBuilding: z.array(
        z.object({
          block: z.string(),
          description: z.string(),
          buildVsBuy: z.enum(["build", "buy", "hybrid"]),
          estimatedCost: z.string(),
          priority: z.enum(["must_have", "should_have", "nice_to_have"]),
        })
      ),
      risks: z.array(z.string()),
    })
  ),
  aiOsSummary: z.object({
    knowledgeBase: z.object({ needed: z.boolean(), recommendation: z.string() }),
    agentOrchestration: z.object({ needed: z.boolean(), recommendation: z.string() }),
    dataPipelines: z.object({ needed: z.boolean(), recommendation: z.string() }),
    monitoring: z.object({ needed: z.boolean(), recommendation: z.string() }),
    governance: z.object({ needed: z.boolean(), recommendation: z.string() }),
  }),
});

export type SimulationResult = z.infer<typeof simulationSchema>;

export async function generateSimulation(data: {
  useCases: UseCase[];
  activities: Activity[];
  departments: Department[];
  companyValueThesis: unknown;
}): Promise<SimulationResult> {
  const { object } = await generateObject({
    model: anthropic("claude-sonnet-4-20250514"),
    schema: simulationSchema,
    prompt: `Sei un consulente di trasformazione AI. Genera scenari "what if" per l'organizzazione.

## Value Thesis
${JSON.stringify(data.companyValueThesis ?? {}, null, 2)}

## Dipartimenti (${data.departments.length})
${data.departments.map((d) => `- ${d.name}: ${d.teamSize ?? "?"} persone`).join("\n")}

## Attività (${data.activities.length})
${data.activities.map((a) => `- "${a.title}" [${a.classification}] - ${a.timeSpentHoursWeek ?? "?"}h/sett`).join("\n")}

## Use Cases (${data.useCases.length})
${data.useCases.map((uc) => `- "${uc.title}" [${uc.category}] Score: ${uc.overallScore?.toFixed(1)}`).join("\n")}

Genera 3 scenari:
1. **Conservativo**: solo Quick Wins implementati nei prossimi 3 mesi
2. **Moderato**: Quick Wins + Capability Builders nei prossimi 6 mesi
3. **Aggressivo**: tutti i use case implementati in 12 mesi

Per ogni scenario calcola:
- Impatto su FTE (riduzione, riallocazione, nuovi ruoli)
- Saving stimato e impatto revenue
- Cambiamenti organizzativi necessari
- Building blocks AI OS necessari con raccomandazione build vs buy
- Rischi

Genera anche un sommario AI OS con raccomandazioni per knowledge base, agent orchestration, data pipelines, monitoring e governance.

Scrivi in italiano. Sii specifico e concreto con numeri realistici.`,
  });

  return object;
}
