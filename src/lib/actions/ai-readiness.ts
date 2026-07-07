"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/redirect-to-login";
import { getWorkspaceAccessForUser } from "@/lib/workspace-access";
import {
  canManageWorkspaceSettings,
  canReviewWorkspacePortfolio,
} from "@/lib/workspace-permissions";
import {
  completeAiReadinessRespondent,
  createAiReadinessAssessment,
  createAiReadinessAuditEvent,
  createAiReadinessInsights,
  createAiReadinessRespondent,
  createAiReadinessUseCaseSubmission,
  deleteDraftAiReadinessInsights,
  ensureAiReadinessSystemTemplate,
  getAssessmentBundleById,
  getRespondentByInviteTokenHash,
  getRespondentPrivacyBundleByTokenHash,
  getUseCaseSubmissionById,
  getAssessmentByOpenLinkTokenHash,
  markRespondentStarted,
  saveAiReadinessDraftResponse,
  setAssessmentOpenLinkTokenHash,
  setAssessmentTemplateOverrides,
  listResponsesByAssessment,
  updateAiReadinessRespondentIdentity,
  listRespondentsByAssessment,
  listUseCaseSubmissionsByAssessment,
  anonymizeAiReadinessRespondentByTokenHash,
  recomputeAiReadinessScores,
  updateAiReadinessInsightValidation,
  updateAiReadinessUseCaseSubmission,
  updateAiReadinessAssessment,
  upsertAiReadinessResponse,
  withdrawAiReadinessBenchmarkConsentByTokenHash,
} from "@/lib/db/queries/ai-readiness";
import { createUseCase } from "@/lib/db/queries/use-cases";
import { generateAiReadinessIntelligence } from "@/lib/ai-readiness/intelligence";
import { createInviteToken, createPseudonymousId, hashInviteToken } from "@/lib/ai-readiness/token";
import { scoreResponse } from "@/lib/ai-readiness/scoring";
import {
  normalizeDraftPayload,
  type AiReadinessDraftPayload,
} from "@/lib/ai-readiness/draft";
import {
  templateOverridesFromScoringConfig,
  type AiReadinessTemplateOverrides,
} from "@/lib/ai-readiness/template-scope";
import { randomUUID } from "node:crypto";
import type { AiReadinessAnswer } from "@/lib/ai-readiness/types";

export type AiReadinessActionState<Data = unknown> = {
  ok: boolean;
  message?: string | null;
  fieldErrors?: Record<string, string>;
  data?: Data;
};

export type CreateRespondentInviteData = {
  respondentId: string;
  inviteUrl: string;
  email: string | null;
  expiresWithAssessment: boolean;
};

const createAssessmentSchema = z.object({
  name: z.string().trim().min(3, "Dai un nome all'assessment."),
  description: z.string().trim().optional(),
  displayName: z.string().trim().optional(),
  introCopy: z.string().trim().optional(),
  completionCopy: z.string().trim().optional(),
  controllerName: z.string().trim().min(2, "Indica il titolare del trattamento."),
  processorName: z.string().trim().min(2, "Indica il responsabile/processore."),
  legalBasis: z.string().trim().min(2, "Indica la base giuridica."),
  privacyNoticeUrl: z.string().trim().optional(),
  supportEmail: z.string().trim().email("Email supporto non valida."),
  dpoEmail: z.string().trim().optional(),
  dataRetentionDays: z.coerce.number().int().min(30).max(3650),
  aggregationThreshold: z.coerce.number().int().min(3).max(50),
  surveyMode: z.enum(["anonymous", "named"]).default("anonymous"),
});

