import { z } from "zod";

export const companyValueThesisSchema = z.object({
  coreValueProposition: z
    .string()
    .describe("Dove l'azienda ritiene di creare valore principale"),
  strategicNodes: z
    .array(z.string())
    .describe("Nodi strategici che differenziano l'azienda"),
  commodityNodes: z
    .array(z.string())
    .describe("Nodi che sono commodity o possono diventarlo"),
  marginDrivers: z
    .array(z.string())
    .describe("Principali motori di margine"),
  keyRisks: z
    .array(z.string())
    .describe("Rischi chiave per il modello di business"),
  aiReadiness: z
    .string()
    .describe("Livello attuale di maturità AI dell'organizzazione"),
});

export const systemBoundarySchema = z.object({
  includedFunctions: z
    .array(z.string())
    .describe("Funzioni/aree incluse nell'analisi"),
  excludedFunctions: z
    .array(z.string())
    .describe("Funzioni/aree escluse dall'analisi"),
  rationale: z.string().describe("Motivazione per i confini scelti"),
  timeHorizon: z.string().describe("Orizzonte temporale dell'analisi"),
});

export const activitySchema = z.object({
  title: z.string().describe("Nome dell'attività"),
  description: z.string().describe("Descrizione dettagliata"),
  frequency: z
    .string()
    .optional()
    .describe("Frequenza (giornaliera, settimanale, mensile...)"),
  timeSpentHoursWeek: z
    .number()
    .optional()
    .describe("Ore settimanali stimate"),
  toolsUsed: z
    .array(z.string())
    .optional()
    .describe("Strumenti utilizzati"),
  inputDescription: z
    .string()
    .optional()
    .describe("Cosa riceve in input"),
  outputDescription: z
    .string()
    .optional()
    .describe("Cosa produce in output"),
  decisionPoints: z
    .string()
    .optional()
    .describe("Punti in cui serve giudizio umano"),
  painPoints: z
    .string()
    .optional()
    .describe("Dolori e frizioni del workflow"),
  workType: z
    .enum(["enrichment", "detection", "interpretation", "delivery"])
    .optional()
    .describe("Tipo di lavoro secondo il framework Unbundle"),
});

export const classificationResultSchema = z.object({
  classification: z.enum(["automate", "differentiate", "innovate"]),
  confidenceScore: z
    .number()
    .min(0)
    .max(1)
    .describe("Score di confidenza 0-1"),
  reasoning: z.string().describe("Motivazione della classificazione"),
  aiPotential: z
    .string()
    .describe("Come l'AI può intervenire su questa attività"),
});

export const useCaseSchema = z.object({
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
});
