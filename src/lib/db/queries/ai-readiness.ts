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
import { withSavedAccents } from "@/lib/ai-readiness/copy";
import {
  applyTemplateOverrides,
  filterTemplateDefinition,
  filterTemplateForRespondent,
  includedPillarsFromScoringConfig,
  templateOverridesFromScoringConfig,
  type AiReadinessTemplateOverrides,
  type AiReadinessQuestionScope,
} from "@/lib/ai-readiness/template-scope";

export type AiReadinessAssessmentBundle = {
  assessment: AiReadinessAssessment;
  template: AiReadinessAssessmentTemplate;
  templateDefinition: AiReadinessTemplateDefinition;
};

/** (Ondata 0) Le frasi del modello salvate senza accenti tornano con gli accenti (`withSavedAccents`). */
export function templateDefinitionFromRow(
  row: AiReadinessAssessmentTemplate
): AiReadinessTemplateDefinition {
  return withSavedAccents({
    pillars: row.pillars as AiReadinessTemplateDefinition["pillars"],
    sections: row.sections as AiReadinessTemplateDefinition["sections"],
    questions: row.questions as AiReadinessTemplateDefinition["questions"],
    scoringSchema:
      row.scoringSchema as AiReadinessTemplateDefinition["scoringSchema"],
  });
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
  return mergeAssessmentScoringConfig(assessmentId, { templateOverrides: overrides });
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


/**
 * (Rilascio 10, ondata 7b) Alcune chiavi di `scoringConfig` in una sola istruzione (`||` di jsonb): le altre chiavi
 * restano quelle del database in quell'istante. Prima ogni modifica riscriveva tutto `scoringConfig` letto un momento
 * prima: una copia del link per tutti salvata nel frattempo si sarebbe persa.
 */
export async function mergeAssessmentScoringConfig(assessmentId: string, patch: Record<string, unknown>) {
  await ensureDbSchema();
  const [updated] = await db
    .update(aiReadinessAssessments)
    .set({
      scoringConfig: sql`coalesce(${aiReadinessAssessments.scoringConfig}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(aiReadinessAssessments.id, assessmentId))
    .returning();
  return updated ?? null;
}

/**
 * Link per tutti: l'hash del token è salvato in scoringConfig (mai reso al client). Un link nuovo prende il posto di
 * quello di prima e delle sue copie (`openLinkCopies` torna vuoto).
 */
export async function setAssessmentOpenLinkTokenHash(
  assessmentId: string,
  tokenHash: string,
  questionScope?: AiReadinessQuestionScope | null
) {
  return mergeAssessmentScoringConfig(assessmentId, {
    openLinkTokenHash: tokenHash,
    openLinkQuestionScope: questionScope ?? null,
    openLinkCopies: [],
  });
}

/**
 * Le copie del link per tutti che restano valide insieme. Oltre, esce la meno usata di recente: prima le copie che
 * nessuno ha mai usato (la più vecchia per prima), poi quelle usate da più tempo. La copia appena emessa e il link
 * creato non escono mai.
 */
export const OPEN_LINK_COPIES_MAX = 100;

/** Una copia del link per tutti in `scoringConfig.openLinkCopies`: l'hash, quando è nata, l'ultima volta che è servita. */
export interface OpenLinkCopy {
  h: string;
  c: string;
  u: string | null;
}

/**
 * (Rilascio 10, ondata 7b) «Copia il link per tutti»: il token in chiaro non si salva mai, quindi una copia è un token in
 * più con le stesse domande, che vale insieme al link creato finché non se ne crea uno nuovo o si chiude la raccolta
 * (come «Copia link» dei referenti). Il browser che copia la riusa (`open-link-cache.ts`): se ne emette una per browser
 * e per versione del link. Solo se il link c'è; l'aggiunta, con l'uscita della meno usata oltre il massimo, è una sola
 * istruzione. Restituisce false senza link.
 */
export async function addAssessmentOpenLinkTokenHash(assessmentId: string, tokenHash: string, now: Date = new Date()): Promise<boolean> {
  await ensureDbSchema();
  const config = aiReadinessAssessments.scoringConfig;
  const rows = await db
    .update(aiReadinessAssessments)
    .set({
      // La copia nuova resta sempre (è quella appena data a chi copia); delle altre restano le più usate di recente.
      scoringConfig: sql`jsonb_set(coalesce(${config}, '{}'::jsonb), '{openLinkCopies}', (
        SELECT coalesce(jsonb_agg(kept.e ORDER BY kept.n), '[]'::jsonb) FROM (
          (SELECT t.e, t.n FROM jsonb_array_elements(coalesce(${config} -> 'openLinkCopies', '[]'::jsonb)) WITH ORDINALITY AS t(e, n)
            ORDER BY (t.e ->> 'u') IS NULL, coalesce(t.e ->> 'u', t.e ->> 'c') DESC
            LIMIT ${OPEN_LINK_COPIES_MAX - 1})
          UNION ALL
          SELECT jsonb_build_object('h', ${tokenHash}::text, 'c', ${now.toISOString()}::text, 'u', NULL),
            coalesce(jsonb_array_length(${config} -> 'openLinkCopies'), 0) + 1
        ) kept))`,
      updatedAt: new Date(),
    })
    .where(and(eq(aiReadinessAssessments.id, assessmentId), sql`(${config} ->> 'openLinkTokenHash') IS NOT NULL`))
    .returning({ id: aiReadinessAssessments.id });
  return rows.length > 0;
}

/**
 * (Rilascio 10, ondata 7b) Una copia del link per tutti è servita a qualcuno che risponde: l'ultima volta si aggiorna,
 * così una copia che gira (quella mandata a tutti il primo giorno) non esce mai per far posto alle copie nuove. Il link
 * creato non ha bisogno di questo: non esce mai. Senza quella copia non scrive niente.
 */
export async function touchAssessmentOpenLinkCopy(assessmentId: string, tokenHash: string, now: Date = new Date()): Promise<boolean> {
  await ensureDbSchema();
  const config = aiReadinessAssessments.scoringConfig;
  const rows = await db
    .update(aiReadinessAssessments)
    .set({
      scoringConfig: sql`jsonb_set(${config}, '{openLinkCopies}', (
        SELECT jsonb_agg(CASE WHEN t.e ->> 'h' = ${tokenHash}::text THEN jsonb_set(t.e, '{u}', to_jsonb(${now.toISOString()}::text)) ELSE t.e END ORDER BY t.n)
        FROM jsonb_array_elements(${config} -> 'openLinkCopies') WITH ORDINALITY AS t(e, n)))`,
    })
    .where(
      and(
        eq(aiReadinessAssessments.id, assessmentId),
        sql`coalesce(${config} -> 'openLinkCopies', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('h', ${tokenHash}::text))`
      )
    )
    .returning({ id: aiReadinessAssessments.id });
  return rows.length > 0;
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
      sql`(${aiReadinessAssessments.scoringConfig}->>'openLinkTokenHash' = ${tokenHash}
        OR coalesce(${aiReadinessAssessments.scoringConfig} -> 'openLinkCopies', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('h', ${tokenHash}::text)))`
    )
    .limit(1);
  if (!row) return null;
  return {
    assessment: row.assessment,
    template: row.template,
    templateDefinition: templateDefinitionForAssessment(row.assessment, row.template),
  };
}


/** Elimina l'assessment: respondents, risposte, score, insight ed export
 *  cadono in cascata (FK ON DELETE CASCADE). Operazione irreversibile. */
export async function deleteAiReadinessAssessment(
  assessmentId: string,
  workspaceId: string
) {
  await ensureDbSchema();
  const [deleted] = await db
    .delete(aiReadinessAssessments)
    .where(
      and(
        eq(aiReadinessAssessments.id, assessmentId),
        eq(aiReadinessAssessments.workspaceId, workspaceId)
      )
    )
    .returning();
  return deleted ?? null;
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
    // Ogni respondent vede solo le sezioni del proprio binario:
    // "everyone" = survey organizzazione, "internal" = scheda referenti.
    templateDefinition: filterTemplateForRespondent(
      templateDefinitionForAssessment(row.assessment, row.template),
      row.respondent.surveyTrack,
      row.respondent.questionScope
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


/** Casi use case inviati da uno specifico respondent (esperto). */
export async function listUseCaseSubmissionsByRespondent(respondentId: string) {
  await ensureDbSchema();
  return db
    .select()
    .from(aiReadinessUseCaseSubmissions)
    .where(eq(aiReadinessUseCaseSubmissions.respondentId, respondentId))
    .orderBy(desc(aiReadinessUseCaseSubmissions.createdAt));
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