const inviteRespondentSchema = z.object({
  email: z
    .string()
    .trim()
    .transform((value) => value.toLowerCase())
    .pipe(z.string().email("Email non valida.")),
  name: z.string().trim().optional(),
  surname: z.string().trim().optional(),
  role: z.string().trim().optional(),
  seniority: z.string().trim().optional(),
  organizationUnit: z.string().trim().min(2, "Indica l'area/team."),
  country: z.string().trim().optional(),
  locale: z.string().trim().optional(),
});

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function numberOrNull(value: string) {
  if (!value) return null;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function normalizeBaseUrl(raw: string | undefined | null) {
  const value = raw?.trim();
  if (!value) return null;
  return value.startsWith("http://") || value.startsWith("https://")
    ? value.replace(/\/+$/, "")
    : `https://${value.replace(/\/+$/, "")}`;
}

async function getBaseUrl() {
  const configured =
    normalizeBaseUrl(process.env.NEXT_PUBLIC_APP_URL) ??
    normalizeBaseUrl(process.env.APP_URL) ??
    normalizeBaseUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
    normalizeBaseUrl(process.env.VERCEL_URL);
  if (configured) return configured;
  const headerStore = await headers();
  const host = headerStore.get("host") ?? "localhost:3000";
  const proto = headerStore.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

function errorState(message: string, fieldErrors: Record<string, string> = {}) {
  return { ok: false, message, fieldErrors };
}

async function assertAssessmentManager(workspaceId: string) {
  const session = await requireSession();
  const access = await getWorkspaceAccessForUser(session.user.id, workspaceId);
  if (!access) {
    return {
      ok: false as const,
      state: errorState("Workspace non trovato o non accessibile."),
    };
  }
  if (!canManageWorkspaceSettings(access.role)) {
    return {
      ok: false as const,
      state: errorState("Non hai i permessi per gestire l'assessment."),
    };
  }
  return { ok: true as const, session, access };
}

async function assertAssessmentReviewer(workspaceId: string) {
  const session = await requireSession();
  const access = await getWorkspaceAccessForUser(session.user.id, workspaceId);
  if (!access) {
    return {
      ok: false as const,
      state: errorState("Workspace non trovato o non accessibile."),
    };
  }
  if (!canReviewWorkspacePortfolio(access.role)) {
    return {
      ok: false as const,
      state: errorState("Non hai i permessi per vedere questa dashboard."),
    };
  }
  return { ok: true as const, session, access };
}

export async function createAiReadinessAssessmentAction(
  workspaceId: string,
  _prev: AiReadinessActionState,
  formData: FormData
): Promise<AiReadinessActionState<{ assessmentId: string }>> {
  const manager = await assertAssessmentManager(workspaceId);
  if (!manager.ok) return manager.state;

  const parsed = createAssessmentSchema.safeParse({
    name: formString(formData, "name"),
    description: formString(formData, "description"),
    displayName: formString(formData, "displayName"),
    introCopy: formString(formData, "introCopy"),
    completionCopy: formString(formData, "completionCopy"),
    controllerName: formString(formData, "controllerName"),
    processorName: formString(formData, "processorName"),
    legalBasis: formString(formData, "legalBasis"),
    privacyNoticeUrl: formString(formData, "privacyNoticeUrl"),
    supportEmail: formString(formData, "supportEmail"),
    dpoEmail: formString(formData, "dpoEmail"),
    dataRetentionDays: formString(formData, "dataRetentionDays"),
    aggregationThreshold: formString(formData, "aggregationThreshold"),
    surveyMode: formString(formData, "surveyMode") || "anonymous",
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".")] = issue.message;
    return errorState("Controlla i campi evidenziati.", fieldErrors);
  }

  const template = await ensureAiReadinessSystemTemplate();

  // Pilastri selezionati: permette assessment mirati (es. solo Adoption per
  // tutta l'org, solo Technology per l'IT). Vuoto/tutti = template completo.
  const templatePillarIds = (
    template.pillars as Array<{ id: string }>
  ).map((pillar) => pillar.id);
  const requestedPillars = formData
    .getAll("pillars")
    .filter((value): value is string => typeof value === "string")
    .filter((value) => templatePillarIds.includes(value));
  if (formData.has("pillars") && requestedPillars.length === 0) {
    return errorState("Seleziona almeno un'area da misurare.", {
      pillars: "Seleziona almeno un'area.",
    });
  }
  const includedPillars =
    requestedPillars.length > 0 &&
    requestedPillars.length < templatePillarIds.length
      ? requestedPillars
      : null;

  const assessment = await createAiReadinessAssessment({
    organizationId: manager.access.workspace.organizationId,
    workspaceId,
    templateId: template.id,
    name: parsed.data.name,
    description: parsed.data.description || null,
    status: "draft",
    language: "it",
    brandConfig: {
      displayName: parsed.data.displayName || manager.access.workspace.name,
      introCopy:
        parsed.data.introCopy ||
        "Questa diagnosi misura la readiness AI dell'organizzazione. Non e un esame: serve a capire dove aiutare meglio team, processi e tecnologia.",
      completionCopy:
        parsed.data.completionCopy ||
        "Grazie. Le risposte saranno aggregate e usate per costruire una roadmap AI piu concreta e sicura.",
    },
    terminologyConfig: {
      organizationUnitLabel: "Area / team",
      roleLabel: "Ruolo",
    },
    privacyConfig: {
      controllerName: parsed.data.controllerName,
      processorName: parsed.data.processorName,
      legalBasis: parsed.data.legalBasis,
      privacyNoticeUrl: parsed.data.privacyNoticeUrl || null,
      dataRetentionDays: parsed.data.dataRetentionDays,
      allowIndividualView: false,
      allowFreeTextToManagers: false,
      allowBenchmarking: false,
      benchmarkConsentRequired: false,
      marketingConsentEnabled: false,
      dpoEmail: parsed.data.dpoEmail || null,
      supportEmail: parsed.data.supportEmail,
    },
    scoringConfig: {
      version: "ai-readiness-core-1",
      ...(includedPillars ? { includedPillars } : {}),
    },
    modulesEnabled: {
      executiveAssessment: true,
      organizationalAssessment: true,
      adoptionAssessment: true,
      useCaseIntake: true,
      uploadEvidence: false,
      aiInsights: true,
      pdfExport: true,
      excelExport: true,
    },
    anonymousMode: parsed.data.surveyMode !== "named",
    aggregationThreshold: parsed.data.aggregationThreshold,
    createdByUserId: manager.session.user.id,
  });

  await createAiReadinessAuditEvent({
    organizationId: manager.access.workspace.organizationId,
    workspaceId,
    assessmentId: assessment.id,
    actorUserId: manager.session.user.id,
    eventType: "assessment_created",
    eventPayload: {
      status: assessment.status,
      aggregationThreshold: assessment.aggregationThreshold,
    },
  });

  revalidatePath(`/dashboard/${workspaceId}/ai-readiness`);
  return {
    ok: true,
    message: "Assessment creato. Ora puoi aprirlo e invitare i respondent.",
    data: { assessmentId: assessment.id },
    fieldErrors: {},
  };
}

export async function updateAiReadinessAssessmentStatusAction(
  workspaceId: string,
  assessmentId: string,
  status: "open" | "closed" | "archived",
  _prev: AiReadinessActionState,
  _formData: FormData
): Promise<AiReadinessActionState> {
  void _prev;
  void _formData;
  const manager = await assertAssessmentManager(workspaceId);
  if (!manager.ok) return manager.state;
  const bundle = await getAssessmentBundleById(assessmentId);
  if (!bundle || bundle.assessment.workspaceId !== workspaceId) {
    return errorState("Assessment non trovato.");
  }
  const updated = await updateAiReadinessAssessment(assessmentId, {
    status,
    opensAt: status === "open" ? new Date() : bundle.assessment.opensAt,
    closesAt: status === "closed" ? new Date() : bundle.assessment.closesAt,
  });
  await createAiReadinessAuditEvent({
    organizationId: manager.access.workspace.organizationId,
    workspaceId,
    assessmentId,
    actorUserId: manager.session.user.id,
    eventType: status === "open" ? "assessment_opened" : "settings_changed",
    eventPayload: { status: updated?.status ?? status },
  });
  revalidatePath(`/dashboard/${workspaceId}/ai-readiness`);
  return { ok: true, message: `Assessment ${status}.`, fieldErrors: {} };
}

export async function updateAiReadinessThresholdAction(
  workspaceId: string,
  assessmentId: string,
  _prev: AiReadinessActionState,
  formData: FormData
): Promise<AiReadinessActionState> {
  void _prev;
  const manager = await assertAssessmentManager(workspaceId);
  if (!manager.ok) return manager.state;
  const bundle = await getAssessmentBundleById(assessmentId);
  if (!bundle || bundle.assessment.workspaceId !== workspaceId) {
    return errorState("Assessment non trovato.");
  }
  // Privacy by design: in modalita anonima la soglia minima resta 3;
  // in modalita nominativa si puo scendere fino a 1 (pilot piccoli).
  const min = bundle.assessment.anonymousMode !== false ? 3 : 1;
  const raw = Number(formString(formData, "aggregationThreshold"));
  if (!Number.isInteger(raw) || raw < min || raw > 50) {
    return errorState(
      `Soglia non valida: inserisci un numero tra ${min} e 50.`,
      { aggregationThreshold: `Da ${min} a 50.` }
    );
  }
  const expectedRaw = formString(formData, "expectedRespondents");
  const expected = expectedRaw ? Number(expectedRaw) : null;
  if (expected != null && (!Number.isInteger(expected) || expected < 1 || expected > 100000)) {
    return errorState("Risposte attese non valide.", {
      expectedRespondents: "Numero intero positivo.",
    });
  }
  await updateAiReadinessAssessment(assessmentId, {
    aggregationThreshold: raw,
    ...(expected != null
      ? {
          scoringConfig: {
            ...(bundle.assessment.scoringConfig ?? {}),
            expectedRespondents: expected,
          },
        }
      : {}),
  });
  await recomputeAiReadinessScores(assessmentId);
  await createAiReadinessAuditEvent({
    organizationId: manager.access.workspace.organizationId,
    workspaceId,
    assessmentId,
    actorUserId: manager.session.user.id,
    eventType: "settings_changed",
    eventPayload: { aggregationThreshold: raw },
  });
  revalidatePath(`/dashboard/${workspaceId}/ai-readiness`);
  return {
    ok: true,
    message: `Soglia aggiornata a ${raw}. Score ricalcolati.`,
    fieldErrors: {},
  };
}

/** Customizzazione per-assessment delle singole domande: rimuovi, modifica,
 *  ripristina o aggiungi (scala 0-5 o testo libero, per non rompere lo score). */
export async function customizeAssessmentQuestionAction(
  workspaceId: string,
  assessmentId: string,
  _prev: AiReadinessActionState,
  formData: FormData
): Promise<AiReadinessActionState> {
  void _prev;
  const manager = await assertAssessmentManager(workspaceId);
  if (!manager.ok) return manager.state;
  const bundle = await getAssessmentBundleById(assessmentId);
  if (!bundle || bundle.assessment.workspaceId !== workspaceId) {
    return errorState("Assessment non trovato.");
  }

  const op = formString(formData, "op");
  const overrides = templateOverridesFromScoringConfig(
    bundle.assessment.scoringConfig
  );
  const removed = new Set(overrides.removed ?? []);
  const edited = { ...(overrides.edited ?? {}) };
  let added = [...(overrides.added ?? [])];

  if (op === "remove") {
    const questionId = formString(formData, "questionId");
    if (!questionId) return errorState("Domanda non valida.");
    if (added.some((q) => q.id === questionId)) {
      added = added.filter((q) => q.id !== questionId);
    } else {
      removed.add(questionId);
    }
    delete edited[questionId];
  } else if (op === "restore") {
    const questionId = formString(formData, "questionId");
    removed.delete(questionId);
    delete edited[questionId];
  } else if (op === "edit") {
    const questionId = formString(formData, "questionId");
    const label = formString(formData, "label");
    if (!questionId || label.length < 5) {
      return errorState("Testo domanda troppo corto (minimo 5 caratteri).", {
        label: "Minimo 5 caratteri.",
      });
    }
    const description = formString(formData, "description");
    const required = formData.get("required") === "on";
    const custom = added.find((q) => q.id === questionId);
    if (custom) {
      custom.label = label;
      custom.description = description || undefined;
      custom.required = required;
    } else {
      edited[questionId] = { label, description, required };
    }
  } else if (op === "add") {
    const sectionId = formString(formData, "sectionId");
    const label = formString(formData, "label");
    const answerType = formString(formData, "answerType") === "text" ? "text" : "scale";
    if (!sectionId || label.length < 5) {
      return errorState("Testo domanda troppo corto (minimo 5 caratteri).", {
        label: "Minimo 5 caratteri.",
      });
    }
    if (!bundle.templateDefinition.sections.some((s) => s.id === sectionId)) {
      return errorState("Sezione non valida.");
    }
    added.push({
      id: `custom-${randomUUID().slice(0, 8)}`,
      sectionId,
      label,
      description: formString(formData, "description") || undefined,
      answerType,
      required: answerType === "scale",
    });
  } else {
    return errorState("Operazione non valida.");
  }

  const nextOverrides: AiReadinessTemplateOverrides = {
    removed: [...removed],
    edited,
    added,
  };
  await setAssessmentTemplateOverrides(assessmentId, nextOverrides);

  const responses = await listResponsesByAssessment(assessmentId);
  const submitted = responses.filter((r) => r.status === "submitted").length;
  if (submitted > 0) await recomputeAiReadinessScores(assessmentId);

  await createAiReadinessAuditEvent({
    organizationId: manager.access.workspace.organizationId,
    workspaceId,
    assessmentId,
    actorUserId: manager.session.user.id,
    eventType: "template_customized",
    eventPayload: { op, removed: nextOverrides.removed?.length ?? 0, added: added.length },
  });
  revalidatePath(`/dashboard/${workspaceId}/ai-readiness`);
  revalidatePath(`/dashboard/${workspaceId}/ai-readiness/questions/${assessmentId}`);
  return {
    ok: true,
    message:
      submitted > 0
        ? "Domande aggiornate. Attenzione: ci sono gia risposte inviate, gli score sono stati ricalcolati sulle domande attuali."
        : "Domande aggiornate.",
    fieldErrors: {},
  };
}

export async function generateAiReadinessOpenLinkAction(
  workspaceId: string,
  assessmentId: string,
  _prev: AiReadinessActionState<{ openUrl: string }>,
  _formData: FormData
): Promise<AiReadinessActionState<{ openUrl: string }>> {
  void _prev; void _formData;
  const manager = await assertAssessmentManager(workspaceId);
  if (!manager.ok) return manager.state;
  const bundle = await getAssessmentBundleById(assessmentId);
  if (!bundle || bundle.assessment.workspaceId !== workspaceId) {
    return errorState("Assessment non trovato.");
  }
  const token = createInviteToken();
  await setAssessmentOpenLinkTokenHash(assessmentId, hashInviteToken(token));
  const baseUrl = await getBaseUrl();
  await createAiReadinessAuditEvent({
    organizationId: manager.access.workspace.organizationId,
    workspaceId,
    assessmentId,
    actorUserId: manager.session.user.id,
    eventType: "open_link_generated",
    eventPayload: {},
  });
  revalidatePath(`/dashboard/${workspaceId}/ai-readiness`);
  return {
    ok: true,
    message: "Link condivisibile pronto: chiunque lo riceve puo iniziare la survey.",
    fieldErrors: {},
    data: { openUrl: `${baseUrl}/s/${encodeURIComponent(token)}` },
  };
}

const openStartSchema = z.object({
  organizationUnit: z.string().trim().min(2, "Indica la tua area o team."),
  firstName: z.string().trim().optional(),
  lastName: z.string().trim().optional(),
  email: z
    .string()
    .trim()
    .transform((value) => value.toLowerCase())
    .optional(),
});

/** Avvio della survey da link condivisibile: crea un respondent personale
 *  e restituisce il suo link /a/ (il client lo salva sul dispositivo per
 *  evitare doppioni se la stessa persona riapre il link pubblico). */
export async function startOpenSurveyAction(
  openToken: string,
  _prev: AiReadinessActionState<{ personalUrl: string }>,
  formData: FormData
): Promise<AiReadinessActionState<{ personalUrl: string }>> {
  void _prev;
  const found = await getAssessmentByOpenLinkTokenHash(hashInviteToken(openToken));
  if (!found) return errorState("Link non valido o revocato.");
  if (found.assessment.status !== "open") {
    return errorState("La raccolta non e aperta in questo momento.");
  }
  const named = found.assessment.anonymousMode === false;
  const parsed = openStartSchema.safeParse({
    organizationUnit: formString(formData, "organizationUnit"),
    firstName: formString(formData, "firstName"),
    lastName: formString(formData, "lastName"),
    email: formString(formData, "email") || undefined,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".")] = issue.message;
    return errorState("Controlla i campi evidenziati.", fieldErrors);
  }
  if (named && (!parsed.data.firstName || !parsed.data.lastName)) {
    return errorState("Questa survey e nominativa: inserisci nome e cognome.", {
      ...(parsed.data.firstName ? {} : { firstName: "Richiesto." }),
      ...(parsed.data.lastName ? {} : { lastName: "Richiesto." }),
    });
  }

  const personalToken = createInviteToken();
  const respondent = await createAiReadinessRespondent({
    assessmentId: found.assessment.id,
    organizationId: found.assessment.organizationId,
    workspaceId: found.assessment.workspaceId,
    email: parsed.data.email || null,
    name: parsed.data.firstName || null,
    surname: parsed.data.lastName || null,
    organizationUnit: parsed.data.organizationUnit,
    locale: "it",
    inviteTokenHash: hashInviteToken(personalToken),
    inviteStatus: "opened",
    pseudonymousId: createPseudonymousId(
      `${found.assessment.id}:open:${personalToken}`
    ),
  });
  await createAiReadinessAuditEvent({
    organizationId: found.assessment.organizationId,
    workspaceId: found.assessment.workspaceId,
    assessmentId: found.assessment.id,
    respondentId: respondent.id,
    eventType: "respondent_self_registered",
    eventPayload: { organizationUnit: respondent.organizationUnit },
  });
  const baseUrl = await getBaseUrl();
  return {
    ok: true,
    fieldErrors: {},
    data: { personalUrl: `${baseUrl}/a/${encodeURIComponent(personalToken)}` },
  };
}

