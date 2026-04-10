import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { activities, activityDependencies, departments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export function getActivityMappingTools(
  workspaceId: string,
  departmentId: string
) {
  return {
    saveActivity: tool({
      description:
        "Salva una nuova attività lavorativa emersa dall'intervista. Usare ogni volta che hai raccolto abbastanza dettagli su un'attività (servono almeno titolo, descrizione e qualche dettaglio).",
      inputSchema: z.object({
        title: z.string().describe("Nome dell'attività"),
        description: z.string().describe("Descrizione dettagliata dell'attività"),
        frequency: z.string().optional().describe("Frequenza: giornaliera, settimanale, mensile, ad_hoc"),
        timeSpentHoursWeek: z.number().optional().describe("Ore settimanali stimate"),
        toolsUsed: z.array(z.string()).optional().describe("Strumenti utilizzati"),
        inputDescription: z.string().optional().describe("Cosa riceve in input"),
        outputDescription: z.string().optional().describe("Cosa produce in output"),
        decisionPoints: z.string().optional().describe("Dove serve giudizio umano"),
        painPoints: z.string().optional().describe("Frizioni e dolori del workflow"),
        dataRequired: z.string().optional().describe("Dati necessari e dove si trovano"),
        qualityPerceived: z.string().optional().describe("Qualità percepita del processo"),
        workType: z.enum(["enrichment", "detection", "interpretation", "delivery"]).optional().describe("Tipo di lavoro"),
      }),
      execute: async (data) => {
        const [activity] = await db
          .insert(activities)
          .values({
            departmentId,
            workspaceId,
            title: data.title,
            description: data.description,
            frequency: data.frequency,
            timeSpentHoursWeek: data.timeSpentHoursWeek,
            toolsUsed: data.toolsUsed,
            inputDescription: data.inputDescription,
            outputDescription: data.outputDescription,
            decisionPoints: data.decisionPoints,
            painPoints: data.painPoints,
            dataRequired: data.dataRequired,
            qualityPerceived: data.qualityPerceived,
            workType: data.workType,
          })
          .returning();

        return {
          success: true,
          activityId: activity.id,
          message: `Attivita' "${data.title}" salvata con successo.`,
        };
      },
    }),

    updateActivityClassification: tool({
      description:
        "Classifica un'attività per tipo di lavoro (work type). Usare quando si ha chiaro il tipo.",
      inputSchema: z.object({
        activityId: z.string().describe("ID dell'attività da classificare"),
        workType: z.enum(["enrichment", "detection", "interpretation", "delivery"]).describe("Tipo di lavoro"),
      }),
      execute: async ({ activityId, workType }) => {
        await db
          .update(activities)
          .set({ workType, updatedAt: new Date() })
          .where(eq(activities.id, activityId));
        return {
          success: true,
          message: `Attivita' classificata come "${workType}".`,
        };
      },
    }),

    linkActivityDependency: tool({
      description:
        "Collega una dipendenza tra due attività. Usare quando emerge che un'attività dipende da un'altra.",
      inputSchema: z.object({
        sourceActivityId: z.string().describe("ID dell'attività che dipende"),
        targetActivityId: z.string().describe("ID dell'attività da cui dipende"),
        dependencyType: z.string().optional().describe("Tipo di dipendenza (input, approval, data, handoff)"),
      }),
      execute: async ({ sourceActivityId, targetActivityId, dependencyType }) => {
        await db.insert(activityDependencies).values({
          sourceActivityId,
          targetActivityId,
          dependencyType,
        });
        return {
          success: true,
          message: "Dipendenza collegata con successo.",
        };
      },
    }),

    markDepartmentMapped: tool({
      description:
        "Segna il dipartimento come completamente mappato. Usare quando ritieni di aver raccolto tutte le attività principali.",
      inputSchema: z.object({
        summary: z.string().describe("Breve riepilogo del mapping"),
      }),
      execute: async ({ summary }) => {
        await db
          .update(departments)
          .set({ mappingStatus: "mapped" })
          .where(eq(departments.id, departmentId));
        return {
          success: true,
          message: `Dipartimento segnato come mappato. Riepilogo: ${summary}`,
        };
      },
    }),
  };
}
