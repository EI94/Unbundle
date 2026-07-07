import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "..";
import {
  aiReadinessAssessmentTemplates,
  aiReadinessAssessments,
  aiReadinessAuditEvents,
  aiReadinessExports,
  aiReadinessInsights,
  aiReadinessRespondents,
  aiReadinessResponses,
  aiReadinessScores,
  aiReadinessUseCaseSubmissions,
  type AiReadinessAssessment,
  type AiReadinessAssessmentTemplate,
  type AiReadinessInsight,
  type AiReadinessRespondent,
  type AiReadinessResponse,
  type NewAiReadinessAssessment,
  type NewAiReadinessAssessmentTemplate,
  type NewAiReadinessAuditEvent,
  type NewAiReadinessInsight,
  type NewAiReadinessRespondent,
  type NewAiReadinessResponse,
  type NewAiReadinessUseCaseSubmission,
} from "../schema";
import { ensureDbSchema } from "../ensure-schema";
import {
  AI_READINESS_SYSTEM_TEMPLATE,
  AI_READINESS_SYSTEM_TEMPLATE_VERSION,
} from "@/lib/ai-readiness/default-template";
import type {
  AiReadinessDashboard,
  AiReadinessDerivedScores,
  AiReadinessTemplateDefinition,
} from "@/lib/ai-readiness/types";
import { aggregateScores } from "@/lib/ai-readiness/scoring";
import {
  applyTemplateOverrides,
  filterTemplateDefinition,
  includedPillarsFromScoringConfig,
  templateOverridesFromScoringConfig,
  type AiReadinessTemplateOverrides,
} from "@/lib/ai-readiness/template-scope";

export type AiReadinessAssessmentBundle = {
  assessment: AiReadinessAssessment;
  template: AiReadinessAssessmentTemplate;
  templateDefinition: AiReadinessTemplateDefinition;
};

export function templateDefinitionFromRow(
  row: AiReadinessAssessmentTemplate
): AiReadinessTemplateDefinition {
  return {
    pillars: row.pillars as AiReadinessTemplateDefinition["pillars"],
    sections: row.sections as AiReadinessTemplateDefinition["sections"],
    questions: row.questions as AiReadinessTemplateDefinition["questions"],
    scoringSchema:
      row.scoringSchema as AiReadinessTemplateDefinition["scoringSchema"],
  };
}

/** Template ristretto ai pilastri selezionati per lo specifico assessment. */
function templateDefinitionForAssessment(
  assessment: AiReadinessAssessment,
  templateRow: AiReadinessAssessmentTemplate
): AiReadinessTemplateDefinition {
  return applyTemplateOverrides(
    filterTemplateDefinition(
      templateDefinitionFromRow(templateRow),
      includedPillarsFromScoringConfig(assessment.scoringConfig)
    ),
    templateOverridesFromScoringConfig(assessment.scoringConfig)
  );
}

/** Salva gli override domande dell'assessment (merge su scoringConfig). */
export async function setAssessmentTemplateOverrides(
  assessmentId: string,
  overrides: AiReadinessTemplateOverrides
) {
  await ensureDbSchema();
  const bundle = await getAssessmentBundleById(assessmentId);
  if (!bundle) return null;
  return updateAiReadinessAssessment(assessmentId, {
    scoringConfig: {
      ...(bundle.assessment.scoringConfig ?? {}),
      templateOverrides: overrides,
    },
  });
}

export async function ensureAiReadinessSystemTemplate() {
  await ensureDbSchema();
  const [existing] = await db
    .select()
    .from(aiReadinessAssessmentTemplates)
    .where(
      and(
        eq(aiReadinessAssessmentTemplates.name, "AI Readiness Core"),
        eq(aiReadinessAssessmentTemplates.version, AI_READINESS_SYSTEM_TEMPLATE_VERSION),
        eq(aiReadinessAssessmentTemplates.language, "it")
      )
    )
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(aiReadinessAssessmentTemplates)
    .values({
      name: "AI Readiness Core",
      description:
        "Template core Lateral Space per Technology, Context, Workflow, Adoption e Use Cases.",
      version: AI_READINESS_SYSTEM_TEMPLATE_VERSION,
      language: "it",
      isSystemTemplate: true,
      status: "active",
      pillars: AI_READINESS_SYSTEM_TEMPLATE.pillars,
      sections: AI_READINESS_SYSTEM_TEMPLATE.sections,
      questions: AI_READINESS_SYSTEM_TEMPLATE.questions,
      scoringSchema: AI_READINESS_SYSTEM_TEMPLATE.scoringSchema,
    } satisfies NewAiReadinessAssessmentTemplate)
    .returning();
  return created;
}