export async function createAiReadinessRespondentInviteAction(
  workspaceId: string,
  assessmentId: string,
  _prev: AiReadinessActionState<CreateRespondentInviteData>,
  formData: FormData
): Promise<AiReadinessActionState<CreateRespondentInviteData>> {
  const manager = await assertAssessmentManager(workspaceId);
  if (!manager.ok) return manager.state;
  const bundle = await getAssessmentBundleById(assessmentId);
  if (!bundle || bundle.assessment.workspaceId !== workspaceId) {
    return errorState("Assessment non trovato.");
  }

  const parsed = inviteRespondentSchema.safeParse({
    email: formString(formData, "email"),
    name: formString(formData, "name"),
    surname: formString(formData, "surname"),
    role: formString(formData, "role"),
    seniority: formString(formData, "seniority"),
    organizationUnit: formString(formData, "organizationUnit"),
    country: formString(formData, "country"),
    locale: formString(formData, "locale") || "it",
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".")] = issue.message;
    return errorState("Controlla i campi evidenziati.", fieldErrors);
  }

  const token = createInviteToken();
  const respondent = await createAiReadinessRespondent({
    assessmentId,
    organizationId: manager.access.workspace.organizationId,
    workspaceId,
    email: parsed.data.email,
    name: parsed.data.name || null,
    surname: parsed.data.surname || null,
    role: parsed.data.role || null,
    seniority: parsed.data.seniority || null,
    organizationUnit: parsed.data.organizationUnit,
    country: parsed.data.country || null,
    locale: parsed.data.locale || "it",
    inviteTokenHash: hashInviteToken(token),
    inviteStatus: "invited",
    pseudonymousId: createPseudonymousId(`${assessmentId}:${parsed.data.email}:${Date.now()}`),
  });
  const baseUrl = await getBaseUrl();
  const inviteUrl = `${baseUrl}/a/${encodeURIComponent(token)}`;

  await createAiReadinessAuditEvent({
    organizationId: manager.access.workspace.organizationId,
    workspaceId,
    assessmentId,
    actorUserId: manager.session.user.id,
    respondentId: respondent.id,
    eventType: "respondent_invited",
    eventPayload: {
      organizationUnit: respondent.organizationUnit,
      role: respondent.role,
      hasEmail: Boolean(respondent.email),
    },
  });

  revalidatePath(`/dashboard/${workspaceId}/ai-readiness`);
  return {
    ok: true,
    message: "Invito creato. Copia il link e invialo al respondent.",
    fieldErrors: {},
    data: {
      respondentId: respondent.id,
      inviteUrl,
      email: respondent.email,
      expiresWithAssessment: true,
    },
  };
}

