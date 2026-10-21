import type { UseCase } from "@/lib/db/schema";
import { PORTFOLIO_SCORE_COLUMNS, sanitizeCustomScores } from "./client-items.ts";

/**
 * Righe di `use_cases` che lasciano il server fuori da «Raccolta & ranking»: props dei
 * componenti client di /use-cases e /plan, risposte delle API REST
 * `/api/workspaces/[workspaceId]/use-cases/…` e delle server action di stato e quadrante.
 *
 * Come in `client-items.ts`, ogni forma si costruisce campo per campo da un'allowlist, mai con
 * uno spread della riga: chi propone (`proposedBy`, `submittedByUserId`), chi ha valutato
 * (`reviewedBy`) e l'intake del connettore (`submitterEmail`, `submittedBy`,
 * `sourceConversation`, `promptSnippet`…) non arrivano al browser di un collega (art. 15.4).
 * Il brand di tipo impedisce di passare una riga intera dove serve una proiezione.
 */

declare const useCaseRowBrand: unique symbol;

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function score(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function strings(value: unknown): string[] | null {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : null;
}

/** Ciò che `UseCaseMatrix` legge: titolo, quadrante e i due assi. */
export const USE_CASE_MATRIX_POINT_KEYS = [
  "id",
  "title",
  "category",
  "overallImpactScore",
  "overallFeasibilityScore",
] as const;

type MatrixKey = (typeof USE_CASE_MATRIX_POINT_KEYS)[number];

export type UseCaseMatrixPoint = Pick<UseCase, MatrixKey> & {
  readonly [useCaseRowBrand]: "matrix";
};

export function toUseCaseMatrixPoint(row: Pick<UseCase, MatrixKey>): UseCaseMatrixPoint {
  const point: Pick<UseCase, MatrixKey> = {
    id: String(row.id),
    title: text(row.title) ?? "",
    category: row.category ?? null,
    overallImpactScore: score(row.overallImpactScore),
    overallFeasibilityScore: score(row.overallFeasibilityScore),
  };
  return point as UseCaseMatrixPoint;
}

export function toUseCaseMatrixPoints(rows: readonly Pick<UseCase, MatrixKey>[]): UseCaseMatrixPoint[] {
  return rows.map(toUseCaseMatrixPoint);
}

/** Ciò che `GanttChart` legge: titolo, quadrante, punteggio complessivo e ordine. */
export const GANTT_USE_CASE_KEYS = ["id", "title", "category", "overallScore", "sequenceOrder"] as const;

type GanttKey = (typeof GANTT_USE_CASE_KEYS)[number];

export type GanttUseCase = Pick<UseCase, GanttKey> & {
  readonly [useCaseRowBrand]: "gantt";
};

export function toGanttUseCase(row: Pick<UseCase, GanttKey>): GanttUseCase {
  const item: Pick<UseCase, GanttKey> = {
    id: String(row.id),
    title: text(row.title) ?? "",
    category: row.category ?? null,
    overallScore: score(row.overallScore),
    sequenceOrder: score(row.sequenceOrder),
  };
  return item as GanttUseCase;
}

export function toGanttUseCases(rows: readonly Pick<UseCase, GanttKey>[]): GanttUseCase[] {
  return rows.map(toGanttUseCase);
}

/**
 * Risposta di `setUseCaseStatusAction` e `setUseCaseWaveCategoryAction`: l'unico chiamante
 * (`UseCasePortfolioActions`) non la legge e ricarica la pagina, quindi bastano stato e quadrante.
 */
export const USE_CASE_LIFECYCLE_KEYS = ["id", "status", "category"] as const;

type LifecycleKey = (typeof USE_CASE_LIFECYCLE_KEYS)[number];

export type UseCaseLifecycleState = Pick<UseCase, LifecycleKey> & {
  readonly [useCaseRowBrand]: "lifecycle";
};

export function toUseCaseLifecycleState(row: Pick<UseCase, LifecycleKey>): UseCaseLifecycleState {
  const state: Pick<UseCase, LifecycleKey> = {
    id: String(row.id),
    status: row.status,
    category: row.category ?? null,
  };
  return state as UseCaseLifecycleState;
}

/**
 * Il suggerimento dell'AI ricostruito: punteggi (come `customScores`), motivazione, modello,
 * istante e tipo. La copia della v1 (`v1Backup`) e ogni altra chiave restano sul server.
 */
function aiSuggestionOf(value: UseCase["aiSuggestion"]): UseCase["aiSuggestion"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: NonNullable<UseCase["aiSuggestion"]> = {};
  const scores = sanitizeCustomScores(value.scores);
  if (scores) out.scores = scores;
  if (typeof value.rationale === "string" || value.rationale === null) out.rationale = value.rationale;
  if (typeof value.model === "string" || value.model === null) out.model = value.model;
  if (typeof value.at === "string") out.at = value.at;
  if (value.kind === "auto" || value.kind === "suggerimento" || value.kind === "ricalibrazione") out.kind = value.kind;
  return out;
}

/**
 * Colonne che le API REST degli use case non restituiscono mai: chi propone, chi ha valutato
 * e l'intake del connettore (intero, qualunque chiave contenga).
 */
export const USE_CASE_API_EXCLUDED_KEYS = ["proposedBy", "submittedByUserId", "reviewedBy", "intake"] as const;

/**
 * Risposta di GET `…/use-cases` e `…/use-cases/[useCaseId]` e dei PATCH `…/status`, `…/scores`,
 * `…/wave` (solo per chi valuta): la riga di prima senza le colonne escluse. Una colonna nuova
 * non parte finché non la si aggiunge qui.
 */
export const USE_CASE_API_KEYS = [
  "id",
  "workspaceId",
  "title",
  "description",
  "businessCase",
  "portfolioKind",
  "category",
  "status",
  "source",
  "impactFlag",
  "portfolioReviewStatus",
  "submittedAt",
  "reviewedAt",
  "reviewNotes",
  "flowDescription",
  "humanInTheLoop",
  "guardrails",
  "dataRequirements",
  "sustainabilityImpact",
  ...PORTFOLIO_SCORE_COLUMNS,
  "customScores",
  "overallEsgScore",
  "overallImpactScore",
  "overallFeasibilityScore",
  "overallScore",
  "sequenceOrder",
  "timeline",
  "requirements",
  "dataDependencies",
  "relatedActivityIds",
  "code",
  "publicNote",
  "statusChangedAt",
  // Colonne dell'area «Use case» (drizzle/0020): dati della valutazione, mai di chi propone.
  "origin",
  "aiLab",
  "targetQuarter",
  "reviewBy",
  "valueEurYear",
  "costEurOnce",
  "costBand",
  "aiSuggestion",
  "version",
  "createdAt",
  "updatedAt",
] as const;

type ApiKey = (typeof USE_CASE_API_KEYS)[number];

export type UseCaseApiRow = Pick<UseCase, ApiKey> & {
  readonly proposedBy?: undefined;
  readonly submittedByUserId?: undefined;
  readonly reviewedBy?: undefined;
  readonly intake?: undefined;
  readonly [useCaseRowBrand]: "api";
};

export function toUseCaseApiRow(row: Pick<UseCase, ApiKey>): UseCaseApiRow {
  const fields: Pick<UseCase, ApiKey> = {
    id: String(row.id),
    workspaceId: String(row.workspaceId),
    title: text(row.title) ?? "",
    description: text(row.description),
    businessCase: text(row.businessCase),
    portfolioKind: text(row.portfolioKind),
    category: row.category ?? null,
    status: row.status,
    source: text(row.source),
    impactFlag: typeof row.impactFlag === "boolean" ? row.impactFlag : null,
    portfolioReviewStatus: row.portfolioReviewStatus,
    submittedAt: row.submittedAt ?? null,
    reviewedAt: row.reviewedAt ?? null,
    reviewNotes: text(row.reviewNotes),
    flowDescription: text(row.flowDescription),
    humanInTheLoop: text(row.humanInTheLoop),
    guardrails: text(row.guardrails),
    dataRequirements: text(row.dataRequirements),
    sustainabilityImpact: text(row.sustainabilityImpact),
    impactEconomic: score(row.impactEconomic),
    impactTime: score(row.impactTime),
    impactQuality: score(row.impactQuality),
    impactCoordination: score(row.impactCoordination),
    impactSocial: score(row.impactSocial),
    feasibilityData: score(row.feasibilityData),
    feasibilityWorkflow: score(row.feasibilityWorkflow),
    feasibilityRisk: score(row.feasibilityRisk),
    feasibilityTech: score(row.feasibilityTech),
    feasibilityTeam: score(row.feasibilityTeam),
    esgEnvironmental: score(row.esgEnvironmental),
    esgSocial: score(row.esgSocial),
    esgGovernance: score(row.esgGovernance),
    customScores: sanitizeCustomScores(row.customScores),
    overallEsgScore: score(row.overallEsgScore),
    overallImpactScore: score(row.overallImpactScore),
    overallFeasibilityScore: score(row.overallFeasibilityScore),
    overallScore: score(row.overallScore),
    sequenceOrder: score(row.sequenceOrder),
    timeline: text(row.timeline),
    requirements: strings(row.requirements),
    dataDependencies: strings(row.dataDependencies),
    relatedActivityIds: strings(row.relatedActivityIds),
    code: text(row.code),
    publicNote: text(row.publicNote),
    statusChangedAt: row.statusChangedAt ?? null,
    origin: row.origin,
    aiLab: text(row.aiLab),
    targetQuarter: text(row.targetQuarter),
    reviewBy: text(row.reviewBy),
    valueEurYear: score(row.valueEurYear),
    costEurOnce: score(row.costEurOnce),
    costBand: score(row.costBand),
    aiSuggestion: aiSuggestionOf(row.aiSuggestion),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  return fields as UseCaseApiRow;
}

export function toUseCaseApiRows(rows: readonly Pick<UseCase, ApiKey>[]): UseCaseApiRow[] {
  return rows.map(toUseCaseApiRow);
}