export async function listAssessmentsByWorkspace(workspaceId: string) {
  await ensureDbSchema();
  return db
    .select({
      assessment: aiReadinessAssessments,
      template: aiReadinessAssessmentTemplates,
    })
    .from(aiReadinessAssessments)
    .innerJoin(
      aiReadinessAssessmentTemplates,
      eq(aiReadinessAssessmentTemplates.id, aiReadinessAssessments.templateId)
    )
    .where(eq(aiReadinessAssessments.workspaceId, workspaceId))
    .orderBy(desc(aiReadinessAssessments.createdAt));
}

export async function getLatestAssessmentBundleByWorkspace(workspaceId: string) {
  const rows = await listAssessmentsByWorkspace(workspaceId);
  const first = rows[0];
  if (!first) return null;
  return {
    assessment: first.assessment,
    template: first.template,
    templateDefinition: templateDefinitionForAssessment(
      first.assessment,
      first.template
    ),
  };
}

export async function getAssessmentBundleById(assessmentId: string) {
  await ensureDbSchema();
  const [row] = await db
    .select({
      assessment: aiReadinessAssessments,
      template: aiReadinessAssessmentTemplates,
    })
    .from(aiReadinessAssessments)
    .innerJoin(
      aiReadinessAssessmentTemplates,
      eq(aiReadinessAssessmentTemplates.id, aiReadinessAssessments.templateId)
    )
    .where(eq(aiReadinessAssessments.id, assessmentId))
    .limit(1);
  if (!row) return null;
  return {
    assessment: row.assessment,
    template: row.template,
    templateDefinition: templateDefinitionForAssessment(
      row.assessment,
      row.template
    ),
  };
}

export async function createAiReadinessAssessment(
  data: NewAiReadinessAssessment
) {
  await ensureDbSchema();
  const [created] = await db.insert(aiReadinessAssessments).values(data).returning();
  return created;
}

export async function updateAiReadinessAssessment(
  assessmentId: string,
  patch: Partial<NewAiReadinessAssessment>
) {
  await ensureDbSchema();
  const [updated] = await db
    .update(aiReadinessAssessments)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(aiReadinessAssessments.id, assessmentId))
    .returning();
  return updated ?? null;
}


/** Link condivisibile: l'hash del token è salvato in scoringConfig (mai reso al client). */
export async function setAssessmentOpenLinkTokenHash(
  assessmentId: string,
  tokenHash: string
) {
  await ensureDbSchema();
  const bundle = await getAssessmentBundleById(assessmentId);
  if (!bundle) return null;
  const scoringConfig = {
    ...(bundle.assessment.scoringConfig ?? {}),
    openLinkTokenHash: tokenHash,
  };
  return updateAiReadinessAssessment(assessmentId, { scoringConfig });
}

export async function getAssessmentByOpenLinkTokenHash(tokenHash: string) {
  await ensureDbSchema();
  const [row] = await db
    .select({
      assessment: aiReadinessAssessments,
      template: aiReadinessAssessmentTemplates,
    })
    .from(aiReadinessAssessments)
    .innerJoin(
      aiReadinessAssessmentTemplates,
      eq(aiReadinessAssessmentTemplates.id, aiReadinessAssessments.templateId)
    )
    .where(
      sql`${aiReadinessAssessments.scoringConfig}->>'openLinkTokenHash' = ${tokenHash}`
    )
    .limit(1);
  if (!row) return null;
  return {
    assessment: row.assessment,
    template: row.template,
    templateDefinition: templateDefinitionForAssessment(row.assessment, row.template),
  };
}