function collectAnswersFromForm(formData: FormData, bundle: Awaited<ReturnType<typeof getAssessmentBundleById>>) {
  if (!bundle) return { answers: [] as AiReadinessAnswer[], fieldErrors: {} as Record<string, string> };
  const fieldErrors: Record<string, string> = {};
  const now = new Date().toISOString();
  const answers = bundle.templateDefinition.questions.map((question) => {
    const fieldName = `question__${question.id}`;
    let raw: string | number | string[] | null = formString(formData, fieldName);
    if (question.answerType === "scale") {
      raw = numberOrNull(String(raw ?? ""));
    }
    if (question.required && (raw == null || raw === "" || (Array.isArray(raw) && raw.length === 0))) {
      fieldErrors[fieldName] = "Risposta obbligatoria.";
    }
    return {
      questionId: question.id,
      value: raw,
      answerType: question.answerType,
      sectionId: question.sectionId,
      pillarId: question.pillarId,
      answeredAt: now,
    } satisfies AiReadinessAnswer;
  });
  return { answers, fieldErrors };
}

export async function saveAiReadinessSurveyDraftAction(
  token: string,
  payload: AiReadinessDraftPayload
): Promise<AiReadinessActionState<{ savedAt: string }>> {
  const found = await getRespondentByInviteTokenHash(hashInviteToken(token));
  if (!found) return errorState("Invito non valido o revocato.");
  const { respondent, assessment } = found;
  if (
    respondent.inviteStatus === "revoked" ||
    respondent.inviteStatus === "expired" ||
    respondent.inviteStatus === "privacy_deleted"
  ) {
    return errorState("Questo invito non e piu valido.");
  }
  if (respondent.inviteStatus === "completed") {
    return errorState("Le risposte sono gia state inviate.");
  }
  if (assessment.status !== "open") {
    return errorState("L'assessment non e aperto.");
  }

  const normalized = normalizeDraftPayload(found.templateDefinition, payload);
  const savedAt = new Date().toISOString();
  await saveAiReadinessDraftResponse({
    respondent,
    answers: normalized.answers,
    metadata: {
      draft: {
        consents: normalized.consents,
        useCase: normalized.useCase,
        identity: normalized.identity,
      },
      draftSavedAt: savedAt,
      templateVersion: found.template.version,
    },
  });
  if (
    assessment.anonymousMode === false &&
    (normalized.identity.firstName || normalized.identity.lastName)
  ) {
    await updateAiReadinessRespondentIdentity({
      respondentId: respondent.id,
      name: normalized.identity.firstName,
      surname: normalized.identity.lastName,
    });
  }
  await markRespondentStarted(respondent.id);

  return { ok: true, fieldErrors: {}, data: { savedAt } };
}

