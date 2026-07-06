import type {
  AiReadinessAnswer,
  AiReadinessTemplateDefinition,
} from "./types";

export type AiReadinessDraftConsents = {
  privacyAccepted: boolean;
  benchmarkConsent: boolean;
  marketingConsent: boolean;
};

export type AiReadinessDraftIdentity = {
  firstName: string;
  lastName: string;
};

export type AiReadinessDraftPayload = {
  answers: Record<string, string>;
  consents: AiReadinessDraftConsents;
  useCase: Record<string, string>;
  identity?: AiReadinessDraftIdentity;
};

export const USE_CASE_DRAFT_FIELDS = [
  "useCaseTitle",
  "useCaseFrequency",
  "useCaseCurrentProcess",
  "useCasePainPoint",
  "useCaseDesiredOutcome",
  "useCaseAiHypothesis",
  "useCaseBeneficiaries",
  "useCaseRiskLevel",
  "useCaseDataNeeded",
  "useCaseHumanInLoop",
  "useCaseRiskReasoning",
  "useCaseImpactEstimate",
  "useCaseToolsUsed",
] as const;

const MAX_ANSWER_LENGTH = 8000;

function clampText(value: unknown) {
  return typeof value === "string" ? value.slice(0, MAX_ANSWER_LENGTH) : "";
}

/**
 * Normalizza il payload bozza ricevuto dal client: tiene solo le domande del
 * template, converte le scale in numeri e scarta valori malformati.
 */
const MAX_NAME_LENGTH = 120;

function normalizeIdentity(raw: unknown): AiReadinessDraftIdentity {
  const identity = (raw ?? {}) as Partial<AiReadinessDraftIdentity>;
  const clean = (value: unknown) =>
    typeof value === "string" ? value.trim().slice(0, MAX_NAME_LENGTH) : "";
  return {
    firstName: clean(identity.firstName),
    lastName: clean(identity.lastName),
  };
}

export function normalizeDraftPayload(
  template: AiReadinessTemplateDefinition,
  raw: unknown
): {
  answers: AiReadinessAnswer[];
  consents: AiReadinessDraftConsents;
  useCase: Record<string, string>;
  identity: AiReadinessDraftIdentity;
} {
  const payload = (raw ?? {}) as Partial<AiReadinessDraftPayload>;
  const rawAnswers =
    payload.answers && typeof payload.answers === "object" ? payload.answers : {};
  const now = new Date().toISOString();

  const answers: AiReadinessAnswer[] = [];
  for (const question of template.questions) {
    const rawValue = (rawAnswers as Record<string, unknown>)[question.id];
    if (rawValue == null || rawValue === "") continue;
    let value: string | number | string[] | null = clampText(rawValue);
    if (question.answerType === "scale") {
      const n = Number(String(rawValue).replace(",", "."));
      if (!Number.isFinite(n)) continue;
      value = n;
    }
    if (question.answerType === "single_choice") {
      const valid = question.options?.some((option) => option.value === value);
      if (!valid) continue;
    }
    answers.push({
      questionId: question.id,
      value,
      answerType: question.answerType,
      sectionId: question.sectionId,
      pillarId: question.pillarId,
      answeredAt: now,
    });
  }

  const rawConsents = (payload.consents ?? {}) as Partial<AiReadinessDraftConsents>;
  const consents: AiReadinessDraftConsents = {
    privacyAccepted: rawConsents.privacyAccepted === true,
    benchmarkConsent: rawConsents.benchmarkConsent === true,
    marketingConsent: rawConsents.marketingConsent === true,
  };

  const rawUseCase =
    payload.useCase && typeof payload.useCase === "object" ? payload.useCase : {};
  const useCase: Record<string, string> = {};
  for (const field of USE_CASE_DRAFT_FIELDS) {
    const value = clampText((rawUseCase as Record<string, unknown>)[field]);
    if (value.length > 0) useCase[field] = value;
  }

  return { answers, consents, useCase, identity: normalizeIdentity(payload.identity) };
}

/**
 * Estrae dalla riga risposta (answers + metadata.draft) i valori iniziali con
 * cui pre-compilare il form di ripresa.
 */
export function draftPrefillFromResponse(params: {
  answers: AiReadinessAnswer[] | null | undefined;
  metadata: Record<string, unknown> | null | undefined;
}): AiReadinessDraftPayload & { identity: AiReadinessDraftIdentity } {
  const answers: Record<string, string> = {};
  for (const answer of params.answers ?? []) {
    if (answer?.questionId == null || answer.value == null || answer.value === "") continue;
    answers[answer.questionId] = String(answer.value);
  }
  const draftMeta =
    params.metadata && typeof params.metadata === "object"
      ? ((params.metadata as Record<string, unknown>).draft as
          | Partial<AiReadinessDraftPayload>
          | undefined)
      : undefined;
  const consents = (draftMeta?.consents ?? {}) as Partial<AiReadinessDraftConsents>;
  const useCase: Record<string, string> = {};
  const rawUseCase = draftMeta?.useCase;
  if (rawUseCase && typeof rawUseCase === "object") {
    for (const field of USE_CASE_DRAFT_FIELDS) {
      const value = (rawUseCase as Record<string, unknown>)[field];
      if (typeof value === "string" && value.length > 0) useCase[field] = value;
    }
  }
  return {
    answers,
    consents: {
      privacyAccepted: consents.privacyAccepted === true,
      benchmarkConsent: consents.benchmarkConsent === true,
      marketingConsent: consents.marketingConsent === true,
    },
    useCase,
    identity: normalizeIdentity(draftMeta?.identity),
  };
}
