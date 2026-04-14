import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  organizations,
  workspaces,
  departments,
  strategicGoals,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { companyValueThesisSchema, systemBoundarySchema } from "../schemas";

export function getLeadershipTools(workspaceId: string, organizationId: string) {
  return {
    saveCompanyValueThesis: tool({
      description:
        "Salva la Company Value Thesis dell'organizzazione. Usare quando hai raccolto abbastanza informazioni per formulare dove l'azienda crea valore e quali nodi sono strategici.",
      inputSchema: companyValueThesisSchema,
      execute: async (thesis) => {
        await db
          .update(organizations)
          .set({
            companyValueThesis: thesis,
            updatedAt: new Date(),
          })
          .where(eq(organizations.id, organizationId));
        return {
          success: true,
          message: "Company Value Thesis salvata con successo.",
        };
      },
    }),

    saveSystemBoundary: tool({
      description:
        "Salva i confini del sistema di analisi (cosa includere e cosa escludere). Usare quando avete concordato cosa analizzare.",
      inputSchema: systemBoundarySchema,
      execute: async (boundary) => {
        await db
          .update(workspaces)
          .set({
            systemBoundary: boundary,
            updatedAt: new Date(),
          })
          .where(eq(workspaces.id, workspaceId));
        return {
          success: true,
          message: "System Boundary salvato con successo.",
        };
      },
    }),

    saveUnitTerminology: tool({
      description:
        "Salva come l'organizzazione chiama le proprie unità organizzative (es. funzioni, aree, divisioni, stream, dipartimenti). Usare nella fase 4 dopo aver chiesto all'utente.",
      inputSchema: z.object({
        singular: z
          .string()
          .describe(
            "Termine singolare scelto dall'utente (es. funzione, area, divisione, stream, dipartimento)"
          ),
        plural: z
          .string()
          .describe(
            "Termine plurale corrispondente (es. funzioni, aree, divisioni, stream, dipartimenti)"
          ),
      }),
      execute: async ({ singular, plural }) => {
        await db
          .update(workspaces)
          .set({
            unitTerminology: { singular, plural },
            updatedAt: new Date(),
          })
          .where(eq(workspaces.id, workspaceId));
        return {
          success: true,
          message: `Terminologia salvata: "${singular}" / "${plural}". Da ora userò sempre questi termini.`,
        };
      },
    }),

    createDepartment: tool({
      description:
        "Crea un'unità organizzativa da mappare. Usare per ogni unità che emerge come prioritaria per l'analisi.",
      inputSchema: z.object({
        name: z.string().describe("Nome dell'unità organizzativa"),
        description: z
          .string()
          .optional()
          .describe("Descrizione dell'unità e del suo ruolo"),
        headName: z
          .string()
          .optional()
          .describe("Nome del responsabile"),
        teamSize: z
          .number()
          .optional()
          .describe("Dimensione approssimativa del team"),
      }),
      execute: async ({ name, description, headName, teamSize }) => {
        const [dept] = await db
          .insert(departments)
          .values({
            workspaceId,
            name,
            description,
            headName,
            teamSize,
          })
          .returning();
        return {
          success: true,
          departmentId: dept.id,
          message: `"${name}" creata con successo.`,
        };
      },
    }),

    saveStrategicGoal: tool({
      description:
        "Salva un obiettivo strategico, OKR o KPI che emerge dalla conversazione. Usare quando la leadership menziona obiettivi specifici.",
      inputSchema: z.object({
        type: z
          .enum(["goal", "objective", "key_result"])
          .describe("Tipo: goal (alto livello), objective, key_result"),
        title: z.string().describe("Titolo dell'obiettivo"),
        description: z
          .string()
          .optional()
          .describe("Descrizione dettagliata"),
        direction: z
          .enum(["increase", "decrease", "maintain"])
          .optional()
          .describe("Direzione desiderata"),
        targetValue: z.number().optional().describe("Valore target"),
        currentValue: z.number().optional().describe("Valore attuale"),
        owner: z.string().optional().describe("Owner dell'obiettivo"),
        timeframe: z.string().optional().describe("Orizzonte temporale"),
        kpiName: z.string().optional().describe("Nome del KPI associato"),
        kpiUnit: z.string().optional().describe("Unità di misura del KPI"),
      }),
      execute: async (goalData) => {
        const [goal] = await db
          .insert(strategicGoals)
          .values({
            workspaceId,
            ...goalData,
          })
          .returning();
        return {
          success: true,
          goalId: goal.id,
          message: `Obiettivo "${goalData.title}" salvato con successo.`,
        };
      },
    }),
  };
}