export async function submitAiReadinessResponseAction(
  token: string,
  _prev: AiReadinessActionState,
  formData: FormData
): Promise<AiReadinessActionState<{ completed: true }>> {
  const found = await getRespondentByInviteTokenHash(hashInviteToken(token));
  if (!found) return errorState("Invito non valido o revocato.");
  const { respondent, assessment } = found;
  if (
    respondent.inviteStatus === "revoked" ||
    respondent.inviteStatus === "expired" ||
    respondent.inviteStatus === "privacy_deleted"
  ) {
    return errorState("Questo invito non e piu valido.");
  }
  if (respondent.inviteStatus === "completed") {
    // Idempotenza: un secondo submit (doppio click, replay) non deve
    // sovrascrivere le risposte né duplicare gli use case proposti.
    return {
      ok: true,
      message: "Risposte gia inviate in precedenza.",
      fieldErrors: {},
      data: { completed: true },
    };
  }
  if (assessment.status !== "open") {
    return errorState("L'assessment non e aperto. Contatta il team Unbundle.");
  }

  const acceptedPrivacy = formData.get("privacyAccepted") === "on";
  if (!acceptedPrivacy) {
    return errorState("Per iniziare devi accettare l'informativa privacy.", {
      privacyAccepted: "Richiesto.",
    });
  }

  // Survey nominativa: nome e cognome obbligatori (nessuna registrazione richiesta).
  const respondentFirstName = formString(formData, "respondentFirstName").slice(0, 120);
  const respondentLastName = formString(formData, "respondentLastName").slice(0, 120);
  if (assessment.anonymousMode === false) {
    const identityErrors: Record<string, string> = {};
    if (!respondentFirstName) identityErrors.respondentFirstName = "Inserisci il nome.";
    if (!respondentLastName) identityErrors.respondentLastName = "Inserisci il cognome.";
    if (Object.keys(identityErrors).length > 0) {
      return errorState("Inserisci nome e cognome per inviare le risposte.", identityErrors);
    }
  }

  const collected = collectAnswersFromForm(formData, found);
  if (Object.keys(collected.fieldErrors).length > 0) {
    return errorState("Completa le risposte obbligatorie.", collected.fieldErrors);
  }

  const derivedScores = scoreResponse({
    template: found.templateDefinition,
    answers: collected.answers,
  });
  const freeTextAnswers: Record<string, string> = {};
  for (const answer of collected.answers) {
    if (answer.answerType === "text" && typeof answer.value === "string") {
      freeTextAnswers[answer.questionId] = answer.value;
    }
  }
  const headerStore = await headers();
  await upsertAiReadinessResponse({
    respondent,
    answers: collected.answers,
    derivedScores,
    freeTextAnswers,
    metadata: {
      locale: respondent.locale ?? "it",
      version: "phase-1",
      templateVersion: found.template.version,
      userAgent: headerStore.get("user-agent")?.slice(0, 500) ?? null,
    },
  });

  if (assessment.anonymousMode === false) {
    await updateAiReadinessRespondentIdentity({
      respondentId: respondent.id,
      name: respondentFirstName,
      surname: respondentLastName,
    });
  }

  await completeAiReadinessRespondent({
    respondentId: respondent.id,
    privacyAccepted: true,
    marketingConsent: formData.get("marketingConsent") === "on",
    benchmarkConsent: formData.get("benchmarkConsent") === "on",
  });

  const useCaseTitle = formString(formData, "useCaseTitle");
  if (useCaseTitle.length > 0) {
    await createAiReadinessUseCaseSubmission({
      assessmentId: assessment.id,
      workspaceId: assessment.workspaceId,
      respondentId: respondent.id,
      pseudonymousId: respondent.pseudonymousId,
      title: useCaseTitle,
      currentProcess: formString(formData, "useCaseCurrentProcess") || null,
      painPoint: formString(formData, "useCasePainPoint") || null,
      desiredOutcome: formString(formData, "useCaseDesiredOutcome") || null,
      frequency: formString(formData, "useCaseFrequency") || null,
      estimatedBeneficiaries: numberOrNull(formString(formData, "useCaseBeneficiaries")),
      dataNeeded: formString(formData, "useCaseDataNeeded") || null,
      toolsUsed: formString(formData, "useCaseToolsUsed") || null,
      humanInLoop: formString(formData, "useCaseHumanInLoop") || null,
      riskLevel: formString(formData, "useCaseRiskLevel") || null,
      riskReasoning: formString(formData, "useCaseRiskReasoning") || null,
      impactEstimate: formString(formData, "useCaseImpactEstimate") || null,
      aiSolutionHypothesis: formString(formData, "useCaseAiHypothesis") || null,
      source: "assessment",
      status: "submitted",
    });
  }

  await recomputeAiReadinessScores(assessment.id);
  await createAiReadinessAuditEvent({
    organizationId: respondent.organizationId,
    workspaceId: respondent.workspaceId,
    assessmentId: assessment.id,
    respondentId: respondent.id,
    eventType: "response_submitted",
    eventPayload: {
      answeredScoredQuestions: derivedScores.answeredScoredQuestions,
      totalScoredQuestions: derivedScores.totalScoredQuestions,
      useCaseSubmitted: useCaseTitle.length > 0,
    },
    userAgent: headerStore.get("user-agent")?.slice(0, 500) ?? null,
  });

  return {
    ok: true,
    message: "Risposte inviate. Grazie per il contributo.",
    fieldErrors: {},
    data: { completed: true },
  };
}

