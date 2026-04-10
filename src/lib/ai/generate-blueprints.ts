import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { UseCase, Activity } from "@/lib/db/schema";

const blueprintSchema = z.object({
  blueprints: z.array(
    z.object({
      useCaseId: z.string(),
      agentName: z.string(),
      agentDescription: z.string(),
      inputs: z.array(z.object({ name: z.string(), type: z.string(), source: z.string() })),
      outputs: z.array(z.object({ name: z.string(), type: z.string(), destination: z.string() })),
      tools: z.array(z.object({ name: z.string(), description: z.string(), type: z.enum(["api", "database", "llm", "file", "custom"]) })),
      llmRequirements: z.object({
        modelType: z.string(),
        capabilities: z.array(z.string()),
        estimatedCostPerRun: z.string(),
      }),
      dataSources: z.array(z.string()),
      guardrails: z.array(z.string()),
      implementationSteps: z.array(z.string()),
      estimatedEffort: z.string(),
      risksMitigations: z.array(z.object({ risk: z.string(), mitigation: z.string() })),
    })
  ),
});

export type AgentBlueprint = z.infer<typeof blueprintSchema>["blueprints"][0];

export async function generateAgentBlueprints(
  useCases: UseCase[],
  activities: Activity[]
) {
  const automatableUseCases = useCases.filter(
    (uc) =>
      uc.category === "quick_win" || uc.category === "strategic_bet"
  );

  if (automatableUseCases.length === 0) return [];

  const { object } = await generateObject({
    model: anthropic("claude-sonnet-4-20250514"),
    schema: blueprintSchema,
    prompt: `Sei un AI architect esperto. Per ogni use case, genera un blueprint dettagliato dell'agente AI necessario per implementarlo.

## Use Cases
${automatableUseCases
  .map(
    (uc) =>
      `[${uc.id}] "${uc.title}" (${uc.category}): ${uc.description}\nBusiness case: ${uc.businessCase}\nRequisiti: ${(uc.requirements as string[])?.join(", ")}`
  )
  .join("\n\n")}

## Attività correlate
${activities
  .map(
    (a) =>
      `[${a.id}] "${a.title}": tools=${a.toolsUsed?.join(",") ?? "N/A"}, input=${a.inputDescription ?? "N/A"}, output=${a.outputDescription ?? "N/A"}`
  )
  .join("\n")}

Per ogni blueprint specifica:
1. Nome e descrizione dell'agente
2. Input e output con tipi e fonti/destinazioni
3. Tools necessari (API, database, LLM, file, custom)
4. Requisiti LLM (tipo modello, capabilities, costo stimato)
5. Data sources necessarie
6. Guardrails (limiti, controlli, validazioni)
7. Step di implementazione concreti
8. Sforzo stimato (giorni/settimane)
9. Rischi e mitigazioni

Scrivi in italiano.`,
  });

  return object.blueprints;
}