export async function createAiReadinessRespondent(
  data: NewAiReadinessRespondent
) {
  await ensureDbSchema();
  const [created] = await db.insert(aiReadinessRespondents).values(data).returning();
  return created;
}

export async function listRespondentsByAssessment(assessmentId: string) {
  await ensureDbSchema();
  return db
    .select()
    .from(aiReadinessRespondents)
    .where(eq(aiReadinessRespondents.assessmentId, assessmentId))
    .orderBy(desc(aiReadinessRespondents.createdAt));
}

export async function getRespondentByInviteTokenHash(tokenHash: string) {
  await ensureDbSchema();
  const [row] = await db
    .select({
      respondent: aiReadinessRespondents,
      assessment: aiReadinessAssessments,
      template: aiReadinessAssessmentTemplates,
    })
    .from(aiReadinessRespondents)
    .innerJoin(
      aiReadinessAssessments,
      eq(aiReadinessAssessments.id, aiReadinessRespondents.assessmentId)
    )
    .innerJoin(
      aiReadinessAssessmentTemplates,
      eq(aiReadinessAssessmentTemplates.id, aiReadinessAssessments.templateId)
    )
    .where(eq(aiReadinessRespondents.inviteTokenHash, tokenHash))
    .limit(1);
  if (!row) return null;
  return {
    ...row,
    templateDefinition: templateDefinitionForAssessment(
      row.assessment,
      row.template
    ),
  };
}