export async function recomputeAiReadinessScoresAction(
  workspaceId: string,
  assessmentId: string,
  _prev: AiReadinessActionState,
  _formData: FormData
): Promise<AiReadinessActionState> {
  void _prev;
  void _formData;
  const reviewer = await assertAssessmentReviewer(workspaceId);
  if (!reviewer.ok) return reviewer.state;
  const bundle = await getAssessmentBundleById(assessmentId);
  if (!bundle || bundle.assessment.workspaceId !== workspaceId) {
    return errorState("Assessment non trovato.");
  }
  const dashboard = await recomputeAiReadinessScores(assessmentId);
  await createAiReadinessAuditEvent({
    organizationId: reviewer.access.workspace.organizationId,
    workspaceId,
    assessmentId,
    actorUserId: reviewer.session.user.id,
    eventType: "scores_recomputed",
    eventPayload: {
      responseCount: dashboard?.responseCount ?? 0,
      aggregationThresholdMet: dashboard?.aggregationThresholdMet ?? false,
    },
  });
  revalidatePath(`/dashboard/${workspaceId}/ai-readiness`);
  return { ok: true, message: "Score ricalcolati.", fieldErrors: {} };
}

export async function generateAiReadinessInsightsAction(
  workspaceId: string,
  assessmentId: string,
  _prev: AiReadinessActionState,
  _formData: FormData
): Promise<AiReadinessActionState<{ generated: number }>> {
  void _prev;
  void _formData;
  const reviewer = await assertAssessmentReviewer(workspaceId);
  if (!reviewer.ok) return reviewer.state;
  const bundle = await getAssessmentBundleById(assessmentId);
  if (!bundle || bundle.assessment.workspaceId !== workspaceId) {
    return errorState("Assessment non trovato.");
  }

  const [dashboard, respondents, useCases] = await Promise.all([
    recomputeAiReadinessScores(assessmentId),
    listRespondentsByAssessment(assessmentId),
    listUseCaseSubmissionsByAssessment(assessmentId),
  ]);
  if (!dashboard) return errorState("Dashboard non disponibile.");

  const generated = generateAiReadinessIntelligence({
    assessmentId,
    workspaceId,
    template: bundle.templateDefinition,
    dashboard,
    useCases: useCases.map((item) => ({
      id: item.id,
      title: item.title,
      currentProcess: item.currentProcess,
      painPoint: item.painPoint,
      desiredOutcome: item.desiredOutcome,
      frequency: item.frequency,
      estimatedBeneficiaries: item.estimatedBeneficiaries,
      dataNeeded: item.dataNeeded,
      humanInLoop: item.humanInLoop,
      riskLevel: item.riskLevel,
      impactEstimate: item.impactEstimate,
      feasibilityScore: item.feasibilityScore,
      strategicValueScore: item.strategicValueScore,
      linkedUseCaseId: item.linkedUseCaseId,
    })),
    privacyConfig: bundle.assessment.privacyConfig ?? null,
    aggregationThreshold: bundle.assessment.aggregationThreshold,
    benchmarkConsentCount: respondents.filter(
      (respondent) => respondent.hasBenchmarkConsent
    ).length,
  });

  await deleteDraftAiReadinessInsights(assessmentId);
  await createAiReadinessInsights(
    generated.map((item) => ({
      assessmentId,
      workspaceId,
      scopeType: item.scopeType,
      scopeKey: item.scopeKey,
      insightType: item.insightType,
      title: item.title,
      body: item.body,
      evidence: item.evidence,
      aiGenerated: item.aiGenerated,
      humanValidated: item.humanValidated,
      validationStatus: item.validationStatus,
      model: item.model,
      promptVersion: item.promptVersion,
      inputScope: item.inputScope,
    }))
  );
  await createAiReadinessAuditEvent({
    organizationId: bundle.assessment.organizationId,
    workspaceId,
    assessmentId,
    actorUserId: reviewer.session.user.id,
    eventType: "insights_generated",
    eventPayload: {
      generated: generated.length,
      responseCount: dashboard.responseCount,
      aggregationThresholdMet: dashboard.aggregationThresholdMet,
    },
  });
  revalidatePath(`/dashboard/${workspaceId}/ai-readiness`);
  return {
    ok: true,
    message: `Intelligence generata: ${generated.length} insight.`,
    fieldErrors: {},
    data: { generated: generated.length },
  };
}

