import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { activities, activityDependencies, departments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getActivitiesByDepartment } from "@/lib/db/queries/activities";
import { getWorkspaceById, getStrategicGoalsByWorkspace } from "@/lib/db/queries/workspaces";
import { organizations } from "@/lib/db/schema";
import { classifyActivitiesBatch } from "@/lib/ai/classify";
import { matchActivitiesToOnet } from "@/lib/ai/onet-matching";
import { updateActivityClassification, updateActivity } from "@/lib/db/queries/activities";

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
        "Segna il dipartimento come completamente mappato. Usare quando ritieni di aver raccolto tutte le attività principali. Questo trigger automaticamente la classificazione 3 stream e il match O*NET.",
      inputSchema: z.object({
        summary: z.string().describe("Breve riepilogo del mapping"),
      }),
      execute: async ({ summary }) => {
        await db
          .update(departments)
          .set({ mappingStatus: "mapped" })
          .where(eq(departments.id, departmentId));

        const deptActivities = await getActivitiesByDepartment(departmentId);
        const unclassified = deptActivities.filter((a) => !a.classification);

        let classificationSummary = "";
        let onetSummary = "";

        if (unclassified.length > 0) {
          try {
            const workspace = await getWorkspaceById(workspaceId);
            const [org] = workspace
              ? await db
                  .select()
                  .from(organizations)
                  .where(eq(organizations.id, workspace.organizationId))
                  .limit(1)
              : [null];

            const goals = await getStrategicGoalsByWorkspace(workspaceId);

            const results = await classifyActivitiesBatch(unclassified, {
              companyValueThesis: org?.companyValueThesis,
              goals,
            });

            for (const [activityId, result] of results) {
              await updateActivityClassification(
                activityId,
                result.classification,
                result.confidenceScore
              );
            }

            const counts = { automate: 0, differentiate: 0, innovate: 0 };
            for (const [, result] of results) {
              counts[result.classification]++;
            }
            classificationSummary = `Classificazione completata: ${counts.automate} Automate, ${counts.differentiate} Differentiate, ${counts.innovate} Innovate.`;
          } catch (err) {
            classificationSummary =
              "Classificazione non riuscita — verrà riprovata manualmente.";
          }
        }

        const unmatched = deptActivities.filter((a) => !a.onetTaskId);
        if (unmatched.length > 0) {
          try {
            const matches = await matchActivitiesToOnet(unmatched);
            for (const match of matches) {
              await updateActivity(match.activityId, {
                onetTaskId: match.suggestedOnetCode,
                aiExposureScore: match.aiExposureEstimate,
              });
            }
            const avgExposure =
              matches.length > 0
                ? (
                    matches.reduce((s, m) => s + m.aiExposureEstimate, 0) /
                    matches.length
                  ).toFixed(0)
                : "0";
            onetSummary = `Match O*NET completato su ${matches.length} attività. AI Exposure media: ${avgExposure}%.`;
          } catch (err) {
            onetSummary =
              "Match O*NET non riuscito — verrà riprovato manualmente.";
          }
        }

        return {
          success: true,
          message: [
            `Dipartimento segnato come mappato.`,
            summary,
            classificationSummary,
            onetSummary,
          ]
            .filter(Boolean)
            .join(" "),
        };
      },
    }),
  };
}