export async function markRespondentOpened(respondent: AiReadinessRespondent) {
  if (respondent.inviteStatus !== "invited") {
    await db
      .update(aiReadinessRespondents)
      .set({ lastSeenAt: new Date(), updatedAt: new Date() })
      .where(eq(aiReadinessRespondents.id, respondent.id));
    return;
  }
  await db
    .update(aiReadinessRespondents)
    .set({
      inviteStatus: "opened",
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(aiReadinessRespondents.id, respondent.id));
}

export async function getResponseForRespondent(
  assessmentId: string,
  respondentId: string
) {
  await ensureDbSchema();
  const [row] = await db
    .select()
    .from(aiReadinessResponses)
    .where(
      and(
        eq(aiReadinessResponses.assessmentId, assessmentId),
        eq(aiReadinessResponses.respondentId, respondentId)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function updateAiReadinessRespondentIdentity(params: {
  respondentId: string;
  name: string;
  surname: string;
}) {
  await ensureDbSchema();
  const [updated] = await db
    .update(aiReadinessRespondents)
    .set({
      name: params.name,
      surname: params.surname,
      updatedAt: new Date(),
    })
    .where(eq(aiReadinessRespondents.id, params.respondentId))
    .returning();
  return updated ?? null;
}

export async function markRespondentStarted(respondentId: string) {
  const now = new Date();
  await db
    .update(aiReadinessRespondents)
    .set({
      inviteStatus: "started",
      startedAt: now,
      lastSeenAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(aiReadinessRespondents.id, respondentId),
        inArray(aiReadinessRespondents.inviteStatus, ["invited", "opened"])
      )
    );
}

export async function saveAiReadinessDraftResponse(params: {
  respondent: AiReadinessRespondent;
  answers: NewAiReadinessResponse["answers"];
  metadata: Record<string, unknown>;
}) {
  await ensureDbSchema();
  const existing = await getResponseForRespondent(
    params.respondent.assessmentId,
    params.respondent.id
  );
  const now = new Date();
  if (existing) {
    // Mai retrocedere una risposta già inviata (o cancellata per privacy) a bozza.
    if (existing.status !== "draft") return existing;
    const [updated] = await db
      .update(aiReadinessResponses)
      .set({
        answers: params.answers,
        metadata: params.metadata,
        updatedAt: now,
      })
      .where(eq(aiReadinessResponses.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(aiReadinessResponses)
    .values({
      assessmentId: params.respondent.assessmentId,
      respondentId: params.respondent.id,
      pseudonymousId: params.respondent.pseudonymousId,
      status: "draft",
      answers: params.answers,
      derivedScores: null,
      freeTextAnswers: {},
      metadata: params.metadata,
    })
    .returning();
  return created;
}

export async function upsertAiReadinessResponse(params: {
  respondent: AiReadinessRespondent;
  answers: NewAiReadinessResponse["answers"];
  derivedScores: AiReadinessDerivedScores;
  freeTextAnswers: Record<string, string>;
  metadata: Record<string, unknown>;
}) {
  await ensureDbSchema();
  const existing = await db
    .select()
    .from(aiReadinessResponses)
    .where(
      and(
        eq(aiReadinessResponses.assessmentId, params.respondent.assessmentId),
        eq(aiReadinessResponses.respondentId, params.respondent.id)
      )
    )
    .limit(1);

  const now = new Date();
  if (existing[0]) {
    const [updated] = await db
      .update(aiReadinessResponses)
      .set({
        status: "submitted",
        answers: params.answers,
        derivedScores: params.derivedScores,
        freeTextAnswers: params.freeTextAnswers,
        metadata: params.metadata,
        submittedAt: now,
        updatedAt: now,
      })
      .where(eq(aiReadinessResponses.id, existing[0].id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(aiReadinessResponses)
    .values({
      assessmentId: params.respondent.assessmentId,
      respondentId: params.respondent.id,
      pseudonymousId: params.respondent.pseudonymousId,
      status: "submitted",
      answers: params.answers,
      derivedScores: params.derivedScores,
      freeTextAnswers: params.freeTextAnswers,
      metadata: params.metadata,
      submittedAt: now,
    })
    .returning();
  return created;
}

export async function completeAiReadinessRespondent(params: {
  respondentId: string;
  privacyAccepted: boolean;
  marketingConsent: boolean;
  benchmarkConsent: boolean;
}) {
  const now = new Date();
  const [updated] = await db
    .update(aiReadinessRespondents)
    .set({
      inviteStatus: "completed",
      hasAcceptedPrivacyNotice: params.privacyAccepted,
      hasMarketingConsent: params.marketingConsent,
      hasBenchmarkConsent: params.benchmarkConsent,
      startedAt: sql`COALESCE(${aiReadinessRespondents.startedAt}, ${now})`,
      completedAt: now,
      lastSeenAt: now,
      updatedAt: now,
    })
    .where(eq(aiReadinessRespondents.id, params.respondentId))
    .returning();
  return updated;
}

export async function createAiReadinessUseCaseSubmission(
  data: NewAiReadinessUseCaseSubmission
) {
  await ensureDbSchema();
  const [created] = await db
    .insert(aiReadinessUseCaseSubmissions)
    .values(data)
    .returning();
  return created;
}

export async function listResponsesByAssessment(assessmentId: string) {
  await ensureDbSchema();
  return db
    .select()
    .from(aiReadinessResponses)
    .where(eq(aiReadinessResponses.assessmentId, assessmentId));
}

export async function listUseCaseSubmissionsByAssessment(assessmentId: string) {
  await ensureDbSchema();
  return db
    .select()
    .from(aiReadinessUseCaseSubmissions)
    .where(eq(aiReadinessUseCaseSubmissions.assessmentId, assessmentId))
    .orderBy(desc(aiReadinessUseCaseSubmissions.createdAt));
}

export async function getUseCaseSubmissionById(submissionId: string) {
  await ensureDbSchema();
  const [row] = await db
    .select()
    .from(aiReadinessUseCaseSubmissions)
    .where(eq(aiReadinessUseCaseSubmissions.id, submissionId))
    .limit(1);
  return row ?? null;
}

export async function updateAiReadinessUseCaseSubmission(
  submissionId: string,
  patch: Partial<NewAiReadinessUseCaseSubmission>
) {
  await ensureDbSchema();
  const [row] = await db
    .update(aiReadinessUseCaseSubmissions)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(aiReadinessUseCaseSubmissions.id, submissionId))
    .returning();
  return row ?? null;
}

export async function getAiReadinessDashboard(
  assessmentId: string
): Promise<AiReadinessDashboard | null> {
  const bundle = await getAssessmentBundleById(assessmentId);
  if (!bundle) return null;
  const [respondents, responses] = await Promise.all([
    listRespondentsByAssessment(assessmentId),
    listResponsesByAssessment(assessmentId),
  ]);
  return aggregateScores({
    template: bundle.templateDefinition,
    respondents: respondents.map((respondent) => ({
      organizationUnit: respondent.organizationUnit,
      pseudonymousId: respondent.pseudonymousId,
      inviteStatus: respondent.inviteStatus,
    })),
    responses: responses
      .filter((response) => response.status === "submitted")
      .map((response) => ({
        pseudonymousId: response.pseudonymousId,
        derivedScores: response.derivedScores as AiReadinessDerivedScores,
      })),
    aggregationThreshold: bundle.assessment.aggregationThreshold,
  });
}

export async function recomputeAiReadinessScores(assessmentId: string) {
  const bundle = await getAssessmentBundleById(assessmentId);
  if (!bundle) return null;
  const dashboard = await getAiReadinessDashboard(assessmentId);
  if (!dashboard) return null;
  const now = new Date();
  await db
    .delete(aiReadinessScores)
    .where(eq(aiReadinessScores.assessmentId, assessmentId));
  await db.insert(aiReadinessScores).values({
    assessmentId,
    workspaceId: bundle.assessment.workspaceId,
    scopeType: "company",
    scopeKey: "company",
    pillarScores: dashboard.pillarScores,
    sectionScores: dashboard.sectionScores,
    overallScore: dashboard.overallScore,
    bottleneckPillar: dashboard.bottleneckPillar,
    confidence: dashboard.confidence,
    respondentCount: dashboard.responseCount,
    aggregationThresholdMet: dashboard.aggregationThresholdMet,
    generatedAt: now,
  });
  const eligibleUnits = dashboard.units.filter((unit) => unit.aggregationThresholdMet);
  if (eligibleUnits.length > 0) {
    await db.insert(aiReadinessScores).values(
      eligibleUnits.map((unit) => ({
        assessmentId,
        workspaceId: bundle.assessment.workspaceId,
        scopeType: "unit",
        scopeKey: unit.unit,
        pillarScores: unit.pillarScores,
        sectionScores: {},
        overallScore: unit.overallScore,
        bottleneckPillar: unit.bottleneckPillar,
        confidence: null,
        respondentCount: unit.respondentCount,
        aggregationThresholdMet: true,
        generatedAt: now,
      }))
    );
  }
  return dashboard;
}

export async function createAiReadinessAuditEvent(
  data: NewAiReadinessAuditEvent
) {
  await ensureDbSchema();
  const [event] = await db.insert(aiReadinessAuditEvents).values(data).returning();
  return event;
}

export async function createAiReadinessExport(params: {
  assessmentId: string;
  workspaceId: string;
  exportType: string;
  requestedByUserId: string | null;
  includedPersonalData: boolean;
  anonymized: boolean;
}) {
  await ensureDbSchema();
  const [created] = await db
    .insert(aiReadinessExports)
    .values({
      assessmentId: params.assessmentId,
      workspaceId: params.workspaceId,
      exportType: params.exportType,
      requestedByUserId: params.requestedByUserId,
      includedPersonalData: params.includedPersonalData,
      anonymized: params.anonymized,
      status: "completed",
      completedAt: new Date(),
    })
    .returning();
  return created;
}

export async function listAiReadinessExports(assessmentId: string) {
  await ensureDbSchema();
  return db
    .select()
    .from(aiReadinessExports)
    .where(eq(aiReadinessExports.assessmentId, assessmentId))
    .orderBy(desc(aiReadinessExports.createdAt));
}

export async function createAiReadinessInsights(
  rows: NewAiReadinessInsight[]
) {
  await ensureDbSchema();
  if (rows.length === 0) return [] as AiReadinessInsight[];
  return db.insert(aiReadinessInsights).values(rows).returning();
}

export async function listAiReadinessInsights(assessmentId: string) {
  await ensureDbSchema();
  return db
    .select()
    .from(aiReadinessInsights)
    .where(eq(aiReadinessInsights.assessmentId, assessmentId))
    .orderBy(desc(aiReadinessInsights.createdAt));
}

export async function deleteDraftAiReadinessInsights(assessmentId: string) {
  await ensureDbSchema();
  await db
    .delete(aiReadinessInsights)
    .where(
      and(
        eq(aiReadinessInsights.assessmentId, assessmentId),
        eq(aiReadinessInsights.validationStatus, "draft")
      )
    );
}

export async function updateAiReadinessInsightValidation(params: {
  insightId: string;
  workspaceId: string;
  status: "draft" | "reviewed" | "approved" | "rejected";
  validatedByUserId: string;
}) {
  await ensureDbSchema();
  const [row] = await db
    .update(aiReadinessInsights)
    .set({
      validationStatus: params.status,
      humanValidated: params.status !== "draft",
      validatedByUserId: params.validatedByUserId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(aiReadinessInsights.id, params.insightId),
        eq(aiReadinessInsights.workspaceId, params.workspaceId)
      )
    )
    .returning();
  return row ?? null;
}

export async function getSubmittedResponsesByRespondentIds(
  respondentIds: string[]
) {
  await ensureDbSchema();
  if (respondentIds.length === 0) return [] as AiReadinessResponse[];
  return db
    .select()
    .from(aiReadinessResponses)
    .where(inArray(aiReadinessResponses.respondentId, respondentIds));
}

export async function getRespondentPrivacyBundleByTokenHash(tokenHash: string) {
  await ensureDbSchema();
  const found = await getRespondentByInviteTokenHash(tokenHash);
  if (!found) return null;
  const [responses, useCases] = await Promise.all([
    getSubmittedResponsesByRespondentIds([found.respondent.id]),
    db
      .select()
      .from(aiReadinessUseCaseSubmissions)
      .where(eq(aiReadinessUseCaseSubmissions.respondentId, found.respondent.id)),
  ]);
  return {
    respondent: found.respondent,
    assessment: found.assessment,
    template: found.template,
    responses,
    useCases,
  };
}

export async function withdrawAiReadinessBenchmarkConsentByTokenHash(
  tokenHash: string
) {
  await ensureDbSchema();
  const found = await getRespondentByInviteTokenHash(tokenHash);
  if (!found) return null;
  const [updated] = await db
    .update(aiReadinessRespondents)
    .set({
      hasBenchmarkConsent: false,
      updatedAt: new Date(),
    })
    .where(eq(aiReadinessRespondents.id, found.respondent.id))
    .returning();
  return updated ?? null;
}

export async function anonymizeAiReadinessRespondentByTokenHash(
  tokenHash: string
) {
  await ensureDbSchema();
  const found = await getRespondentByInviteTokenHash(tokenHash);
  if (!found) return null;
  const now = new Date();
  await db
    .update(aiReadinessResponses)
    .set({
      status: "privacy_deleted",
      answers: [],
      derivedScores: null,
      freeTextAnswers: {},
      metadata: {
        privacyDeletion: true,
        deletedAt: now.toISOString(),
      },
      updatedAt: now,
    })
    .where(eq(aiReadinessResponses.respondentId, found.respondent.id));
  await db
    .update(aiReadinessUseCaseSubmissions)
    .set({
      respondentId: null,
      pseudonymousId: "privacy_deleted",
      currentProcess: null,
      painPoint: null,
      desiredOutcome: null,
      dataNeeded: null,
      toolsUsed: null,
      humanInLoop: null,
      riskReasoning: null,
      impactEstimate: null,
      aiSolutionHypothesis: null,
      promptOrSnippet: null,
      updatedAt: now,
    })
    .where(eq(aiReadinessUseCaseSubmissions.respondentId, found.respondent.id));
  const [updated] = await db
    .update(aiReadinessRespondents)
    .set({
      email: null,
      name: null,
      surname: null,
      role: null,
      seniority: null,
      organizationUnit: "Privacy deleted",
      country: null,
      locale: null,
      inviteStatus: "privacy_deleted",
      inviteTokenHash: `deleted:${found.respondent.id}`,
      pseudonymousId: "privacy_deleted",
      hasAcceptedPrivacyNotice: false,
      hasMarketingConsent: false,
      hasBenchmarkConsent: false,
      updatedAt: now,
    })
    .where(eq(aiReadinessRespondents.id, found.respondent.id))
    .returning();
  await recomputeAiReadinessScores(found.assessment.id);
  return updated ?? null;
}