export async function updateAiReadinessInsightStatusAction(
  workspaceId: string,
  assessmentId: string,
  insightId: string,
  status: "reviewed" | "approved" | "rejected",
  _prev: AiReadinessActionState,
  _formData: FormData
): Promise<AiReadinessActionState> {
  void _prev;
  void _formData;
  const reviewer = await assertAssessmentReviewer(workspaceId);
  if (!reviewer.ok) return reviewer.state;
  const bundle = await getAssessmentBundleById(assessmentId);
  if (!bundle || bundle.assessment.workspaceId !== workspaceId) {
    return errorState("Assessment non trovato.");
  }
  const updated = await updateAiReadinessInsightValidation({
    insightId,
    workspaceId,
    status,
    validatedByUserId: reviewer.session.user.id,
  });
  if (!updated) return errorState("Insight non trovato.");

  await createAiReadinessAuditEvent({
    organizationId: bundle.assessment.organizationId,
    workspaceId,
    assessmentId,
    actorUserId: reviewer.session.user.id,
    eventType: "insight_validation_updated",
    eventPayload: {
      insightId,
      insightType: updated.insightType,
      validationStatus: status,
    },
  });
  revalidatePath(`/dashboard/${workspaceId}/ai-readiness`);
  return { ok: true, message: "Stato insight aggiornato.", fieldErrors: {} };
}

export async function promoteAiReadinessUseCaseToPortfolioAction(
  workspaceId: string,
  assessmentId: string,
  submissionId: string,
  _prev: AiReadinessActionState<{ useCaseId: string }>,
  _formData: FormData
): Promise<AiReadinessActionState<{ useCaseId: string }>> {
  void _prev;
  void _formData;
  const reviewer = await assertAssessmentReviewer(workspaceId);
  if (!reviewer.ok) return reviewer.state;
  const [bundle, submission] = await Promise.all([
    getAssessmentBundleById(assessmentId),
    getUseCaseSubmissionById(submissionId),
  ]);
  if (!bundle || bundle.assessment.workspaceId !== workspaceId) {
    return errorState("Assessment non trovato.");
  }
  if (
    !submission ||
    submission.assessmentId !== assessmentId ||
    submission.workspaceId !== workspaceId
  ) {
    return errorState("Use case assessment non trovato.");
  }
  if (submission.linkedUseCaseId) {
    return {
      ok: true,
      message: "Questo use case e gia collegato al Portfolio.",
      fieldErrors: {},
      data: { useCaseId: submission.linkedUseCaseId },
    };
  }

  const created = await createUseCase({
    workspaceId,
    title: submission.title,
    description:
      submission.desiredOutcome ||
      submission.painPoint ||
      submission.currentProcess ||
      "Use case importato da AI Readiness.",
    businessCase: [
      submission.painPoint ? `Pain point: ${submission.painPoint}` : null,
      submission.desiredOutcome ? `Outcome: ${submission.desiredOutcome}` : null,
      submission.impactEstimate ? `Impatto atteso: ${submission.impactEstimate}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    portfolioKind: "use_case_ai",
    status: "proposed",
    source: "ai_readiness_assessment",
    proposedBy: "AI Readiness respondent",
    portfolioReviewStatus: "needs_inputs",
    submittedAt: new Date(),
    flowDescription: submission.currentProcess,
    humanInTheLoop: submission.humanInLoop,
    guardrails: submission.riskReasoning,
    dataRequirements: submission.dataNeeded,
    reviewNotes:
      "Importato dalla diagnostica AI Readiness. I punteggi economici restano da validare manualmente.",
  });
  await updateAiReadinessUseCaseSubmission(submission.id, {
    linkedUseCaseId: created.id,
    status: "promoted",
    humanValidated: true,
    reviewerUserId: reviewer.session.user.id,
    reviewedAt: new Date(),
  });
  await createAiReadinessAuditEvent({
    organizationId: bundle.assessment.organizationId,
    workspaceId,
    assessmentId,
    actorUserId: reviewer.session.user.id,
    eventType: "assessment_use_case_promoted",
    eventPayload: {
      submissionId: submission.id,
      useCaseId: created.id,
      title: submission.title,
    },
  });
  revalidatePath(`/dashboard/${workspaceId}/ai-readiness`);
  revalidatePath(`/dashboard/${workspaceId}/portfolio`);
  return {
    ok: true,
    message: "Use case collegato al Portfolio.",
    fieldErrors: {},
    data: { useCaseId: created.id },
  };
}

export async function withdrawAiReadinessBenchmarkConsentAction(
  token: string,
  _prev: AiReadinessActionState,
  _formData: FormData
): Promise<AiReadinessActionState> {
  void _prev;
  void _formData;
  const tokenHash = hashInviteToken(token);
  const bundle = await getRespondentPrivacyBundleByTokenHash(tokenHash);
  if (!bundle) return errorState("Link privacy non valido.");
  await withdrawAiReadinessBenchmarkConsentByTokenHash(tokenHash);
  await createAiReadinessAuditEvent({
    organizationId: bundle.respondent.organizationId,
    workspaceId: bundle.respondent.workspaceId,
    assessmentId: bundle.respondent.assessmentId,
    respondentId: bundle.respondent.id,
    eventType: "benchmark_consent_withdrawn",
    eventPayload: { source: "respondent_privacy_page" },
  });
  return {
    ok: true,
    message: "Consenso benchmark revocato. Gli insight futuri useranno solo dati aggregati consentiti.",
    fieldErrors: {},
  };
}

export async function anonymizeAiReadinessRespondentAction(
  token: string,
  _prev: AiReadinessActionState,
  formData: FormData
): Promise<AiReadinessActionState> {
  void _prev;
  const confirmation = formString(formData, "confirmation").toUpperCase();
  if (confirmation !== "ANONIMIZZA") {
    return errorState("Scrivi ANONIMIZZA per confermare.", {
      confirmation: "Conferma richiesta.",
    });
  }
  const tokenHash = hashInviteToken(token);
  const bundle = await getRespondentPrivacyBundleByTokenHash(tokenHash);
  if (!bundle) return errorState("Link privacy non valido.");
  await anonymizeAiReadinessRespondentByTokenHash(tokenHash);
  await createAiReadinessAuditEvent({
    organizationId: bundle.respondent.organizationId,
    workspaceId: bundle.respondent.workspaceId,
    assessmentId: bundle.respondent.assessmentId,
    respondentId: bundle.respondent.id,
    eventType: "respondent_anonymized",
    eventPayload: { source: "respondent_privacy_page" },
  });
  return {
    ok: true,
    message: "Dati respondent anonimizzati. Il vecchio link privacy non sara piu utilizzabile.",
    fieldErrors: {},
  };
}
